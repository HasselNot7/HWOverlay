"""HTTP 服务层。

叠加层页面在 `/`（OBS 用的就是这个），`/monitor.html` 是同页别名；数据侧 `/hw.json`、
调试侧 `/sensors`、校验侧 `/api/layout-check`。管理页在 M5 加入。
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import config, overlay, paths, registry
from .aida import controller
from .sources import aida64, winapi

HTML_FILE = paths.resource("monitor.html")
OVERLAY_FILE = config.OVERLAY_FILE
WEB_DIR = paths.resource("hwobs/web")
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
        elif route == "/api/aida/plan":
            self._json(controller.plan_export())
        elif route == "/api/sensors/unknown":
            sensors, _used = aida64.read_sensors()
            if sensors is None:
                self._json({"ok": False, "error": "AIDA64 未运行或共享内存读不到", "unknown": []})
            else:
                unknown = registry.unclaimed_ids(sensors)
                self._json({"ok": True, "unknown": [
                    {"id": sid, "label": sensors[sid][0], "value": sensors[sid][1]}
                    for sid in unknown]})
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
        if route == "/api/aida/apply":
            body, err = self._body_json()
            if err:
                return self._json({"applied": False, "reason": err}, 400)
            if not (isinstance(body, dict) and body.get("confirm") is True):
                return self._json({"applied": False,
                                   "reason": "需要 confirm=true：这一步会关闭并重启你的 AIDA64"}, 400)
            plan = controller.plan_export()
            if plan["unchanged"]:
                return self._json({"applied": False, "reason": "导出清单已经正确，无需改动"})
            if not plan["fits"]:
                return self._json({"applied": False, "reason": "版式需要的传感器超出 4096 预算，先去掉几个"}, 409)
            if body.get("expect_count") != plan["needed_count"]:
                return self._json({"applied": False, "reason": "清单已变化，请刷新后重新确认",
                                   "plan": plan}, 409)
            ids, _ = controller.propose(config.read())
            try:
                res = controller.apply(ids, confirm=True)
            except Exception as e:      # noqa: BLE001
                return self._json({"applied": False, "reason": f"执行失败：{e}"}, 500)
            return self._json({**res, "plan_after": controller.plan_export()})
        if route == "/api/metrics/custom":
            body, err = self._body_json()
            if err:
                return self._json({"saved": False, "error": err}, 400)
            sensors, _used = aida64.read_sensors()
            try:
                entry, problem = registry.save_custom(body or {}, sensors=sensors)
            except Exception as e:      # noqa: BLE001
                return self._json({"saved": False, "error": f"服务端处理失败：{e}"}, 500)
            if problem:
                return self._json({"saved": False, "error": problem}, 400)
            return self._json({"saved": True, "entry": entry})
        if route != "/api/config/rollback":
            return self._send(404, b"not found", "text/plain")
        try:
            ok, rep = config.rollback()
        except Exception as e:      # noqa: BLE001
            return self._json({"restored": False, "errors": [f"回滚失败：{e}"]}, 500)
        if not ok:
            return self._json({"restored": False, "errors": ["没有 .bak 可回滚"]}, 409)
        self._json({"restored": True, **rep})

    def do_DELETE(self):
        route = unquote(urlparse(self.path).path)
        if route != "/api/metrics/custom":
            return self._send(404, b"not found", "text/plain")
        mid = (parse_qs(urlparse(self.path).query).get("id") or [""])[0]
        try:
            removed = registry.remove_custom(mid)
        except Exception as e:      # noqa: BLE001
            return self._json({"removed": False, "error": f"服务端处理失败：{e}"}, 500)
        if not removed:
            return self._json({"removed": False, "error": "没有这个自定义指标"}, 404)
        self._json({"removed": True, "id": mid})

    def _file(self, path, ctype):
        try:
            self._send(200, path.read_bytes(), ctype)
        except OSError:
            self._send(404, f"{path.name} not found".encode(), "text/plain; charset=utf-8")


def create_server(port):
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)
