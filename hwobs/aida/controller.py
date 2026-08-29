"""AIDA64 导出清单的读写与进程生命周期。

改 HWMonExtAppItems 必须走「确认 → 停进程 → 等它真退出 → 备份 → 写 → 校验没被回改
→ 启动 → 回读共享内存比对 → 失败则回滚」。原因是 AIDA64 在**自己退出时**才把配置
写回 ini，运行中改的会被整份覆盖掉 —— 这一步顺序错了就会静默失效。

本模块是全项目唯一会启停外部进程的地方。apply() 不带 confirm=True 直接拒绝执行。
"""

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
    """版式实际引用到的输出路径 -> 需要导出的传感器 ID（含候选 ID，候选是为跨主板兜底）。"""
    reg = reg or registry.load()
    by_out = {m["out"]: m for m in reg["metrics"] if m.get("out")}
    # out 为 null 的条目（如显存空闲）只能按 id 引用到
    for m in reg["metrics"]:
        by_out.setdefault(m["id"], m)

    paths = []

    def collect(node):
        if isinstance(node, str):
            paths.append(node)          # items/metrics 列表里的裸路径字符串
        elif isinstance(node, dict):
            for k in ("metric", "bar", "spark"):
                if isinstance(node.get(k), str):
                    paths.append(node[k])
            for k in ("metrics", "pair", "diff", "max_of", "items", "value", "sub"):
                if k in node:
                    collect(node[k])
        elif isinstance(node, list):
            for x in node:
                collect(x)

    collect(overlay_cfg.get("rows", []))

    ids, seen = [], set()
    for p in paths:
        m = by_out.get(p)
        if not m:
            continue
        for sid in m.get("sources", {}).get("aida64", []):
            if sid not in seen:
                seen.add(sid)
                ids.append(sid)
    for sid in runtime_ids(sensors):
        if sid not in seen:
            seen.add(sid)
            ids.append(sid)
    return ids, sorted(set(paths) - set(by_out))


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
