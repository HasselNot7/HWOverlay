"""资源与可写配置的定位。

开发态两者都是仓库根，所以现有的 overlays/monitor.json 不用搬家，测试也照旧能跑。
打包后：
  - 只读资源在 sys._MEIPASS（onefile 模式那是临时解压目录，**不能往里写**）
  - 可写配置在 %LOCALAPPDATA%\\HWOverlay，首次运行时从包内默认值复制过去
"""

import os
import shutil
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))


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


def overlay_default(name):
    """包内自带的版式默认值（只读）。"""
    return resource_root() / "overlays" / f"{name}.json"


def ensure_overlay(name):
    """可写副本不存在就从默认值复制一份。返回可写路径。"""
    target = overlay_path(name)
    src = overlay_default(name)
    if not target.exists() and src.is_file() and src.resolve() != target.resolve():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
    return target
