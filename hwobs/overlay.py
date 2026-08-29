"""把各数据源的读数装配成叠加层用的那一份 JSON。

指标清单、单位、阈值、聚合方式全在 registry/metrics.json；本文件只负责：
读源 → 交给 registry 解析装配 → 补上注册表表达不了的少数项（Windows 内存、
网卡编号列表、磁盘列表、共享内存预算）。
"""

import time

from . import metrics, registry
from .sources import aida64, winapi


def snapshot():
    reg = registry.load()
    out = {"ts": round(time.time(), 1), "rate_unit": reg["rate_unit"]}
    sensors, shm_bytes = aida64.read_sensors()
    if sensors is None:
        out.update(ok=False, error=f"共享内存 {aida64.SHM_NAME} 打不开，AIDA64 可能没运行")
        return out

    values, matched, missing = registry.resolve(sensors, reg)

    used, total, pct = winapi.windows_ram()
    values["ram_used"] = used
    values["ram_total"] = total
    tree = registry.apply(values, reg)

    # 内存占用率优先用 AIDA64 的 SMEMUTI，拿不到再退回 Windows 自己算的
    tree["ram"]["pct"] = values.get("ram_pct") or pct
    tree.setdefault("net", {})["active_nics"] = metrics.active_nics(sensors)

    out.update(
        ok=True,
        exported=len(sensors),
        shm={"bytes": shm_bytes, "limit": aida64.SHM_SIZE,
             "pct": round(shm_bytes / aida64.SHM_SIZE * 100)},
        **tree,
        disk=metrics.disks(sensors, reg["rate_unit"]),
        matched=matched,
        missing=missing,
    )
    return out


def debug_dump():
    sensors, shm_bytes = aida64.read_sensors()
    if sensors is None:
        return {"error": f"共享内存 {aida64.SHM_NAME} 打不开"}
    return {"exported": len(sensors), "shm_bytes": shm_bytes, "shm_limit": aida64.SHM_SIZE,
            "missing": snapshot().get("missing"),
            "sensors": [{"id": k, "label": v[0], "value": v[1]} for k, v in sensors.items()]}
