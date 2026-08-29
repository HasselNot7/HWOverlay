"""HTTP 服务层。

叠加层页面在 `/`（OBS 用的就是这个），`/monitor.html` 是同页别名；数据侧 `/hw.json`、
调试侧 `/sensors`、校验侧 `/api/layout-check`。管理页在 M5 加入。
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from . import config, overlay, registry
from .aida import controller
from .sources import winapi

ROOT = Path(__file__).resolve().parent.parent
HTML_FILE = ROOT / "monitor.html"
OVERLAY_FILE = config.OVERLAY_FILE
WEB_DIR = Path(__file__).resolve().parent / "web"
read_overlay_config = config.read


def layout_report():
    """版式校验 + 导出预算。管理页、启动横幅、写入前预检共用同一份判定。"""
    return config.validate(read_overlay_config())


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def _body_json(self):
        """读请求体。限 64KB —— 版式配置远小于这个数，超了就是乱发。"""
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= 64 * 1024:
            return None, f"请求体大小非法（{length} 字节）"
        try:
            return json.loads(self.rfile.read(length).decode("utf-8")), None
        except ValueError as e:
            return None, f"不是合法 JSON：{e}"

    def do_GET(self):
        route = unquote(self.path.split("?", 1)[0])
        if route == "/hw.json":
            self._json(overlay.snapshot())
        elif route == "/overlay.json":
            self._json(read_overlay_config())
        elif route == "/metrics.json":
            self._json(registry.load())
        elif route == "/api/layout-check":
            self._json(layout_report())
        elif route == "/api/aida/status":
            st = controller.status()
            st["windows_net_sampler"] = winapi.net_state()
            self._json(st)
        elif route == "/sensors":
            self._json(overlay.debug_dump())
        elif route in ("/", "/index.html", "/" + HTML_FILE.name):
            self._file(HTML_FILE, "text/html; charset=utf-8")
        elif route in ("/admin", "/admin/", "/admin.html"):
            self._file(WEB_DIR / "admin.html", "text/html; charset=utf-8")
        elif route in ("/admin.js", "/admin.css"):
            name = route.rsplit("/", 1)[-1]
            kind = "text/javascript; charset=utf-8" if name.endswith(".js") else "text/css; charset=utf-8"
            self._file(WEB_DIR / name, kind)
        else:
            self._send(404, b"not found", "text/plain")

    def do_PUT(self):
        if unquote(self.path.split("?", 1)[0]) != "/api/config":
            return self._send(404, b"not found", "text/plain")
        cfg, err = self._body_json()
        if err:
            return self._json({"saved": False, "errors": [err]}, 400)
        try:
            saved, rep = config.save(cfg)
        except Exception as e:      # noqa: BLE001 - 不能让异常掐断连接
            return self._json({"saved": False, "errors": [f"服务端处理失败：{e}"]}, 500)
        self._json({"saved": saved, **rep}, 200 if saved else 400)

    def do_POST(self):
        route = unquote(self.path.split("?", 1)[0])
        if route == "/api/layout-check":
            cfg, err = self._body_json()
            if err:
                return self._json({"errors": [err], "warnings": [], "ok": False}, 400)
            try:
                return self._json(config.validate(cfg))
            except Exception as e:      # noqa: BLE001
                return self._json({"errors": [f"校验失败：{e}"], "warnings": [], "ok": False}, 500)
        if route != "/api/config/rollback":
            return self._send(404, b"not found", "text/plain")
        try:
            ok, rep = config.rollback()
        except Exception as e:      # noqa: BLE001
            return self._json({"restored": False, "errors": [f"回滚失败：{e}"]}, 500)
        if not ok:
            return self._json({"restored": False, "errors": ["没有 .bak 可回滚"]}, 409)
        self._json({"restored": True, **rep})

    def _file(self, path, ctype):
        try:
            self._send(200, path.read_bytes(), ctype)
        except OSError:
            self._send(404, f"{path.name} not found".encode(), "text/plain; charset=utf-8")


def create_server(port):
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)
