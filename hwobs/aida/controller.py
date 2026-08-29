"""AIDA64 导出清单的读写与进程生命周期。

改 HWMonExtAppItems 必须走「确认 → 停进程 → 等它真退出 → 备份 → 写 → 校验没被回改
→ 启动 → 回读共享内存比对 → 失败则回滚」。原因是 AIDA64 在**自己退出时**才把配置
写回 ini，运行中改的会被整份覆盖掉 —— 这一步顺序错了就会静默失效。

本模块是全项目唯一会启停外部进程的地方。apply() 不带 confirm=True 直接拒绝执行。
"""

import re
import subprocess
import time
from pathlib import Path

from .. import budget, registry
from ..metrics import DISK_RX, NIC_RX
from ..sources import aida64
from . import ini

STOP_TIMEOUT = 12.0
START_TIMEOUT = 20.0


def _proc_path():
    return ini.find_install()


def _running():
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
                          "Get-Process aida64 -ErrorAction SilentlyContinue | Measure-Object | Select -Expand Count"],
                         capture_output=True, text=True).stdout.strip()
    return out.isdigit() and int(out) > 0


def status():
    """只读体检：不启停任何进程、不写任何文件。"""
    install = _proc_path()
    running = _running()
    sensors, used = aida64.read_sensors()
    cur = []
    ini_path = None
    if install:
        cand = install / "aida64.ini"
        if cand.is_file():
            ini_path = cand
            cur = ini.get_items(ini.load(cand))
    return {
        "running": running,
        "install": str(install) if install else None,
        "ini": str(ini_path) if ini_path else None,
        "exported_ids": cur,
        "shm_bytes": used,
        "shm_limit": aida64.SHM_SIZE,
        "shm_pct": round(used / aida64.SHM_SIZE * 100) if used else 0,
        "shm_readable": sensors is not None,
        "usable_bytes": budget.usable(),
    }


def runtime_ids(sensors):
    """代码里按正则聚合、不走注册表的 ID（网卡各条、磁盘速率与温度）必须一并保住，
    否则管理界面"只导出用到的指标"会把磁盘列和网络列静默清零。"""
    if not sensors:
        return []
    keep = []
    for sid in sensors:
        m = NIC_RX.match(sid)
        if m and m.group(2) in ("UL", "DL"):
            keep.append(sid)
        elif DISK_RX.match(sid) or sid.startswith("THDD"):
            keep.append(sid)
    return keep


def needed_ids(overlay_cfg, reg=None, sensors=None):
    """版式实际引用到的输出路径 -> 需要导出的传感器 ID。

    三条容易漏的取数路径，漏一条 apply() 就会把版式在用的传感器删掉：
      - sources.aida64：候选 ID 全收，候选是为跨主板兜底存在的
      - sum_of：派生量的依赖要递归展开（显存总量 = 已用 + 空闲，"空闲"也得导）
      - agg：这类指标只有正则没有 ID，要拿当前已导出的 ID 去匹配
    """
    reg = reg or registry.load()
    by_out = {m["out"]: m for m in reg["metrics"] if m.get("out")}
    by_id = {m["id"]: m for m in reg["metrics"]}
    sensors = sensors or {}

    paths = []

    def collect(node):
        if isinstance(node, str):
            paths.append(node)          # items/metrics 列表里的裸路径字符串
        elif isinstance(node, dict):
            for k in ("metric", "bar", "spark"):
                if isinstance(node.get(k), str):
                    paths.append(node[k])
            for k in ("metrics", "pair", "diff", "items", "value", "sub"):
                if k in node:
                    collect(node[k])
        elif isinstance(node, list):
            for x in node:
                collect(x)

    collect(overlay_cfg.get("rows", []))

    ids, seen = [], set()

    def push(sid):
        if sid not in seen:
            seen.add(sid)
            ids.append(sid)

    def add_metric(m, depth=0):
        if m is None or depth > 4:                     # 防 sum_of 写成环
            return
        for sid in m.get("sources", {}).get("aida64", []):
            push(sid)
        rx = m.get("regex")
        if m.get("agg") and rx:
            rx = re.compile(rx)
            for sid in sensors:
                if rx.match(sid):
                    push(sid)
        for dep in m.get("sum_of", []):
            add_metric(by_id.get(dep), depth + 1)

    unknown = []
    for p in paths:
        m = by_out.get(p) or by_id.get(p)
        if m is None:
            unknown.append(p)
            continue
        add_metric(m)

    for sid in runtime_ids(sensors):
        push(sid)
    return ids, sorted(set(unknown))


def plan_export(overlay_cfg=None, sensors=None):
    """只读：当前导出清单 vs 版式需要的清单。向导和 apply 确认框都用它。"""
    from .. import config
    cfg = overlay_cfg or config.read()
    sensors = sensors if sensors is not None else (read_sensors_now())
    needed, plan = propose(cfg, sensors=sensors)
    current = list(sensors or {})
    hints = {sid: (label, value) for sid, (label, value) in (sensors or {}).items()}
    now = budget.plan(current, hints=hints)

    why = {}
    for m in registry.load()["metrics"]:
        for sid in m.get("sources", {}).get("aida64", []):
            why.setdefault(sid, []).append(m.get("name") or m["id"])

    to_add = [i for i in needed if i not in current]
    to_remove = [i for i in current if i not in needed]
    return {
        "current_count": len(current),
        "needed_count": len(needed),
        "to_add": to_add,
        "to_remove": to_remove,
        "add_reasons": {i: why.get(i, ["网卡/磁盘聚合，代码按正则取用"]) for i in to_add},
        "budget_now": {k: now[k] for k in ("count", "usable", "worst_bytes", "typical_bytes", "fits")},
        "budget_new": {k: plan[k] for k in ("count", "usable", "worst_bytes", "typical_bytes", "fits",
                                            "truncated_at")},
        "fits": plan["fits"],
        "restart_required": bool(to_add or to_remove),
        "unchanged": not (to_add or to_remove),
        "unknown_paths": plan["unknown_paths"],
    }


def read_sensors_now():
    return aida64.read_sensors()[0]


def propose(overlay_cfg, sensors=None):
    sensors = sensors if sensors is not None else aida64.read_sensors()[0]
    ids, unknown_paths = needed_ids(overlay_cfg, sensors=sensors)
    hints = {sid: (label, value) for sid, (label, value) in (sensors or {}).items()}
    plan = budget.plan(ids, hints=hints)
    plan["unknown_paths"] = unknown_paths
    return ids, plan


def _wait_gone(pid):
    deadline = time.time() + STOP_TIMEOUT
    while time.time() < deadline:
        out = subprocess.run(["powershell", "-NoProfile", "-Command",
                              f"Get-Process -Id {pid} -ErrorAction SilentlyContinue | Measure-Object | Select -Expand Count"],
                             capture_output=True, text=True).stdout.strip()
        if out == "0":
            return True
        time.sleep(0.3)
    return False


def apply(ids, confirm=False, restart=True, exe=None):
    """写入 HWMonExtAppItems 并重启 AIDA64 校验。不 confirm 就只报计划，不落任何改动。"""
    st = status()
    if not confirm:
        return {"applied": False, "reason": "需要 confirm=True：这会关闭并重启你的 AIDA64",
                "status": st, "would_write": ids}
    if not st["ini"]:
        return {"applied": False, "reason": "找不到 aida64.ini", "status": st}
    if not st["running"]:
        return {"applied": False, "reason": "AIDA64 没在运行，无法回读校验（请先启动它）", "status": st}

    ini_path = Path(st["ini"])
    before = ini.load(ini_path)
    pid = subprocess.run(["powershell", "-NoProfile", "-Command",
                          "Get-Process aida64 | Select -First 1 -Expand Id"],
                         capture_output=True, text=True).stdout.strip()
    subprocess.run(["powershell", "-NoProfile", "-Command", "Stop-Process -Name aida64 -Force"])
    if not _wait_gone(int(pid or -1)):
        return {"applied": False, "reason": f"AIDA64 在 {STOP_TIMEOUT}s 内没退出，已放弃写入以免配置被覆盖"}

    bak, _ = ini.set_items(ini_path, ids, backup=True)
    ok, detail = ini.verify_untouched(ini_path, before)
    if not ok:
        _restore(ini_path, bak)
        return {"applied": False, "reason": f"ini 校验失败，已回滚：{detail}"}

    if restart:
        target = exe or (st["install"] + "\\aida64.exe" if st["install"] else None)
        if not target or not Path(target).is_file():
            return {"applied": True, "verified": False,
                    "reason": "已写入但找不到 aida64.exe，请手动启动 AIDA64", "backup": str(bak)}
        subprocess.run(["powershell", "-NoProfile", "-Command", f'Start-Process "{target}"'])
        verdict = _verify_shm(ids)
        if not verdict["ok"] and verdict["truncated_at"] is not None:
            _restore(ini_path, bak)
            subprocess.run(["powershell", "-NoProfile", "-Command", f'Start-Process "{target}"'])
            return {"applied": False, "rolled_back": True,
                    "reason": f"回读发现从第 {verdict['truncated_at']} 条起被截断，已回滚并恢复原配置",
                    "missing": verdict["missing"]}
        return {"applied": True, "verified": True, "backup": str(bak), "check": verdict}
    return {"applied": True, "verified": False, "backup": str(bak),
            "reason": "已写入但未重启 AIDA64，改动要等它下次启动才生效"}


def _restore(ini_path, bak):
    import shutil
    shutil.copy2(bak, ini_path)


def _verify_shm(requested, timeout=START_TIMEOUT):
    """轮询共享内存，比对"请求集 vs 实得集"。这是唯一能发现静默截断的手段。"""
    deadline = time.time() + timeout
    got = {}
    while time.time() < deadline:
        got, _used = aida64.read_sensors()
        if got and len(got) >= 5:
            break
        time.sleep(0.5)
    if not got:
        return {"ok": False, "missing": list(requested), "truncated_at": None,
                "reason": "AIDA64 重启后共享内存读不到"}
    missing = [sid for sid in requested if sid not in got]
    truncated_at = None
    for i, sid in enumerate(requested):
        if sid in missing:
            truncated_at = i
            break
    return {"ok": not missing, "missing": missing, "truncated_at": truncated_at,
            "exported": len(got), "unexpected": sorted(set(got) - set(requested))}
