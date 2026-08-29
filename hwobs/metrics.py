"""指标层：把源给出的原始字符串变成有名字、有单位、有阈值的数值。

这里是唯一允许做单位换算和聚合的地方。M2 会把它升级成 JSON 驱动的指标注册表，
所以本文件的每个常量都保持可被外部读取（WANTED / ZERO_IS_NA / RATE_UNIT ...）。
"""

import re

# 前端要的指标 -> AIDA64 传感器 ID（按顺序取第一个可用的）。
# 这些 ID 必须先在 AIDA64「首选项 -> 硬件监视工具 -> 外部程序」里勾选，共享内存里才会有。
WANTED = {
    "cpu_usage": ["SCPUUTI", "SCPU1UTI"],
    "cpu_temp": ["TCPUPKG", "TCPUSOCK", "TCPU"],
    "cpu_socket": ["TCPUSOCK"],
    "cpu_clock": ["SCPUCLK"],
    "cpu_power": ["PCPUPKG", "PCPU"],
    "cpu_fan": ["FCPU"],
    "cpu_volt": ["VCPU"],
    "gpu_usage": ["SGPU1UTI"],
    "gpu_temp": ["TGPU1", "TGPU1HOT"],
    "gpu_hotspot": ["TGPU1HOT"],
    "gpu_memtemp": ["TGPU1MEM"],
    "gpu_mem_used": ["SUSEDVMEM"],
    "gpu_mem_free": ["SFREEVMEM"],
    "gpu_mem_pct": ["SVMEMUSAGE"],
    "gpu_clock": ["SGPU1CLK"],
    "gpu_mem_clock": ["SGPU1MEMCLK"],
    "gpu_volt": ["VGPU1"],
    "gpu_power": ["PGPU1"],
    "gpu_tdp": ["PGPU1TDPP"],
    "ram_pct": ["SMEMUTI"],
    "mobo_temp": ["TMOBO"],
    "dimm1": ["TDIMMTS1"],
    "dimm3": ["TDIMMTS3"],
}

# 温度传感器读到 0 表示该通道没接线（例如这块主板上的 TCPU），不能当成真实温度显示
ZERO_IS_NA = {"cpu_temp", "cpu_socket", "gpu_temp", "gpu_hotspot", "gpu_memtemp",
              "mobo_temp", "dimm1", "dimm3"}

# 网卡和磁盘速率跨编号聚合，所以不写死在 WANTED 里
NIC_RX = re.compile(r"^SNIC(\d+)(UL|DL)RATE$")
DISK_RX = re.compile(r"^SDSK(\d+)(READ|WRITE)SPD$")
RSSI_RX = re.compile(r"^SNIC(\d+)WLANRSSI$")

# AIDA64 的速率传感器导出的是自动换算后的显示值且不带单位，这里按它默认的 KB/s 处理。
# 数值明显差 8 倍或 1000 倍时改这一行（B/s、KB/s、MB/s、kbps、Mbps）。
RATE_UNIT = "KB/s"
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


def nic_total(sensors, direction):
    """direction 取 'UL' 或 'DL'。活动网卡不一定是 NIC1（这台机器是 NIC5），所以全部相加。"""
    vals = [num(raw) for sid, (_label, raw) in sensors.items()
            if (m := NIC_RX.match(sid)) and m.group(2) == direction]
    vals = [v for v in vals if v is not None]
    return sum(vals) if vals else None


def active_nics(sensors):
    return sorted({m.group(1) for sid in sensors if (m := NIC_RX.match(sid))}, key=int)


def disks(sensors):
    """磁盘读写速率 + 温度，名字直接取 THDD<n> 的标签（就是 SSD 型号）。"""
    out = {}
    for sid, (_label, raw) in sensors.items():
        m = DISK_RX.match(sid)
        if not m:
            continue
        idx, kind = m.group(1), m.group(2).lower()
        val = num(raw)
        entry = out.setdefault(idx, {"name": None, "read": None, "write": None, "temp": None})
        entry[kind] = None if val is None else round(val * TO_MBS[RATE_UNIT], 2)
    for idx, entry in out.items():
        temp = sensors.get(f"THDD{idx}")
        if temp:
            entry["name"], entry["temp"] = temp[0], num(temp[1])
        else:
            entry["name"] = f"Disk {idx}"
    return [out[k] for k in sorted(out, key=int)]
