"""aida64.ini 的定点读写。

这个文件是 UTF-16LE + BOM、CRLF 换行、2.3MB、7900+ 键，而且是 AIDA64 自己的配置。
所以规矩只有一条：**除了我们要改的那一行，其余字节必须原样不动**。
任何"解析成 dict 再序列化回去"的做法都会重排键序、丢掉 AIDA64 不认识的内容。
"""

import re
import shutil
import subprocess
from pathlib import Path

ENCODING = "utf-16"
ITEMS_KEY = "HWMonExtAppItems"
FREQ_KEY = "HWMonUpdateFreqExtApp"


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


def dump(lines):
    return "\r\n".join(lines)


def _write(ini_path, text):
    with open(ini_path, "w", encoding=ENCODING, newline="") as f:
        f.write(text)


def get_items(lines, key=ITEMS_KEY):
    for line in lines:
        if line.startswith(key + "="):
            return line[len(key) + 1:].split()
    return []


def replace_line(lines, key, value):
    """替换 key=value 那一行；不存在就返回原样副本（调用方据此判断失败）。"""
    prefix = key + "="
    out = list(lines)
    for i, line in enumerate(out):
        if line.startswith(prefix):
            out[i] = prefix + value
            return out, True
    return out, False


def set_items(ini_path, ids, backup=True):
    """把 HWMonExtAppItems 写成 ids，其余字节不动。返回 (备份路径, 是否命中键)。

    注意：AIDA64 运行中改 ini 会在它退出时被整体覆盖，所以调用方必须先停进程
    （见 aida/controller.py 的状态机），这里不做任何进程操作。
    """
    ini_path = Path(ini_path)
    lines = load(ini_path)
    new_lines, hit = replace_line(lines, ITEMS_KEY, " ".join(ids))
    if not hit:
        raise KeyError(f"{ini_path} 里找不到 {ITEMS_KEY}= 这一行，拒绝改写")
    bak = None
    if backup:
        bak = ini_path.with_suffix(".ini.hwobs-backup")
        shutil.copy2(ini_path, bak)
    _write(ini_path, dump(new_lines))
    return bak, hit


def verify_untouched(ini_path, before_lines, key=ITEMS_KEY):
    """回读并断言：除了目标键，其余行与写入前完全一致。"""
    after = load(ini_path)
    if len(after) != len(before_lines):
        return False, f"行数变了：{len(before_lines)} -> {len(after)}"
    diffs = [(i, a, b) for i, (a, b) in enumerate(zip(before_lines, after)) if a != b]
    bad = [d for d in diffs if not d[1].startswith(key + "=")]
    if bad:
        return False, f"有 {len(bad)} 行非目标键被改动，首行 {bad[0][1][:60]!r}"
    return True, f"仅 {key} 一行变化（共 {len(diffs)} 行）"
