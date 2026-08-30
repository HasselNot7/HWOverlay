"""版式校验：把"静默裁切"变成明确报错。

起因是实测复现的一个坑：把 cards 行的 cols 从 4 改成 3、卡片仍是 4 个时，第 4 张卡换行，
chips 被顶到 bottom=204 而 body 只有 170，底部整块消失且没有任何提示。
管理界面允许用户改版式，就必须先有这道校验，否则每个用户都会踩一遍。

v2 之后校验器的几何全部来自配置本身（部件注册表 widgets.py 的默认值 + 用户的
覆盖值），渲染器按同一份配置内联应用样式 —— 改字号、改内边距不再需要"同步改这里"。
"""

from . import refs, widgets


def _known_paths(reg):
    return {m["out"] for m in reg["metrics"] if m.get("out")} | {m["id"] for m in reg["metrics"]}


def _canvas_check(cfg, errors):
    """画布与内边距。返回 (内容宽, 内容高, 垂直内边距×2)。"""
    canvas = cfg.get("canvas", {})
    width, height = canvas.get("w"), canvas.get("h")
    if not width or not height:
        errors.append("canvas.w / canvas.h 必须设置，OBS 源尺寸要用它")

    pad = canvas.get("padding", [12, 24])
    if (not isinstance(pad, list) or len(pad) != 2
            or not all(isinstance(v, int) and 0 <= v <= 200 for v in pad)):
        errors.append(f"canvas.padding 必须是 [垂直, 水平] 两个 0~200 的整数（现在是 {pad!r}）")
        pad = [12, 24]
    return width, height, pad[0] * 2


def _prompt_check(cfg, errors):
    """顶部提示行。有 prompt 才占高；字号非法就报错并按默认 19px 算。"""
    p = cfg.get("prompt")
    if not p:
        return 0
    size = p.get("size", 19)
    if not isinstance(size, int) or not 8 <= size <= 60:
        errors.append(f"prompt.size 必须是 8~60 的整数（现在是 {size!r}）")
        size = 19
    # 量测口径与部件一致：字号行高 1.2 + margin 10
    return round(size * 1.2) + 10


def check(cfg, reg=None, plan=None):
    """返回 {"errors": [...], "warnings": [...], "est_height": px}。errors 非空表示会被裁切。"""
    if reg is None:
        from . import registry
        reg = registry.load()
    errors, warnings = [], []

    width, height, used = _canvas_check(cfg, errors)
    used += _prompt_check(cfg, errors)
    known = _known_paths(reg)
    referenced = []

    for i, w in enumerate(refs.widget_list(cfg)):
        entry = widgets.get(w.get("type") if isinstance(w, dict) else None)
        if entry is None:
            errors.append(f"第 {i+1} 个部件 type={w.get('type') if isinstance(w, dict) else w!r} "
                          f"不认识，会被直接跳过")
            referenced += refs.iter_refs(w)
            continue
        w_errors, w_warnings = [], []
        entry["validate"](w, w_errors, w_warnings)
        errors += [f"第 {i+1} 个部件（{w.get('type')}）：{e}" for e in w_errors]
        warnings += [f"第 {i+1} 个部件（{w.get('type')}）：{e}" for e in w_warnings]
        used += entry["height"](w)
        referenced += refs.iter_refs(w)

    for node in refs.iter_composites(refs.widget_list(cfg)):
        warnings.append(f"{node} 没有 unit，会显示成裸数字（没有单位）")

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
            "canvas_w": width, "canvas_h": height, "widgets": len(list(refs.widget_list(cfg))),
            "referenced": sorted(set(referenced)), "ok": not errors}
