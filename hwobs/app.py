"""命令行入口：`python -m hwobs.app` 或 hw_server.py 的 shim 调用。"""

import os
import socket
import sys
import webbrowser

import uvicorn

from . import config, overlay, paths
from .api import create_app
from .sources import aida64

PORT = 8765


def print_banner(port):
    s = overlay.snapshot()
    print(f"AIDA64 共享内存 -> http://127.0.0.1:{port}/   管理页 /admin   调试 /sensors")
    rep = config.validate(config.read())
    for e in rep["errors"]:
        print(f"  !! 版式错误: {e}")
    for w in rep["warnings"]:
        print(f"  ~~ 版式提醒: {w}")
    if not s.get("ok"):
        print(f"  !! {s.get('error')}")
        return
    print(f"  AIDA64 导出 {s['exported']} 个传感器，共享内存 {s['shm']['bytes']}/{aida64.SHM_SIZE} "
          f"= {s['shm']['pct']}%，活动网卡 {s['net']['active_nics']}")
    if s["shm"]["pct"] > 90:
        print("  !! 共享内存快满了：AIDA64 会静默截断最后的条目，请去掉几个传感器")
    if s["missing"]:
        print(f"  缺少: {', '.join(s['missing'])}")
        print("  请自己在 AIDA64 里把传感器加进共享内存导出清单（管理页「开始使用」里有对照表和可复制的补全清单）")
    else:
        print("  所需传感器齐全")


def bind_port(start=PORT, tries=6):
    """端口被占就往后退。OBS 里的 URL 取决于最终端口，所以调用方必须把它显示出来。"""
    for i in range(tries):
        port = start + i
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
        return port
    raise SystemExit(f"端口 {start}-{start + tries - 1} 全被占用，服务没起来")


def already_running():
    """命名互斥量判是否已有实例。双击两次 exe 会起两个服务，第二个退到备用端口，
    而 OBS 读的还是第一个 —— 用户只看到"管理页怎么和画面不一样"。"""
    import ctypes
    ERROR_ALREADY_EXISTS = 183
    handle = ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\HWOverlay.single")
    return ctypes.windll.kernel32.GetLastError() == ERROR_ALREADY_EXISTS, handle


def main():
    # windowed 打包（console=False）双击运行时没有 stdout/stderr（是 None），
    # uvicorn 的日志格式化器会调 sys.stdout.isatty() 直接崩
    # （ValueError: Unable to configure formatter 'default'）。挂到 devnull 兜底；
    # 带控制台的启动（python hw_server.py、重定向）不受影响。
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    paths.ensure_overlay("monitor")
    running, _keep = already_running()
    if running:
        print("已经有一个 HWOverlay 在跑了，直接打开管理页。")
        webbrowser.open(f"http://127.0.0.1:{PORT}/admin")
        return
    port = bind_port()
    print_banner(port)
    if port != PORT:
        print(f"  !! 注意：默认端口 {PORT} 被占用，本次实际用 {port}，OBS 里的 URL 要跟着改")
    if paths.FROZEN or "--open" in sys.argv:
        webbrowser.open(f"http://127.0.0.1:{port}/admin")
    app = create_app()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    app.state.uvicorn_server = server    # 管理页的"退出程序"按钮优雅停服用
    server.run()


if __name__ == "__main__":
    main()
