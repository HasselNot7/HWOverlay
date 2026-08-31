"""打包脚本：`python scripts/build.py` 产出一个可直接分发的 onedir zip。

不会自动 pip install —— 装依赖属于改你的环境，得你点头。
"""

import importlib.util
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # scripts/build.py 的上一级才是仓库根


def build_frontend() -> int:
    """构建 React 管理页（构建期需要 Node.js；运行期产物是静态文件，不需要）。"""
    fe = ROOT / "frontend"
    if not (fe / "package.json").is_file():
        print("没有 frontend/，跳过前端构建")
        return 0
    npm = shutil.which("npm")
    if not npm:
        print("找不到 npm（构建管理页需要 Node.js）。")
        print("  - 已有 frontend/dist 的话可以跳过：直接 python scripts/build.py --skip-frontend")
        print("  - 或者装好 Node.js 再来")
        return 1
    if not (fe / "node_modules").is_dir():
        print("npm ci（装前端依赖，第一次比较慢）...")
        if subprocess.run([npm, "ci"], cwd=fe).returncode:
            return 1
    print("npm run build（构建管理页）...")
    return subprocess.run([npm, "run", "build"], cwd=fe).returncode


def main():
    if importlib.util.find_spec("PyInstaller") is None:
        print("缺 PyInstaller。装一下再跑（它是构建期依赖，运行期不需要）：\n")
        print("    python -m pip install pyinstaller\n")
        return 1

    if "--skip-frontend" not in sys.argv:
        r = build_frontend()
        if r:
            return r

    print("pyinstaller --clean --noconfirm hwobs.spec")
    r = subprocess.run([sys.executable, "-m", "PyInstaller", "--clean", "--noconfirm", "hwobs.spec"],
                       cwd=ROOT)
    if r.returncode:
        print("打包失败，看上面的输出。")
        return r.returncode

    sys.path.insert(0, str(ROOT))
    from hwobs import __version__
    out = ROOT / "dist" / f"HWOverlay-{__version__}-win64"
    if not out.is_dir():
        print(f"没找到产物目录 {out}")
        return 1

    zip_path = ROOT / "dist" / f"HWOverlay-{__version__}-win64.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(out.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(out.parent).as_posix())

    print(f"\n产物：{zip_path}  （{zip_path.stat().st_size / 1024 / 1024:.1f} MB）")
    print("解压后双击 HWOverlay.exe：会自动开浏览器到管理页，按「开始使用」完成配置。")
    print('首次运行未签名，Windows SmartScreen 会拦一下：点"更多信息"→"仍要运行"。')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
