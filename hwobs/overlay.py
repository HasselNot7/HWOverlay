"""把各数据源的读数装配成叠加层用的那一份 JSON。"""

import time

from . import metrics
from .sources import aida64, winapi


def snapshot():
    out = {"ts": round(time.time(), 1), "rate_unit": metrics.RATE_UNIT}
    sensors, shm_bytes = aida64.read_sensors()
    if sensors is None:
        out.update(ok=False, error=f"共享内存 {aida64.SHM_NAME} 打不开，AIDA64 可能没运行")
        return out

    matched, missing, v = {}, [], {}
    for key, ids in metrics.WANTED.items():
        sid, val = metrics.pick(sensors, ids, key in metrics.ZERO_IS_NA)
        matched[key] = sid
        if sid is None:
            missing.append(ids[0])
        v[key] = val

    up = metrics.nic_total(sensors, "UL")
    down = metrics.nic_total(sensors, "DL")
    rssi = [metrics.num(raw) for sid, (_label, raw) in sensors.items() if metrics.RSSI_RX.match(sid)]

    used, total, pct = winapi.windows_ram()
    mem_used = v["gpu_mem_used"]
    mem_total = None if mem_used is None or v["gpu_mem_free"] is None else mem_used + v["gpu_mem_free"]

    out.update(
        ok=True,
        exported=len(sensors),
        shm={"bytes": shm_bytes, "limit": aida64.SHM_SIZE,
             "pct": round(shm_bytes / aida64.SHM_SIZE * 100)},
        cpu={"usage": v["cpu_usage"], "temp": v["cpu_temp"], "socket_temp": v["cpu_socket"],
             "clock_mhz": v["cpu_clock"], "power_w": v["cpu_power"],
             "fan_rpm": v["cpu_fan"], "volt": v["cpu_volt"]},
        gpu={"usage": v["gpu_usage"], "temp": v["gpu_temp"], "hotspot": v["gpu_hotspot"],
             "mem_temp": v["gpu_memtemp"], "volt": v["gpu_volt"], "power_w": v["gpu_power"],
             "tdp_pct": v["gpu_tdp"], "mem_pct": v["gpu_mem_pct"],
             "clock_mhz": v["gpu_clock"], "mem_clock_mhz": v["gpu_mem_clock"],
             "mem_used_mb": mem_used, "mem_total_mb": mem_total},
        ram={"used": used, "total": total, "pct": v["ram_pct"] or pct},
        net={"up_mbps": None if up is None else round(up * metrics.TO_MBPS[metrics.RATE_UNIT], 2),
             "down_mbps": None if down is None else round(down * metrics.TO_MBPS[metrics.RATE_UNIT], 2),
             "active_nics": metrics.active_nics(sensors), "wifi_dbm": max(rssi) if rssi else None},
        disk=metrics.disks(sensors),
        misc={"mobo_temp": v["mobo_temp"], "dimm1": v["dimm1"], "dimm3": v["dimm3"]},
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
