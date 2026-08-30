"""版式配置的读写。

规矩：
- 读入即迁移：v1（rows）读到内存就变成 v2（widgets），上层只见 v2；落盘一律 v2。
- 写之前先过校验，有 error 就不落盘（用户手滑填个 cols=0 不该让叠加层黑掉）。
- 覆盖前备份成 .bak，并提供回滚。
- 用 os.replace 原子替换：半份 JSON 会让 OBS 浏览器源直接白屏。
- 写完回读确认能解析、且就是我们发过去的那份。
"""

import json
import os

from . import layout, paths
from .aida import controller

OVERLAY_FILE = paths.overlay_path("monitor")

SCHEMA_VERSION = 2


def migrate(cfg):
    """v1 -> v2：rows 改名 widgets，补上版本号。v2 原样返回，非 dict 原样返回。"""
    if not isinstance(cfg, dict) or cfg.get("version") == SCHEMA_VERSION:
        return cfg
    out = dict(cfg)
    out["version"] = SCHEMA_VERSION
    if "rows" in out:
        out["widgets"] = out.pop("rows")
    return out


def read(path=OVERLAY_FILE):
    return migrate(json.loads(path.read_text(encoding="utf-8")))


def _backup(path):
    bak = path.with_suffix(path.suffix + ".bak")
    if path.is_file():
        bak.write_bytes(path.read_bytes())
        return bak
    return None


def validate(cfg, path=OVERLAY_FILE):
    """不写盘的预检：版式校验 + 导出预算。结构不合法时只报错误，不往下走。"""
    cfg = migrate(cfg)
    problem = _sane(cfg)
    if problem:
        return {"errors": [problem], "warnings": [], "est_height": 0,
                "canvas_w": None, "canvas_h": None, "referenced": [],
                "needed_ids": [], "ok": False, "target": str(path)}
    ids, plan = controller.propose(cfg)
    rep = layout.check(cfg, plan=plan)
    rep["needed_ids"] = ids
    rep["budget"] = {k: plan[k] for k in ("count", "usable", "worst_bytes",
                                          "typical_bytes", "fits", "truncated_at")}
    if not cfg.get("widgets"):
        rep["warnings"] = rep.get("warnings", []) + \
            ["版式是空的：去「版式编辑」加部件，或点「加载默认样式」一键上手"]
    rep["target"] = str(path)
    return rep


def _sane(cfg):
    """结构底线。校验器假设这些存在，缺了会抛异常而不是给出好读的报错。"""
    if not isinstance(cfg, dict):
        return "配置必须是 JSON 对象"
    if not isinstance(cfg.get("widgets"), list):
        return "widgets 必须是数组（可以是空的，去编辑器加部件或加载默认样式）"
    canvas = cfg.get("canvas")
    if not isinstance(canvas, dict):
        return "缺少 canvas 对象"
    for k in ("w", "h"):
        v = canvas.get(k)
        if not isinstance(v, int) or v < 50:
            return f"canvas.{k} 必须是不小于 50 的整数（现在是 {v!r}）"
    return None


def save(cfg, path=OVERLAY_FILE):
    """校验通过才写。返回 (是否写入, 校验报告)。入参可以是 v1，落盘一律 v2。"""
    cfg = migrate(cfg)
    rep = validate(cfg, path)
    if rep["errors"]:
        return False, rep                    # 有错误就不落盘

    text = json.dumps(cfg, ensure_ascii=False, indent=2) + "\n"
    # 语义比对：内容没变就不动文件。但若磁盘上还是 v1（或排版不同），
    # 借这次保存把文件升级成 v2 规范形式 —— "落盘一律 v2" 才成立。
    if path.is_file():
        try:
            raw = path.read_text(encoding="utf-8")
            if migrate(json.loads(raw)) == cfg and raw == text:
                rep["unchanged"] = True
                return True, rep
        except ValueError:
            pass                               # 现存文件已损坏，照常覆盖修复

    bak = _backup(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)                    # 同卷原子替换

    back = read(path)
    if back != cfg:
        if bak:
            path.write_text(bak.read_text(encoding="utf-8"), encoding="utf-8")
        rep["errors"] = rep["errors"] + ["回读与写入内容不一致，已恢复备份"]
        return False, rep

    rep["backup"] = str(bak) if bak else None
    return True, rep


def rollback(path=OVERLAY_FILE):
    """从 .bak 恢复。返回 (是否恢复, 恢复后的校验报告)。"""
    bak = path.with_suffix(path.suffix + ".bak")
    if not bak.is_file():
        return False, None
    current = path.read_bytes() if path.is_file() else None
    os.replace(bak, path)
    cfg = read(path)
    rep = validate(cfg)
    rep["restored_from"] = str(bak)
    rep["overwrote"] = current is not None
    return True, rep
