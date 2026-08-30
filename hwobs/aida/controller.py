"""AIDA64 导出清单的只读对比。

本模块**不会写 aida64.ini，也不会启停 AIDA64**；对 AIDA64 的接触只有
两件事：读共享内存、用 PowerShell 只读地查一下进程在不在（_ps 带超时
与异常兜底）。原因：HWMonExtAppItems 是 AIDA64 的配置，OSD、看板等
其他软件也在读同一份共享内存，删谁留谁必须由用户自己决定 —— 这里只
负责"版式需要什么、AIDA64 现在有什么、缺什么"，并拼出一条用户可自行
粘贴的补全行（见 plan_export）。

历史上曾有过 apply() 状态机（确认 → 停进程 → 写 ini → 校验 → 重启 → 回读
回滚），已删除：替用户改第三方软件的清单属于越权，且分发场景下别的用户
未必愿意。
"""

import re
import subprocess

from .. import budget, registry, refs
from ..metrics import DISK_RX, NIC_RX
from ..sources import aida64
from . import ini

PS_TIMEOUT = 10.0
# windowed 打包的 exe 起 powershell.exe 这类控制台子进程会闪出终端窗口
# （Win11 上是 Windows Terminal），CREATE_NO_WINDOW 压掉
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _ps(command):
    """跑一条 PowerShell 只读查询。超时/缺失/被安全软件拦截一律返回空串：
    状态接口靠它判断 AIDA64 在不在，绝不能被它拖死或炸成 500
    （否则管理页永远停在"检测中"）。"""
    try:
        return subprocess.run(["powershell", "-NoProfile", "-Command", command],
                              capture_output=True, text=True, timeout=PS_TIMEOUT,
                              creationflags=_NO_WINDOW).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def _proc_path():
    return ini.install_from_path(
        _ps("Get-Process aida64 -ErrorAction SilentlyContinue | Select-Object -First 1 -Expand Path"))


def _running():
    out = _ps("Get-Process aida64 -ErrorAction SilentlyContinue | Measure-Object | Select -Expand Count")
    return out.isdigit() and int(out) > 0


def status():
    """只读体检：不启停任何进程、不写任何文件。

    任何一步失败都不许把 /api/aida/status 炸成 500 —— 管理页向导靠它
    显示真实原因，接口一炸前端就只能永远停在"检测中"。
    """
    out = {
        "running": False, "install": None, "ini": None, "exported_ids": [],
        "shm_bytes": 0, "shm_limit": aida64.SHM_SIZE, "shm_pct": 0,
        "shm_readable": False, "usable_bytes": budget.usable(),
        "error": None,
    }
    try:
        install = _proc_path()
        sensors, used = aida64.read_sensors()
        cur = []
        ini_path = None
        if install:
            cand = install / "aida64.ini"
            if cand.is_file():
                ini_path = cand
                cur = ini.get_items(ini.load(cand))
        out.update({
            "running": _running(),
            "install": str(install) if install else None,
            "ini": str(ini_path) if ini_path else None,
            "exported_ids": cur,
            "shm_bytes": used,
            "shm_pct": round(used / aida64.SHM_SIZE * 100) if used else 0,
            "shm_readable": sensors is not None,
        })
    except Exception as e:      # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def runtime_ids(sensors):
    """代码里按正则聚合、不走注册表的 ID（网卡各条、磁盘速率与温度）必须一并算进
    版式所需，否则只读对比会把磁盘列和网络列误报成"用不到"。"""
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

    版式树的遍历只有 refs 模块一份（历史上各写一份曾漏收三类路径）。本函数
    只负责"路径 -> 传感器 ID"：
      - sources.aida64：候选 ID 全收，候选是为跨主板兜底存在的
      - sum_of：派生量的依赖要递归展开（显存总量 = 已用 + 空闲，"空闲"也得导）
      - agg：这类指标只有正则没有 ID，要拿当前已导出的 ID 去匹配
    """
    reg = reg or registry.load()
    by_out = {m["out"]: m for m in reg["metrics"] if m.get("out")}
    by_id = {m["id"]: m for m in reg["metrics"]}
    sensors = sensors or {}

    paths = refs.collect_refs(overlay_cfg)

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
    """只读对比：版式需要哪些传感器、AIDA64 现在导出了哪些、缺哪些。

    缺口（missing）提示用户自己去 AIDA64 里补；unused 是清单里本软件用不到的
    传感器，仅列出、绝不动它们。merged_items 是"现有 ∪ 缺口"拼好的整行值，
    用户想批量补时复制粘贴进 ini 即可 —— 写不写、何时写，都是用户自己的动作。
    """
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

    missing = [i for i in needed if i not in current]
    unused = [i for i in current if i not in needed]
    merged = current + missing                        # 补全清单：现有传感器一个不丢
    merged_plan = budget.plan(merged, hints=hints)
    return {
        "current_count": len(current),
        "needed_count": len(needed),
        "missing": missing,
        "missing_reasons": {i: why.get(i, ["网卡/磁盘聚合，代码按正则取用"]) for i in missing},
        "unused": unused,
        "merged_key": ini.ITEMS_KEY,
        "merged_items": " ".join(merged),
        "budget_now": {k: now[k] for k in ("count", "usable", "worst_bytes", "typical_bytes", "fits")},
        "budget_merged": {k: merged_plan[k] for k in ("count", "usable", "worst_bytes", "typical_bytes",
                                                      "fits", "truncated_at")},
        "fits": merged_plan["fits"],
        "unchanged": not missing,
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
