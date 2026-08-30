# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller onedir 打包配置。

用 onedir 而不是 onefile：onefile 每次启动都要把自身解压到临时目录（1~3 秒），
OBS 浏览器源在这期间拿不到响应会黑屏。onefile 只适合当安装引导。

数据文件的落点必须和 hwobs/paths.py 的 resource() 约定一致：
冻结后 sys._MEIPASS 指向 _internal/，所以 'monitor.html' 的目的地是 '.'。
"""

from PyInstaller.utils.hooks import collect_submodules

import pathlib
import sys

sys.path.insert(0, SPECPATH)
from hwobs import __version__          # noqa: E402

ROOT = pathlib.Path(SPECPATH)
FRONTEND_DIST = ROOT / "frontend" / "dist"

datas = [
    ('monitor.html', '.'),
    ('overlays', 'overlays'),
    ('hwobs/registry/metrics.json', 'hwobs/registry'),
]
if FRONTEND_DIST.is_dir():
    datas.append(('frontend/dist', 'frontend/dist'))

# uvicorn 的动态导入子模块 PyInstaller 检测不到，必须显式列
hiddenimports = collect_submodules('hwobs') + [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
]

a = Analysis(
    ['hw_server.py'],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=['tkinter', 'unittest', 'pydoc', 'pytest'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='HWOverlay',
    debug=False,
    strip=None,
    upx=False,
    console=False,            # 无控制台窗口；异常一律落 crash.log
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=None,
    upx=False,
    name=f'HWOverlay-{__version__}-win64',
)
