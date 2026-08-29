"""兼容入口：实现已搬到 hwobs/ 包，本文件只让原来的启动命令继续可用。

    python hw_server.py      # 旧命令，仍然可用
    python -m hwobs.app      # 等价的新写法
"""

from hwobs.app import main

if __name__ == "__main__":
    main()
