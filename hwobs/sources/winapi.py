"""纯 Windows API 源：不装任何第三方程序也能拿到的指标，且不占 AIDA64 的导出名额。"""

import ctypes

_k32 = ctypes.windll.kernel32


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
