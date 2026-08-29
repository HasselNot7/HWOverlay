"""版式校验：把"静默裁切"变成明确报错。

起因是实测复现的一个坑：把 cards 行的 cols 从 4 改成 3、卡片仍是 4 个时，第 4 张卡换行，
chips 被顶到 bottom=204 而 body 只有 170，底部整块消失且没有任何提示。
管理界面允许用户改版式，就必须先有这道校验，否则每个用户都会踩一遍。

高度常量是从 monitor.html 现有 CSS 量出来的，改样式要同步改这里。
"""

import math

# 单位 px，对应 monitor.html 的当前样式
BODY_PADDING = 12 * 2
PROMPT_H = 33          # 19px 行高 + 10 margin
CARD_H = 66            # 标题 21 + gap 5 + 进度条 18 + gap 5 + 次要行 17
CHIPS_H = 28           # 15px 行高 + 10 margin

# 单个传感器在共享内存里的最坏成本（budget.entry_cost 用默认 label 长度算出来的）
CHIP_MIN_FONT_PX = 13
CHAR_PX_PER_FONT = 0.62     # 等宽字体下 1 字符 ≈ 0.62 × font-size


def _paths_of(node, out=None):
    out = [] if out is None else out
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, dict):
        for k in ("metric", "bar", "spark"):
            if isinstance(node.get(k), str):
                out.append(node[k])
        for k in ("metrics", "pair", "diff", "max_of", "items", "value", "sub"):
            if k in node:
                _paths_of(node[k], out)
    elif isinstance(node, list):
        for x in node:
            _paths_of(x, out)
    return out


def _known_paths(reg):
    return {m["out"] for m in reg["metrics"] if m.get("out")} | {m["id"] for m in reg["metrics"]}


def check(cfg, reg=None, plan=None):
    """返回 {"errors": [...], "warnings": [...], "est_height": px}。errors 非空表示会被裁切。"""
    if reg is None:
        from . import registry
        reg = registry.load()
    errors, warnings = [], []

    canvas = cfg.get("canvas", {})
    height = canvas.get("h")
    if not canvas.get("w") or not height:
        errors.append("canvas.w / canvas.h 必须设置，OBS 源尺寸要用它")

    used = BODY_PADDING + (PROMPT_H if cfg.get("prompt") else 0)
    known = _known_paths(reg)
    referenced = []

    for i, row in enumerate(cfg.get("rows", [])):
        rtype = row.get("type")
        if rtype == "cards":
            cols = row.get("cols", 4)
            items = row.get("items", [])
            if cols < 1:
                errors.append(f"第 {i+1} 行 cols 必须 ≥ 1")
                continue
            if items and len(items) % cols:
                warnings.append(f"第 {i+1} 行有 {len(items)} 张卡片但 cols={cols}，"
                                f"最后一行不满 {cols - len(items) % cols} 张")
            rows_needed = math.ceil(len(items) / cols) if items else 0
            used += rows_needed * CARD_H + max(0, rows_needed - 1) * row.get("gap", 32)
            referenced += _paths_of(items)
        elif rtype == "chips":
            items = row.get("items", [])
            used += CHIPS_H
            referenced += _paths_of(items)
            for it in items:
                if isinstance(it, dict) and not it.get("unit") and (it.get("max_of") or it.get("diff")):
                    name = it.get("name") or str(it.get("max_of") or it.get("diff"))
                    warnings.append(f"小指标 {name} 没有 unit，会显示成裸数字（没有单位）")
        else:
            errors.append(f"第 {i+1} 行 type={rtype!r} 不认识，会被直接跳过")

    unknown = sorted({p for p in referenced if p not in known})
    if unknown:
        errors.append("版式引用了注册表里不存在的路径：" + ", ".join(unknown))

    if height and used > height:
        errors.append(f"内容预估高 {used}px 超过 canvas.h {height}px，"
                      f"底部会被裁掉约 {used - height}px（body 是 overflow:hidden）")

    if plan and not plan.get("fits", True):
        warnings.append(f"版式需要的传感器最坏占 {plan['worst_bytes']} 字节，"
                        f"超过可用的 {plan['usable']}：从第 {plan['truncated_at']+1} 个起会被 AIDA64 截断")

    return {"errors": errors, "warnings": warnings, "est_height": used,
            "canvas_w": canvas.get("w"), "canvas_h": height,
            "referenced": sorted(set(referenced)), "ok": not errors}
