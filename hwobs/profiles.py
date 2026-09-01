"""多版式档位：把已发布的版式存成命名档位，一键切换生效。

对应 Now Playing 的「配置 A–D」思路 —— 不同直播场景（全屏 / 角落 / 竖屏）各存一套，
切场景时一键换。模型：

- 每档 = overlays/profiles/<名字>.json（可写数据目录，打包后在 %LOCALAPPDATA%）。
- 当前生效档 = overlays/profiles/.active（一个存名字的文本标记）。
- 「另存为档位」= 把当前已发布版式（monitor.json）快照成一份档位。
- 「切换档位」= 把档位内容经 config.save 通道写回 monitor.json（天然继承校验/备份/回滚）。

档位名当文件名用，必须过安全校验（挡路径穿越）。
"""

import json
import re

from . import config, paths

PROFILES_DIR = paths.data_root() / "overlays" / "profiles"
ACTIVE_FILE = PROFILES_DIR / ".active"

# 档位名：中文/字母/数字/空格/-_，1~40 字符；关键是绝不含路径分隔符或 ..
_NAME_RE = re.compile(r"^[^/\\:*?\"<>|.\x00-\x1f]{1,40}$")


def _valid_name(name):
    name = (name or "").strip()
    if not name or not _NAME_RE.match(name) or ".." in name:
        return None
    return name


def _path(name):
    return PROFILES_DIR / f"{name}.json"


def _read_active():
    if ACTIVE_FILE.is_file():
        return ACTIVE_FILE.read_text(encoding="utf-8").strip() or None
    return None


def _write_active(name):
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    if name:
        ACTIVE_FILE.write_text(name, encoding="utf-8")
    elif ACTIVE_FILE.is_file():
        ACTIVE_FILE.unlink()


def list_all():
    """列出所有档位 + 哪个生效 + 生效档是否已被后续保存改动。"""
    if not PROFILES_DIR.is_dir():
        return {"profiles": [], "active": None}
    active = _read_active()
    try:
        current = config.read(config.OVERLAY_FILE)
    except Exception:      # noqa: BLE001 当前版式读不到就不比对 modified
        current = None
    out = []
    for f in sorted(PROFILES_DIR.glob("*.json")):
        name = f.stem
        modified = False
        if name == active and current is not None:
            try:
                modified = json.loads(f.read_text(encoding="utf-8")) != current
            except Exception:      # noqa: BLE001
                modified = False
        out.append({"name": name, "active": name == active, "modified": modified})
    return {"profiles": out, "active": active}


def save(name):
    """把当前已发布版式快照成一个新档位，并设为生效。返回 (档位, 错误)。"""
    name = _valid_name(name)
    if not name:
        return None, "档位名不合法（不能含 / \\ : * ? \" < > | . 或为空，最长 40 字）"
    try:
        current = config.read(config.OVERLAY_FILE)
    except Exception as e:      # noqa: BLE001
        return None, f"读不到当前版式：{e}"
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    _path(name).write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    _write_active(name)
    return {"name": name, "active": True, "modified": False}, None


def activate(name):
    """切换生效档位：把档位内容写回 monitor.json（走 config.save：校验/备份/原子替换）。"""
    name = _valid_name(name)
    if not name:
        return None, "档位名不合法"
    p = _path(name)
    if not p.is_file():
        return None, f"没有这个档位：{name}"
    try:
        cfg = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:      # noqa: BLE001
        return None, f"档位文件损坏：{e}"
    saved, rep = config.save(cfg, config.OVERLAY_FILE)
    if not saved:
        return None, "切换失败（版式校验没过）：" + "；".join(rep.get("errors", []))
    _write_active(name)
    return {"name": name, "active": True, "modified": False}, None


def remove(name):
    """删除档位；若删的是生效档，清掉 active 标记（不碰 monitor.json）。"""
    name = _valid_name(name)
    if not name:
        return False, "档位名不合法"
    p = _path(name)
    if not p.is_file():
        return False, f"没有这个档位：{name}"
    p.unlink()
    if _read_active() == name:
        _write_active(None)
    return True, None
