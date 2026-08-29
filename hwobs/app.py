"""命令行入口：`python -m hwobs.app` 或 hw_server.py 的 shim 调用。"""

from . import overlay, server
from .sources import aida64

PORT = 8765


def print_banner():
    s = overlay.snapshot()
    print(f"AIDA64 共享内存 -> http://127.0.0.1:{PORT}/   调试: /sensors")
    if not s.get("ok"):
        print(f"  !! {s.get('error')}")
        return
    print(f"  AIDA64 导出 {s['exported']} 个传感器，共享内存 {s['shm']['bytes']}/{aida64.SHM_SIZE} "
          f"= {s['shm']['pct']}%，活动网卡 {s['net']['active_nics']}")
    if s["shm"]["pct"] > 90:
        print("  !! 共享内存快满了：AIDA64 会静默截断最后的条目，请去掉几个传感器")
    if s["missing"]:
        print(f"  缺少: {', '.join(s['missing'])}")
        print("  请到 AIDA64 -> 首选项 -> 硬件监视工具 -> 外部程序 里勾选上面这些 ID")
    else:
        print("  所需传感器齐全")


def main():
    print_banner()
    server.create_server(PORT).serve_forever()


if __name__ == "__main__":
    main()
