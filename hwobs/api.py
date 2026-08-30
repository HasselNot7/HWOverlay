"""FastAPI 应用：HTTP 壳。业务函数（config/overlay/registry/controller）原样复用。

与旧 stdlib server 的行为约定：
- 响应 JSON 的字段结构原样保留（saved/errors/applied/reason...），前端零适配。
- 会碰 PowerShell（1~2 秒）或 AIDA64 生命周期的端点用同步 def —— FastAPI
  自动丢线程池，不会堵事件循环；纯文件/共享内存的端点也用同步 def（微秒级）。
- 带 JSON body 的 PUT/POST 用 async + 手动解析，畸形 JSON 保持旧的
  400 + {"saved": False, "errors": [...]} 形状，而不是 FastAPI 默认的 422。

静态页：
- `/` 永远是叠加层 monitor.html（OBS 填的就是它，URL 不能变）。
- `/admin` 优先服务 frontend/dist（React 构建产物）；没构建过就回落旧
  vanilla 管理页（过渡期并存，前端移植完成后删除）。
"""

import json

from fastapi import Body, FastAPI, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, overlay, paths, registry
from .aida import controller
from .sources import aida64, winapi

HTML_FILE = paths.resource("monitor.html")
FRONTEND_DIST = paths.resource("frontend/dist")

MAX_BODY = 64 * 1024      # 版式配置远小于这个数，超了就是乱发


def _bad_request(err: str):
    return JSONResponse({"saved": False, "errors": [err]}, status_code=400)


async def _json_body(request: Request):
    """读 JSON body。返回 (数据, 错误响应)；错误时数据为 None。"""
    length = int(request.headers.get("content-length") or 0)
    if not 0 < length <= MAX_BODY:
        return None, _bad_request(f"请求体大小非法（{length} 字节）")
    try:
        return json.loads(await request.body()), None
    except ValueError as e:
        return None, _bad_request(f"不是合法 JSON：{e}")


def create_app() -> FastAPI:
    app = FastAPI(title="HWOverlay", docs_url=None, redoc_url=None, openapi_url=None)

    # ---------- 叠加层与数据端点 ----------

    @app.get("/")
    def overlay_page():
        return FileResponse(HTML_FILE, media_type="text/html; charset=utf-8")

    @app.get("/hw.json")
    def hw_json():
        return overlay.snapshot()

    @app.get("/overlay.json")
    def overlay_json():
        return config.read()

    @app.get("/metrics.json")
    def metrics_json():
        return registry.load()

    @app.get("/sensors")
    def sensors_dump():
        return overlay.debug_dump()

    # ---------- 版式校验与配置写盘 ----------

    @app.get("/api/layout-check")
    def layout_check():
        return config.validate(config.read())

    @app.post("/api/layout-check")
    async def layout_check_draft(request: Request):
        cfg, err = await _json_body(request)
        if err:
            return err
        try:
            return config.validate(cfg)
        except Exception as e:      # noqa: BLE001
            return JSONResponse({"errors": [f"校验失败：{e}"], "warnings": [],
                                 "ok": False}, status_code=500)

    @app.put("/api/config")
    async def put_config(request: Request):
        cfg, err = await _json_body(request)
        if err:
            return err
        try:
            saved, rep = config.save(cfg)
        except Exception as e:      # noqa: BLE001
            return JSONResponse({"saved": False, "errors": [f"服务端处理失败：{e}"]},
                                status_code=500)
        return JSONResponse({"saved": saved, **rep}, status_code=200 if saved else 400)

    @app.post("/api/config/rollback")
    def rollback_config():
        try:
            ok, rep = config.rollback()
        except Exception as e:      # noqa: BLE001
            return JSONResponse({"restored": False, "errors": [f"回滚失败：{e}"]}, status_code=500)
        if not ok:
            return JSONResponse({"restored": False, "errors": ["没有 .bak 可回滚"]}, status_code=409)
        return {"restored": True, **rep}

    # ---------- AIDA64 导出清单 ----------

    @app.get("/api/aida/status")
    def aida_status():
        st = controller.status()
        st["windows_net_sampler"] = winapi.net_state()
        return st

    @app.get("/api/aida/plan")
    def aida_plan():
        return controller.plan_export()

    @app.post("/api/aida/apply")
    def aida_apply(body: dict = Body(...)):
        if not (isinstance(body, dict) and body.get("confirm") is True):
            return JSONResponse({"applied": False,
                                 "reason": "需要 confirm=true：这一步会关闭并重启你的 AIDA64"},
                                status_code=400)
        plan = controller.plan_export()
        if plan["unchanged"]:
            return {"applied": False, "reason": "导出清单已经正确，无需改动"}
        if not plan["fits"]:
            return JSONResponse({"applied": False,
                                 "reason": "版式需要的传感器超出 4096 预算，先去掉几个"},
                                status_code=409)
        if body.get("expect_count") != plan["needed_count"]:
            return JSONResponse({"applied": False,
                                 "reason": "清单已变化，请刷新后重新确认", "plan": plan},
                                status_code=409)
        ids, _unknown = controller.propose(config.read())
        try:
            res = controller.apply(ids, confirm=True)
        except Exception as e:      # noqa: BLE001
            return JSONResponse({"applied": False, "reason": f"执行失败：{e}"}, status_code=500)
        return {**res, "plan_after": controller.plan_export()}

    # ---------- 自定义指标 ----------

    @app.get("/api/sensors/unknown")
    def sensors_unknown():
        sensors, _used = aida64.read_sensors()
        if sensors is None:
            return {"ok": False, "error": "AIDA64 未运行或共享内存读不到", "unknown": []}
        unknown = registry.unclaimed_ids(sensors)
        return {"ok": True, "unknown": [
            {"id": sid, "label": sensors[sid][0], "value": sensors[sid][1]}
            for sid in unknown]}

    @app.post("/api/metrics/custom")
    async def metrics_custom(request: Request):
        spec, err = await _json_body(request)
        if err:
            return err
        sensors, _used = aida64.read_sensors()
        try:
            entry, problem = registry.save_custom(spec or {}, sensors=sensors)
        except Exception as e:      # noqa: BLE001
            return JSONResponse({"saved": False, "error": f"服务端处理失败：{e}"}, status_code=500)
        if problem:
            return JSONResponse({"saved": False, "error": problem}, status_code=400)
        return {"saved": True, "entry": entry}

    @app.delete("/api/metrics/custom")
    def delete_metrics_custom(id: str = Query(...)):
        try:
            removed = registry.remove_custom(id)
        except Exception as e:      # noqa: BLE001
            return JSONResponse({"removed": False, "error": f"服务端处理失败：{e}"}, status_code=500)
        if not removed:
            return JSONResponse({"removed": False, "error": "没有这个自定义指标"}, status_code=404)
        return {"removed": True, "id": id}

    # ---------- 管理页：React 构建产物；没构建过就提示构建命令 ----------

    if (FRONTEND_DIST / "index.html").is_file():
        app.mount("/admin", StaticFiles(directory=FRONTEND_DIST, html=True), name="admin")
    else:
        @app.get("/admin")
        def admin_not_built():
            return HTMLResponse(
                "<meta charset='utf-8'><body style='background:#121214;color:#eceff4;"
                "font-family:monospace;padding:40px'>管理页还没构建。"
                "在 frontend/ 里跑 <code>npm ci &amp;&amp; npm run build</code>，"
                "或打包时执行 <code>python build.py</code>（会自动构建）。</body>",
                status_code=503)

    return app
