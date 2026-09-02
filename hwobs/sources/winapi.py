"""纯 Windows 自带能力就能拿到的指标：不占 AIDA64 的 4096 字节导出名额，
AIDA64 没装或没跑时也还有值。

网卡吞吐为什么不用 iphlpapi 的 GetIfTable：实测本机返回的 49 行**全部**是
`TCPIP_*` 伪接口行（没有物理网卡行可筛），其中 5 行镜像同一份流量，
求和会重复计数约 5 倍（与 PowerShell 对拍实测比值 0.19 ≈ 1/5）。
所以改用 Get-NetAdapterStatistics。它单次调用约 1.3 秒，必须放后台线程，
否则会把叠加层每秒一次的刷新堵死。
"""

import ctypes
import subprocess
import threading
import time

_k32 = ctypes.windll.kernel32

# windowed 打包的 exe 起 powershell.exe 会闪出终端窗口（Win11 上是
# Windows Terminal），采样线程每 3 秒一次闪得尤其明显 —— CREATE_NO_WINDOW 压掉
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

NET_SAMPLE_INTERVAL = 3.0
_POWERSHELL = (
    "(Get-NetAdapterStatistics|Measure-Object -Property SentBytes -Sum).Sum;"
    "(Get-NetAdapterStatistics|Measure-Object -Property ReceivedBytes -Sum).Sum"
)


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
    """返回 (已用GB, 总量GB, 百分比)；调用失败时三项均为 None。"""
    st = MemoryStatusEx()
    st.dwLength = ctypes.sizeof(st)
    if not _k32.GlobalMemoryStatusEx(ctypes.byref(st)):
        return None, None, None
    gb = 1024 ** 3
    total = st.ullTotalPhys / gb
    used = (st.ullTotalPhys - st.ullAvailPhys) / gb
    return round(used, 1), round(total, 1), round(used / total * 100, 1)


def net_bytes_total():
    """所有网卡累计 (发送字节, 接收字节)。取不到时抛 RuntimeError。"""
    out = subprocess.run(["powershell", "-NoProfile", "-Command", _POWERSHELL],
                         capture_output=True, text=True,
                         creationflags=_NO_WINDOW).stdout.split()
    if len(out) < 2:
        raise RuntimeError(f"取不到网卡计数：{out!r}")
    return int(float(out[0])), int(float(out[1]))


# --- 后台采样：把 1.3 秒的 PowerShell 调用挪出请求路径 ---

_LOCK = threading.Lock()
_STATE = {"last": None, "last_t": None, "up_mbps": None, "down_mbps": None, "error": None}
_THREAD = None


def _sample_once():
    try:
        now = net_bytes_total()
    except Exception as e:      # noqa: BLE001 - 兜底源失败绝不能拖垮主链路
        with _LOCK:
            _STATE["error"] = str(e)[:160]
        return
    t = time.time()
    with _LOCK:
        prev, prev_t = _STATE["last"], _STATE["last_t"]
        _STATE["last"], _STATE["last_t"], _STATE["error"] = now, t, None
        if prev and prev_t and t > prev_t:
            d_tx, d_rx = now[0] - prev[0], now[1] - prev[1]
            if d_tx >= 0 and d_rx >= 0:      # 计数器回绕时这一轮直接跳过
                span = t - prev_t
                _STATE["up_mbps"] = round(d_tx * 8 / span / 1e6, 2)
                _STATE["down_mbps"] = round(d_rx * 8 / span / 1e6, 2)


def start_net_sampler(interval=NET_SAMPLE_INTERVAL):
    """幂等启动后台采样线程。只在 AIDA64 供不上网卡速率时才调用。

    check-and-start 全程持锁：/hw.json 每秒被 OBS 轮询，同步端点跑线程池，
    并发调用若锁外建线程会起出多个采样线程、PowerShell 翻倍拉起。
    首次采样也放进线程里（PowerShell 单次约 1.3 秒，不能堵请求路径），
    采满两轮之前 net_mbps() 是 (None, None)，指标先显示 --。
    """
    global _THREAD
    with _LOCK:
        if _THREAD and _THREAD.is_alive():
            return _THREAD
        _THREAD = threading.Thread(target=_loop, args=(interval,), daemon=True, name="net-sampler")
        _THREAD.start()
        return _THREAD


def _loop(interval):
    # 先采后睡：线程一启动就补第一个样本，而不是白等一个周期
    while True:
        _sample_once()
        time.sleep(interval)


def net_mbps():
    """返回 (上行Mbps, 下行Mbps)；还没采满两轮时是 (None, None)。"""
    with _LOCK:
        return _STATE["up_mbps"], _STATE["down_mbps"]


def net_state():
    """给管理页/诊断用：采样线程状态与最近一次错误。"""
    with _LOCK:
        return {"sampling": bool(_THREAD and _THREAD.is_alive()), "error": _STATE["error"],
                "up_mbps": _STATE["up_mbps"], "down_mbps": _STATE["down_mbps"],
                "samples": 2 if _STATE["up_mbps"] is not None else (1 if _STATE["last"] else 0)}
