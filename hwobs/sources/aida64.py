"""AIDA64 的 RTSS 具名共享内存源。

AIDA64 把 aida64.ini 里 HWMonExtAppItems 列出的传感器写成一块 4096 字节的 UTF-8 XML，
形如 <temp><id>TGPU1</id><label>GPU</label><value>35</value></temp>。三个坑：

- 只有 HWMonExtAppItems 列出的 ID 才会出现，得用户（或本软件）先去 AIDA64 里勾选。
- 总量固定 4096 字节，约 60 条封顶，写满后末尾条目被**静默截断、不报错**。
- XML 里没有单位字段，速率类传感器的单位随数量级自动跳变，不可靠。

共享内存随 AIDA64 进程存活，所以读成功本身就等于"AIDA64 在线"。
"""

import ctypes
import re
from ctypes import wintypes

SHM_NAME = "AIDA64_SensorValues"
SHM_SIZE = 4096

ENTRY_RX = re.compile(r"<[a-z]+><id>([^<]+)</id><label>([^<]*)</label><value>([^<]*)</value>")

_k32 = ctypes.windll.kernel32
_k32.OpenFileMappingW.restype = ctypes.c_void_p
_k32.OpenFileMappingW.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
_k32.MapViewOfFile.restype = ctypes.c_void_p
_k32.MapViewOfFile.argtypes = [ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_size_t]
_k32.UnmapViewOfFile.argtypes = [ctypes.c_void_p]


def read_sensors():
    """返回 ({传感器ID: (标签, 原始值)}, 已用字节数)。AIDA64 没运行时返回 (None, 0)。"""
    handle = _k32.OpenFileMappingW(0x0004, False, SHM_NAME)
    if not handle:
        return None, 0
    ptr = _k32.MapViewOfFile(handle, 0x0004, 0, 0, 0)
    text = ""
    try:
        if not ptr:
            return None, 0
        text = ctypes.string_at(ptr, SHM_SIZE).decode("utf-8", "replace").split("\x00")[0]
    finally:
        if ptr:
            _k32.UnmapViewOfFile(ptr)
        _k32.CloseHandle(handle)
    sensors = {sid: (label, value) for sid, label, value in ENTRY_RX.findall(text)}
    return sensors, len(text.encode("utf-8"))
