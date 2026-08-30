"""版式树的单一遍历实现。

历史教训（e2e567e）：遍历逻辑曾在 layout._paths_of、controller.needed_ids 的私有
collect() 和 admin.js 的 pathsUsedByCards() 各写了一份，三份的键集合各差一点，
apply() 据此裁剪导出清单时把版式在用的传感器静默清掉。从现在起只有这里一份：
谁需要"这份版式引用了哪些输出路径"，就从这里拿，不许再手写第二份。
"""

import re

# dict 上表示"直接引用一个输出路径"的键；list/dict 继续往下递归
REF_KEYS = ("metric", "bar", "spark")
GROUP_KEYS = ("metrics", "pair", "diff", "items", "value", "sub")

# text 部件正文里的 {输出路径} 插值
TEXT_REF_RX = re.compile(r"\{([a-zA-Z0-9_.]+)\}")

# 本地伪路径：渲染端本地生成（时钟这类），不来自传感器，注册表校验要跳过
PSEUDO_TEXT_REFS = frozenset({"time", "date"})


def _text_refs(body):
    return [r for r in TEXT_REF_RX.findall(body) if r not in PSEUDO_TEXT_REFS]


def widget_list(cfg):
    """版式的行列表。schema v2 叫 widgets，v1 叫 rows；两条读取路径统一从这里进。"""
    if not isinstance(cfg, dict):
        return []
    w = cfg.get("widgets", cfg.get("rows"))
    return w if isinstance(w, list) else []


def iter_refs(node, out=None):
    """收集版式树里引用的全部输出路径（含 text/html 部件 {路径} 插值）。

    裸字符串（items/metrics 列表里）与 metric/bar/spark 键都算引用；
    pair/diff 是路径数组，走 list 分支自然收进来。
    """
    out = [] if out is None else out
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, dict):
        if node.get("type") == "text" and isinstance(node.get("text"), str):
            out.extend(_text_refs(node["text"]))
        if node.get("type") == "html" and isinstance(node.get("html"), str):
            out.extend(_text_refs(node["html"]))
        for k in REF_KEYS:
            if isinstance(node.get(k), str):
                out.append(node[k])
        for k in GROUP_KEYS:
            if k in node:
                iter_refs(node[k], out)
    elif isinstance(node, list):
        for x in node:
            iter_refs(x, out)
    return out


def collect_refs(cfg):
    """整份版式引用的输出路径（含重复，调用方按需去重）。"""
    return iter_refs(widget_list(cfg))


def iter_composites(node, out=None):
    """pair/diff 没有 unit 就会显示成裸数字；递归找出这类节点，供校验器提醒。"""
    out = [] if out is None else out
    if isinstance(node, dict):
        for k in ("pair", "diff"):
            if node.get(k) and not node.get("unit"):
                out.append(f"{k}={','.join(node[k])}")
        for v in node.values():
            iter_composites(v, out)
    elif isinstance(node, list):
        for x in node:
            iter_composites(x, out)
    return out
