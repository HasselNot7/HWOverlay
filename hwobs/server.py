"""HTTP 服务层。

叠加层页面在 `/`（OBS 用的就是这个），`/monitor.html` 是同页别名；数据侧 `/hw.json`、
调试侧 `/sensors`、校验侧 `/api/layout-check`。管理页在 M5 加入。
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from . import layout, overlay, registry
from .aida import controller

ROOT = Path(__file__).resolve().parent.parent
HTML_FILE = ROOT / "monitor.html"
OVERLAY_FILE = ROOT / "overlays" / "monitor.json"


def read_overlay_config():
    return json.loads(OVERLAY_FILE.read_text(encoding="utf-8"))


def layout_report():
    """版式校验 + 导出预算。管理页和启动横幅共用同一份判定，避免两套标准。"""
    cfg = read_overlay_config()
    ids, plan = controller.propose(cfg)
    rep = layout.check(cfg, plan=plan)
    rep["needed_ids"] = ids
    rep["budget"] = {k: plan[k] for k in ("count", "usable", "worst_bytes",
                                          "typical_bytes", "fits", "truncated_at")}
    return rep


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
            self._json(read_overlay_config())
        elif route == "/metrics.json":
            self._json(registry.load())
        elif route == "/api/layout-check":
            self._json(layout_report())
        elif route == "/sensors":
            self._json(overlay.debug_dump())
        elif route in ("/", "/index.html", "/" + HTML_FILE.name):
            try:
                self._send(200, HTML_FILE.read_bytes(), "text/html; charset=utf-8")
            except OSError:
                self._send(404, b"monitor html not found", "text/plain")
        else:
            self._send(404, b"not found", "text/plain")


def create_server(port):
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)
