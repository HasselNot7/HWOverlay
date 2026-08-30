"""部件注册表：版式 schema v2 的行级定义，每种显示部件在这里登记一项。

v1 的问题：cards/chips 的解剖结构焊死在 monitor.html 和 layout.py 两处，
高度常量（CARD_H=66 等）是从 CSS 手抄的 —— 用户一改字号或画布，校验器就
开始撒谎，而"加一种部件"要同时改 Python 校验器、HTML 渲染器、管理页编辑器。

v2 的约定：
- 每种部件在这里登记：defaults（含默认几何）、height()（按配置算占高）、
  validate()（部件自己的结构检查）。layout.check 只做遍历和全局检查。
- monitor.html 里有同名 JS 部件工厂（makeCards/makeChips/makeText），
  两边以 type 字符串为契约；渲染器按配置内联应用几何，CSS 只留兜底值。
- 高度默认值仍来自对现有 CSS 的量测，依据写在各自条目的注释里；
  用户在配置里覆盖后，校验器算的就是用户声明的值，不再说谎。
"""

import math

from . import refs


def _int_in(w, key, default, lo, hi):
    v = w.get(key, default)
    return v if isinstance(v, int) and lo <= v <= hi else default


def _line_h(px):
    """等宽字体默认行高的量测口径：1.2 × 字号，取整。"""
    return round(px * 1.2)


# --- cards：指标卡片网格 ----------------------------------------------------
# item_height=66 的量测依据：标题 21（17px 字号）+ gap 5 + 进度条行 18
# （15px 字号撑出的行高）+ gap 5 + 次要行 17（14px 字号）。

def cards_height(w):
    items = w.get("items") or []
    cols = max(1, _int_in(w, "cols", 4, 1, 12))
    ih = _int_in(w, "item_height", 66, 24, 400)
    rows = math.ceil(len(items) / cols) if items else 0
    gap = _int_in(w, "gap", 32, 0, 400)
    return rows * ih + max(0, rows - 1) * gap


def cards_validate(w, errors, warnings):
    items = w.get("items")
    if not isinstance(items, list):
        errors.append("cards 的 items 必须是数组")
        return
    cols = w.get("cols", 4)
    if not isinstance(cols, int) or cols < 1:
        errors.append(f"cols 必须 ≥ 1（现在是 {cols!r}）")
    elif items and len(items) % cols:
        warnings.append(f"有 {len(items)} 张卡片但 cols={cols}，"
                        f"最后一行不满 {cols - len(items) % cols} 张")
    ih = w.get("item_height", 66)
    if not isinstance(ih, int) or not 24 <= ih <= 400:
        errors.append(f"item_height 必须是 24~400 的整数（现在是 {ih!r}）")
    keys = [c.get("key") for c in items if isinstance(c, dict)]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        errors.append(f"卡片 key 重复：{', '.join(map(str, dup))}（渲染按 key 索引，重复会互相覆盖）")


# --- chips：底部小指标行 ------------------------------------------------------
# 高度 = 15px 字号行高 18 + margin_top 10（CSS .chips 的 margin-top）。

def chips_height(w):
    font = _int_in(w, "font", 15, 8, 40)
    margin = _int_in(w, "margin_top", 10, 0, 200)
    return _line_h(font) + margin


def chips_validate(w, errors, warnings):
    items = w.get("items")
    if not isinstance(items, list):
        errors.append("chips 的 items 必须是数组")
    fit = w.get("fit", "none")
    if fit not in ("none", "shrink"):
        errors.append(f"fit 只支持 none / shrink（现在是 {fit!r}）")


# --- text：自定义文本行 -------------------------------------------------------
# 正文里 {输出路径} 会被替换成格式化后的值；引用由 refs.iter_refs 统一收集。

def text_height(w):
    size = _int_in(w, "size", 19, 8, 60)
    margin = _int_in(w, "margin_top", 0, 0, 200)
    return _line_h(size) + margin


def text_validate(w, errors, warnings):
    if not isinstance(w.get("text"), str) or not w.get("text"):
        errors.append("text 部件必须有非空的 text 字符串")


# --- stat / progress / html：自由画布部件 ------------------------------------
# 只在 canvas.mode=free 下有意义（x/y 定位）；height() 仅在流式兜底用。

def stat_height(w):
    return _line_h(_int_in(w, "size", 26, 8, 80))


def stat_validate(w, errors, warnings):
    if not isinstance(w.get("metric"), str) or not w.get("metric"):
        errors.append("stat 部件必须有 metric")


def progress_height(w):
    return _int_in(w, "height", 10, 4, 100)


def progress_validate(w, errors, warnings):
    if not isinstance(w.get("metric"), str) or not w.get("metric"):
        errors.append("progress 部件必须有 metric")


def html_height(w):
    return _int_in(w, "h", 60, 10, 2000)


def html_validate(w, errors, warnings):
    if not isinstance(w.get("html"), str) or not w.get("html"):
        errors.append("html 部件必须有非空的 html")


WIDGETS = {
    "cards": {
        "summary": "指标卡片网格：标题 + 进度条 + 次要行 + 迷你曲线",
        "defaults": {"cols": 4, "gap": 32, "item_height": 66},
        "height": cards_height,
        "validate": cards_validate,
    },
    "chips": {
        "summary": "底部小指标行：一行紧凑的 名称+值",
        "defaults": {"font": 15, "margin_top": 10, "fit": "shrink"},
        "height": chips_height,
        "validate": chips_validate,
    },
    "text": {
        "summary": "自定义文本行，正文用 {cpu.usage} 这类占位符插入指标值",
        "defaults": {"size": 19, "margin_top": 0},
        "height": text_height,
        "validate": text_validate,
    },
    "stat": {
        "summary": "自由画布：单指标大数字，可带名字",
        "defaults": {"size": 26},
        "height": stat_height,
        "validate": stat_validate,
    },
    "progress": {
        "summary": "自由画布：单指标进度条（按指标量程定标）",
        "defaults": {"w": 260, "height": 10},
        "height": progress_height,
        "validate": progress_validate,
    },
    "html": {
        "summary": "自由画布：自定义 HTML 片段，{cpu.usage} 这类占位符替换成指标值",
        "defaults": {"w": 300, "h": 60},
        "height": html_height,
        "validate": html_validate,
    },
}


def get(wtype):
    return WIDGETS.get(wtype)


def refs_of(widget):
    """单个部件引用的输出路径。"""
    return refs.iter_refs(widget)
