"""aida64.ini 的**只读**访问。

这个文件是 UTF-16LE + BOM、CRLF 换行、2.3MB、7900+ 键，而且是 AIDA64 自己的配置：
HWMonExtAppItems 列着它写进共享内存的传感器，OSD、看板等其他软件也在读同一份。
所以本模块只提供读取（load/get_items）；**不提供任何写回** —— 删谁留谁由用户自己定。
要补传感器时，plan_export() 会拼好一条完整的 HWMonExtAppItems 行让用户自己粘贴：
改 ini 必须先关 AIDA64（它退出时会把整份配置写回去，运行中改的会被覆盖）。
"""

import subprocess
from pathlib import Path

ENCODING = "utf-16"
ITEMS_KEY = "HWMonExtAppItems"


def find_install():
    """从正在运行的进程反查安装目录；没运行则返回 None。只读，不启停进程。"""
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-Process aida64 -ErrorAction SilentlyContinue | Select-Object -First 1 -Expand Path"],
        capture_output=True, text=True).stdout.strip()
    return Path(out).parent if out else None


def load(ini_path):
    """返回按 CRLF 拆开的行列表（原样，不解析）。

    必须禁用换行归一化：read_text() 默认把 CRLF 变成 LF，
    每行少 2 字节且 split("\r\n") 会切不出行。
    """
    with open(ini_path, encoding=ENCODING, newline="") as f:
        return f.read().split("\r\n")


def get_items(lines, key=ITEMS_KEY):
    for line in lines:
        if line.startswith(key + "="):
            return line[len(key) + 1:].split()
    return []
