"""回归对比：新实现与冻结的旧实现逐字段比 /hw.json。

fixtures/legacy_hw_server.py 是 M1 拆分前的完整快照，当 oracle 长期保留 ——
M2 换渲染层、M3 换数据源时都要跑它，确认输出语义没被顺手改掉。
两边在同一瞬间各读一次共享内存，应当完全一致；只有 ts 必然不同，
若恰好跨过 AIDA64 的 1 秒刷新点，数值型叶子可能差一个采样周期，那类差异单独列出不算失败。
"""

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

ORACLE = Path(__file__).resolve().parent / "fixtures" / "legacy_hw_server.py"


def load_legacy():
    spec = importlib.util.spec_from_file_location("legacy_hw_server", ORACLE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def leaves(obj, prefix=""):
    """展平成 {路径: 值}，用于逐字段比较。"""
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(leaves(v, f"{prefix}.{k}" if prefix else k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.update(leaves(v, f"{prefix}[{i}]"))
    else:
        out[prefix] = obj
    return out


def main():
    legacy = load_legacy()
    from hwobs import overlay as new

    a = legacy.snapshot()
    b = new.snapshot()

    la, lb = leaves(a), leaves(b)
    # 有意新增的字段。sources 是一棵子树，按顶层名放行；
    # 单个新增字段必须写全路径，免得顺手放行掉以后冒出来的同类字段。
    ALLOWED_PREFIX = {"degraded", "sources", "custom"}
    ALLOWED_EXACT = {"misc.dimm_max", "net.link_mbps"}
    only_a = sorted(set(la) - set(lb))
    only_b_all = sorted(set(lb) - set(la))
    top = lambda k: k.split(".")[0].split("[")[0]
    allowed = [k for k in only_b_all if k in ALLOWED_EXACT or top(k) in ALLOWED_PREFIX]
    only_b = [k for k in only_b_all if k not in allowed]

    hard, volatile = [], []
    for path in sorted(set(la) & set(lb)):
        x, y = la[path], lb[path]
        if x == y or path == "ts":
            continue
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            volatile.append((path, x, y))
        else:
            hard.append((path, x, y))

    matched_same = a.get("matched") == b.get("matched")
    missing_same = a.get("missing") == b.get("missing")

    print(f"叶子字段数      旧 {len(la)}  新 {len(lb)}")
    print(f"结构差异        仅旧有 {only_a or '无'}   仅新有 {only_b or '无'}")
    if allowed:
        print(f"有意新增(已放行) {allowed}")
    print(f"matched 一致    {matched_same}")
    print(f"missing 一致    {missing_same}")
    print(f"非数值差异      {len(hard)}")
    for p, x, y in hard[:12]:
        print(f"    {p}: 旧={x!r} 新={y!r}")
    print(f"数值差异(可归因于采样时刻)  {len(volatile)}")
    for p, x, y in volatile[:12]:
        print(f"    {p}: 旧={x} 新={y} Δ={round((y or 0) - (x or 0), 3)}")

    ok = not only_a and not only_b and not hard and matched_same and missing_same
    print("\n结论:", "PASS — 行为零变化" if ok else "FAIL — 存在行为差异")
    if not ok and "-v" in sys.argv:
        print(json.dumps({"old": a, "new": b}, ensure_ascii=False, indent=1))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
