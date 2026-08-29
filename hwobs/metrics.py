"""指标层里属于 AIDA64 的机械部分：原始串取数、候选 ID 择一、跨编号聚合。

"哪个传感器对应哪个指标、什么单位、什么阈值" 一律在 registry/metrics.json 里，
本文件不再保存任何指标清单。
"""

import re

# 网卡与磁盘的传感器按编号分列，聚合时靠这两个正则收口
NIC_RX = re.compile(r"^SNIC(\d+)(UL|DL)RATE$")
DISK_RX = re.compile(r"^SDSK(\d+)(READ|WRITE)SPD$")

# 单位换算表，被 registry 的 convert 字段引用。
# 注意：AIDA64 导出的速率是自动换算后的显示值且不带单位，所以这里的换算未经标定。
TO_MBPS = {"B/s": 8 / 1e6, "KB/s": 8 / 1e3, "MB/s": 8.0, "kbps": 1e-3, "Mbps": 1.0}
TO_MBS = {"B/s": 1 / 1024 ** 2, "KB/s": 1 / 1024, "MB/s": 1.0}


def num(text):
    """从 '45'、'1.216'、'--' 这类原始串里取第一个数；取不到返回 None。"""
    if text is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", str(text))
    return float(m.group(0)) if m else None


def pick(sensors, ids, zero_is_na=False):
    """按 ids 顺序取第一个有值的传感器，返回 (命中的ID, 数值)；都没有则 (None, None)。"""
    for sid in ids:
        if sid not in sensors:
            continue
        val = num(sensors[sid][1])
        if zero_is_na and val == 0:
            continue
        return sid, val
    return None, None


def active_nics(sensors):
    return sorted({m.group(1) for sid in sensors if (m := NIC_RX.match(sid))}, key=int)


def disks(sensors, rate_unit):
    """磁盘读写速率 + 温度，名字直接取 THDD<n> 的标签（就是 SSD 型号）。"""
    out = {}
    for sid, (_label, raw) in sensors.items():
        m = DISK_RX.match(sid)
        if not m:
            continue
        idx, kind = m.group(1), m.group(2).lower()
        val = num(raw)
        entry = out.setdefault(idx, {"name": None, "read": None, "write": None, "temp": None})
        entry[kind] = None if val is None else round(val * TO_MBS[rate_unit], 2)
    for idx, entry in out.items():
        temp = sensors.get(f"THDD{idx}")
        if temp:
            entry["name"], entry["temp"] = temp[0], num(temp[1])
        else:
            entry["name"] = f"Disk {idx}"
    return [out[k] for k in sorted(out, key=int)]
