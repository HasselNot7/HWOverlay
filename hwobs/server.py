"""HTTP 服务层。

叠加层页面在 `/`（OBS 用的就是这个），`/monitor.html` 是同页别名；数据侧 `/hw.json`
和调试侧 `/sensors` 与拆分前保持一致。管理页与 /api/* 在 M5 加入。
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from . import overlay, registry

ROOT = Path(__file__).resolve().parent.parent
HTML_FILE = ROOT / "monitor.html"
OVERLAY_FILE = ROOT / "overlays" / "monitor.json"


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

    def _json(self, obj):
        self._send(200, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        route = unquote(self.path.split("?", 1)[0])
        if route == "/hw.json":
            self._json(overlay.snapshot())
        elif route == "/overlay.json":
            self._json(self._overlay_config())
        elif route == "/metrics.json":
            self._json(registry.load())
        elif route == "/sensors":
            self._json(overlay.debug_dump())
        elif route in ("/", "/index.html", "/" + HTML_FILE.name):
            try:
                self._send(200, HTML_FILE.read_bytes(), "text/html; charset=utf-8")
            except OSError:
                self._send(404, b"monitor html not found", "text/plain")
        else:
            self._send(404, b"not found", "text/plain")

    @staticmethod
    def _overlay_config():
        return json.loads(OVERLAY_FILE.read_text(encoding="utf-8"))


def create_server(port):
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)
