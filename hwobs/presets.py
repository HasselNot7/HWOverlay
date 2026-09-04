"""版式模板库：可选的只读内置模板 + 可写用户模板。

- 内置：overlays/presets.json —— 机制保留但默认不随包分发；
  文件不存在时内置侧为空列表，模板库只显示用户自己的模板。
- 用户：overlays/user_presets.json（可写数据目录 —— 开发态在仓库，
  打包后在 %LOCALAPPDATA%\\Now-Monitor），编辑器里"存为模板 / 导入文件"写这里，
  升级换包不丢自己的模板。

条目形状与内置一致：{id, name, desc, config}；对外列表统一带 source 标记。
"""

import json
import time

from . import config, paths

BUILTIN_FILE = paths.resource("overlays/presets.json")
USER_FILE = paths.overlay_path("user_presets")


def _read_file(path):
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("presets"), list):
        return []
    return data["presets"]


def _write_user(presets):
    USER_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = USER_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"presets": presets}, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    tmp.replace(USER_FILE)


def list_all():
    """内置在前、用户模板在后；任何一边的文件坏了都不炸整个端点，返回能读到的部分。"""
    out = []
    for path, src in ((BUILTIN_FILE, "builtin"), (USER_FILE, "user")):
        try:
            items = _read_file(path)
        except Exception:      # noqa: BLE001
            continue
        out += [{**p, "source": src} for p in items if isinstance(p, dict)]
    return out


def add(spec):
    """把一份版式存成用户模板。返回 (条目, 错误)；错误时条目为 None。

    不信任来路（导入的文件可能手写/手改），保存前先过一遍完整校验。"""
    spec = spec if isinstance(spec, dict) else {}
    name = str(spec.get("name") or "").strip()[:40]
    desc = str(spec.get("desc") or "").strip()[:120]
    cfg = spec.get("config")
    if not name:
        return None, "模板要有名字"
    if not isinstance(cfg, dict):
        return None, "缺少 config（版式本体）"
    rep = config.validate(cfg)
    if not rep.get("ok"):
        return None, "版式校验没通过：" + "；".join((rep.get("errors") or [])[:4])
    entry = {
        "id": f"u-{time.time_ns()}",
        "name": name,
        "desc": desc,
        "config": cfg,
    }
    try:
        presets = _read_file(USER_FILE)
    except Exception:      # noqa: BLE001 用户文件坏了不能连累保存，重置为空再写
        presets = []
    presets.append(entry)
    _write_user(presets)
    return entry, None


def remove(preset_id):
    """只能删用户模板。返回是否删掉了。"""
    try:
        presets = _read_file(USER_FILE)
    except Exception:      # noqa: BLE001
        return False
    kept = [p for p in presets if p.get("id") != preset_id]
    if len(kept) == len(presets):
        return False
    _write_user(kept)
    return True
