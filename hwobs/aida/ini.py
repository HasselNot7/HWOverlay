"""aida64.ini 的**只读**访问。

这个文件是 UTF-16LE + BOM、CRLF 换行、2.3MB、7900+ 键，而且是 AIDA64 自己的配置：
HWMonExtAppItems 列着它写进共享内存的传感器，OSD、看板等其他软件也在读同一份。
所以本模块只提供读取（load/get_items）；**不提供任何写回** —— 删谁留谁由用户自己定。
要补传感器时，plan_export() 会拼好一条完整的 HWMonExtAppItems 行让用户自己粘贴：
改 ini 必须先关 AIDA64（它退出时会把整份配置写回去，运行中改的会被覆盖）。
"""

import locale
import subprocess
from pathlib import Path

ENCODING = "utf-16"
ITEMS_KEY = "HWMonExtAppItems"


def install_from_path(out):
    """把 PowerShell 查到的 aida64.exe 全路径转成安装目录。纯函数，不碰进程。"""
    out = (out or "").strip()
    return Path(out).parent if out else None


def load(ini_path):
    """返回按 CRLF 拆开的行列表（原样，不解析）。

    必须禁用换行归一化：read_text() 默认把 CRLF 变成 LF，
    每行少 2 字节且 split("\r\n") 会切不出行。
    编码：AIDA64 标准是 UTF-16LE+BOM，但别的机器上见过 UTF-8/ANSI 变体 ——
    按 BOM 探测，退 utf-8 再退本地编码（中文系统是 GBK），坏字容忍：
    这里只取 HWMonExtAppItems 等键行，全是 ASCII，错别字不影响结果，
    无论如何不能抛异常（状态接口要靠它显示真实原因）。
    """
    raw = Path(ini_path).read_bytes()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text = raw.decode("utf-16", errors="replace")
    else:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode(locale.getpreferredencoding(False) or "gbk",
                              errors="replace")
    return text.split("\r\n")


def get_items(lines, key=ITEMS_KEY):
    for line in lines:
        if line.startswith(key + "="):
            return line[len(key) + 1:].split()
    return []
