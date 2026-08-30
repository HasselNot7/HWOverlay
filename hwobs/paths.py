"""资源与可写配置的定位。

开发态两者都是仓库根，所以现有的 overlays/monitor.json 不用搬家，测试也照旧能跑。
打包后：
  - 只读资源在 sys._MEIPASS（onefile 模式那是临时解压目录，**不能往里写**）
  - 可写配置在 %LOCALAPPDATA%\\HWOverlay，首次运行时生成空白版式
    （分发场景每块屏幕尺寸都不同，默认给空画布 + 编辑器里的"加载默认样式"按钮）
"""

import json
import os
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))

# 首次运行生成的空白版式：只留画布和装饰性命令行，部件等用户自己加
EMPTY_LAYOUT = {
    "version": 2,
    "name": "monitor",
    "canvas": {"w": 1920, "h": 200, "theme": "nord-console", "padding": [12, 24]},
    "prompt": {
        "user": "streamer@pc",
        "cmd": "./sysmon --source=aida64 --interval=1s",
        "cursor": True,
        "size": 19,
    },
    "widgets": [],
}


def resource_root():
    """只读资源（页面、注册表、默认版式）所在目录。"""
    if FROZEN:
        return Path(getattr(sys, "_MEIPASS", str(Path(sys.executable).parent)))
    return Path(__file__).resolve().parent.parent


def data_root():
    """可写配置目录。开发态就是仓库根，避免两套文件来回分叉。"""
    if not FROZEN:
        return resource_root()
    base = Path(os.environ.get("LOCALAPPDATA") or str(Path.home())) / "HWOverlay"
    base.mkdir(parents=True, exist_ok=True)
    return base


def resource(rel):
    return resource_root() / rel


def overlay_path(name):
    """版式配置的可写路径。"""
    return data_root() / "overlays" / f"{name}.json"


def ensure_overlay(name):
    """可写副本不存在就生成空白版式（不再复制包内默认 —— 那份现在是编辑器里的预设）。
    返回可写路径。"""
    target = overlay_path(name)
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(EMPTY_LAYOUT, ensure_ascii=False, indent=2) + "\n",
                          encoding="utf-8")
    return target
