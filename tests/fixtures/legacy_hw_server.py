"""读 AIDA64 的 RTSS 共享内存（AIDA64_SensorValues）-> OBS 浏览器源用的 JSON。

启动：python hw_server.py
OBS 浏览器源地址：http://127.0.0.1:8765/
调试地址：http://127.0.0.1:8765/sensors   （列出 AIDA64 当前导出的全部传感器）
"""

import ctypes
import json
import re
import time
from ctypes import wintypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

SHM_NAME = "AIDA64_SensorValues"
SHM_SIZE = 4096
PORT = 8765
HTML_FILE = Path(__file__).resolve().parent / "监测.html"

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

# 网卡和磁盘速率是跨编号聚合的，不写死在 WANTED 里
NIC_RX = re.compile(r"^SNIC(\d+)(UL|DL)RATE$")
DISK_RX = re.compile(r"^SDSK(\d+)(READ|WRITE)SPD$")
RSSI_RX = re.compile(r"^SNIC(\d+)WLANRSSI$")

# AIDA64 的速率传感器导出的是自动换算后的显示值且不带单位，这里按它默认的 KB/s 处理。
# 数值明显差 8 倍或 1000 倍时改这一行（B/s、KB/s、MB/s、kbps、Mbps）。
RATE_UNIT = "KB/s"
TO_MBPS = {"B/s": 8 / 1e6, "KB/s": 8 / 1e3, "MB/s": 8.0, "kbps": 1e-3, "Mbps": 1.0}
TO_MBS = {"B/s": 1 / 1024 ** 2, "KB/s": 1 / 1024, "MB/s": 1.0}

k32 = ctypes.windll.kernel32
k32.OpenFileMappingW.restype = ctypes.c_void_p
k32.OpenFileMappingW.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
k32.MapViewOfFile.restype = ctypes.c_void_p
k32.MapViewOfFile.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_size_t]
k32.UnmapViewOfFile.argtypes = [ctypes.c_void_p]


class MemoryStatusEx(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def windows_ram():
    """内存总量/已用/可用用 Windows API 取，不占 AIDA64 的导出名额。"""
    st = MemoryStatusEx()
    st.dwLength = ctypes.sizeof(st)
    if not k32.GlobalMemoryStatusEx(ctypes.byref(st)):
        return None, None, None
    gb = 1024 ** 3
    total = st.ullTotalPhys / gb
    used = (st.ullTotalPhys - st.ullAvailPhys) / gb
    return round(used, 1), round(total, 1), round(used / total * 100, 1)


ENTRY_RX = re.compile(r"<[a-z]+><id>([^<]+)</id><label>([^<]*)</label><value>([^<]*)</value>")


def read_sensors():
    """打开共享内存，返回 ({传感器ID: (标签, 原始值)}, 已用字节数)。AIDA64 没运行时返回 (None, 0)。"""
    handle = k32.OpenFileMappingW(0x0004, False, SHM_NAME)
    if not handle:
        return None, 0
    ptr = k32.MapViewOfFile(handle, 0x0004, 0, 0, 0)
    text = ""
    try:
        if not ptr:
            return None, 0
        text = ctypes.string_at(ptr, SHM_SIZE).decode("utf-8", "replace").split("\x00")[0]
    finally:
        if ptr:
            k32.UnmapViewOfFile(ptr)
        k32.CloseHandle(handle)
    sensors = {sid: (label, value) for sid, label, value in ENTRY_RX.findall(text)}
    return sensors, len(text.encode("utf-8"))


def num(text):
    if text is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", str(text))
    return float(m.group(0)) if m else None


def pick(sensors, ids, zero_is_na=False):
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


def snapshot():
    out = {"ts": round(time.time(), 1), "rate_unit": RATE_UNIT}
    sensors, shm_bytes = read_sensors()
    if sensors is None:
        out.update(ok=False, error=f"共享内存 {SHM_NAME} 打不开，AIDA64 可能没运行")
        return out

    matched, missing, v = {}, [], {}
    for key, ids in WANTED.items():
        sid, val = pick(sensors, ids, key in ZERO_IS_NA)
        matched[key] = sid
        if sid is None:
            missing.append(ids[0])
        v[key] = val

    up = nic_total(sensors, "UL")
    down = nic_total(sensors, "DL")
    rssi = [num(raw) for sid, (_label, raw) in sensors.items() if RSSI_RX.match(sid)]

    used, total, pct = windows_ram()
    mem_used = v["gpu_mem_used"]
    mem_total = None if mem_used is None or v["gpu_mem_free"] is None else mem_used + v["gpu_mem_free"]

    out.update(
        ok=True,
        exported=len(sensors),
        shm={"bytes": shm_bytes, "limit": SHM_SIZE, "pct": round(shm_bytes / SHM_SIZE * 100)},
        cpu={"usage": v["cpu_usage"], "temp": v["cpu_temp"], "socket_temp": v["cpu_socket"],
             "clock_mhz": v["cpu_clock"], "power_w": v["cpu_power"],
             "fan_rpm": v["cpu_fan"], "volt": v["cpu_volt"]},
        gpu={"usage": v["gpu_usage"], "temp": v["gpu_temp"], "hotspot": v["gpu_hotspot"],
             "mem_temp": v["gpu_memtemp"], "volt": v["gpu_volt"], "power_w": v["gpu_power"],
             "tdp_pct": v["gpu_tdp"], "mem_pct": v["gpu_mem_pct"],
             "clock_mhz": v["gpu_clock"], "mem_clock_mhz": v["gpu_mem_clock"],
             "mem_used_mb": mem_used, "mem_total_mb": mem_total},
        ram={"used": used, "total": total, "pct": v["ram_pct"] or pct},
        net={"up_mbps": None if up is None else round(up * TO_MBPS[RATE_UNIT], 2),
             "down_mbps": None if down is None else round(down * TO_MBPS[RATE_UNIT], 2),
             "active_nics": active_nics(sensors), "wifi_dbm": max(rssi) if rssi else None},
        disk=disks(sensors),
        misc={"mobo_temp": v["mobo_temp"], "dimm1": v["dimm1"], "dimm3": v["dimm3"]},
        matched=matched,
        missing=missing,
    )
    return out


def debug_dump():
    sensors, shm_bytes = read_sensors()
    if sensors is None:
        return {"error": f"共享内存 {SHM_NAME} 打不开"}
    return {"exported": len(sensors), "shm_bytes": shm_bytes, "shm_limit": SHM_SIZE,
            "missing": snapshot().get("missing"),
            "sensors": [{"id": k, "label": v[0], "value": v[1]} for k, v in sensors.items()]}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj):
        self._send(200, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        route = unquote(self.path.split("?", 1)[0])
        if route == "/hw.json":
            self._json(snapshot())
        elif route == "/sensors":
            self._json(debug_dump())
        elif route in ("/", "/index.html", "/" + HTML_FILE.name):
            try:
                self._send(200, HTML_FILE.read_bytes(), "text/html; charset=utf-8")
            except OSError:
                self._send(404, b"monitor html not found", "text/plain")
        else:
            self._send(404, b"not found", "text/plain")


if __name__ == "__main__":
    s = snapshot()
    print(f"AIDA64 共享内存 -> http://127.0.0.1:{PORT}/   调试: /sensors")
    if not s.get("ok"):
        print(f"  !! {s.get('error')}")
    else:
        print(f"  AIDA64 导出 {s['exported']} 个传感器，共享内存 {s['shm']['bytes']}/{SHM_SIZE} "
              f"= {s['shm']['pct']}%，活动网卡 {s['net']['active_nics']}")
        if s["shm"]["pct"] > 90:
            print("  !! 共享内存快满了：AIDA64 会静默截断最后的条目，请去掉几个传感器")
        if s["missing"]:
            print(f"  缺少: {', '.join(s['missing'])}")
            print(f"  请到 AIDA64 -> 首选项 -> 硬件监视工具 -> 外部程序 里勾选上面这些 ID")
        else:
            print("  所需传感器齐全")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
