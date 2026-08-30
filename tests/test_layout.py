"""版式校验测试。

核心是复现并拦住那个实测踩到的坑：cols 从 4 改成 3、卡片仍是 4 个时，
第 4 张卡换行把 chips 顶到 bottom=204 而 body 只有 170，底部整块静默消失。

v2 之后校验几何来自配置本身（widgets.py 默认值 + 用户覆盖），
所以这里同时盯住两件事：默认版式的预估高度仍与浏览器实测量级吻合；
覆盖几何后校验器必须按覆盖值算，不再手抄 CSS。
"""

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from hwobs import layout, refs    # noqa: E402

CFG = json.loads((ROOT / "overlays" / "monitor.json").read_text(encoding="utf-8"))
# 几何测试统一跑在强制流式的副本上：用户的实盘版式随时可能切成自由画布
# （free 不做纵向预算，est_height 恒为 0），这些断言盯的是校验器不是用户选的模式。
FLOW = copy.deepcopy(CFG)
FLOW["canvas"]["mode"] = "flow"
passed, failed = 0, []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}  {detail}")


print("[refs：版式树只有一份遍历]")
sample = {"widgets": [
    {"type": "cards", "items": [
        {"key": "a", "bar": "x.bar", "spark": "x.spark",
         "value": {"metrics": ["x.v1", {"pair": ["x.p1", "x.p2"]}]},
         "sub": {"metrics": [{"metric": "x.s1"}]}}]},
    {"type": "chips", "items": ["x.chip"]},
    {"type": "text", "text": "CPU {x.t1} / {x.t2}°C"},
]}
got = refs.collect_refs(sample)
for p in ["x.bar", "x.spark", "x.v1", "x.p1", "x.p2", "x.s1", "x.chip", "x.t1", "x.t2"]:
    check(f"引用收集覆盖 {p}", p in got, str(got))

print("\n[当前版式]")
rep = layout.check(CFG)
check("现行配置无版式错误", not rep["errors"], str(rep["errors"]))
check("预估高度不超过 canvas.h", rep["est_height"] <= rep["canvas_h"],
      f"{rep['est_height']} > {rep['canvas_h']}")
# 浏览器实测：chips 底边在 body 内 153px 处（内容顶到 153，body 170 时代）。
# 几何公式没变：padding 24 + prompt 33 + 卡片行 66 + chips 28 = 151。
repf = layout.check(FLOW)
check("预估高度与浏览器实测量级吻合（±15px）", abs(repf["est_height"] - 153) <= 15,
      f"预估 {repf['est_height']} vs 实测 153")

print("\n[几何来自配置，覆盖即生效]")
tall = copy.deepcopy(FLOW)
tall["widgets"][0]["item_height"] = 90
r = layout.check(tall)
check("卡片行高覆盖后预估高跟着变（+24）",
      r["est_height"] == repf["est_height"] + 24, f"{r['est_height']} vs {repf['est_height']}")
small = copy.deepcopy(FLOW)
small["widgets"][1]["font"] = 13
small["widgets"][1]["margin_top"] = 0
r2 = layout.check(small)
check("chips 字号/边距覆盖后高度重算（18+0=16，省 12）",
      r2["est_height"] == repf["est_height"] - 12, f"{r2['est_height']} vs {repf['est_height']}")
padless = copy.deepcopy(FLOW)
padless["canvas"]["padding"] = [0, 0]
r3 = layout.check(padless)
check("画布 padding 覆盖后高度重算（-24）", r3["est_height"] == repf["est_height"] - 24,
      f"{r3['est_height']} vs {repf['est_height']}")
badpad = copy.deepcopy(FLOW)
badpad["canvas"]["padding"] = [12]
check("padding 形状非法报错误", any("padding" in e for e in layout.check(badpad)["errors"]))

print("\n[拦住实测那个静默裁切]")
bad = copy.deepcopy(FLOW)
bad["widgets"][0]["cols"] = 3        # 4 张卡塞进 3 列 -> 换行 -> 底部被裁
r4 = layout.check(bad)
check("cols=3 且 4 张卡被判为错误", not r4["ok"], str(r4))
check("错误里明确指出会被裁切", any("裁" in e for e in r4["errors"]), str(r4["errors"]))
check("同时提醒最后一行不满", any("不满" in w for w in r4["warnings"]), str(r4["warnings"]))

print("\n[部件结构校验]")
dup = copy.deepcopy(FLOW)
dup["widgets"][0]["items"][1]["key"] = "cpu"
r5 = layout.check(dup)
check("卡片 key 重复报错误", any("key 重复" in e for e in r5["errors"]), str(r5["errors"]))
badfit = copy.deepcopy(FLOW)
badfit["widgets"][1]["fit"] = "squeeze"
check("chips fit 非法报错误", any("fit" in e for e in layout.check(badfit)["errors"]))
badtext = {"version": 2, "canvas": FLOW["canvas"],
           "widgets": [{"type": "text", "text": ""}]}
check("空 text 正文报错误", any("text" in e for e in layout.check(badtext)["errors"]))
unknowntext = {"version": 2, "canvas": FLOW["canvas"],
               "widgets": [{"type": "text", "text": "{cpu.nope}"}]}
r6 = layout.check(unknowntext)
check("text 插值引用不存在的路径报错误", any("cpu.nope" in e for e in r6["errors"]),
      str(r6["errors"]))

print("\n[引用完整性]")
bad2 = copy.deepcopy(FLOW)
bad2["widgets"][1]["items"].append("gpu.nope_missing")
r7 = layout.check(bad2)
check("引用不存在的路径报错误", any("gpu.nope_missing" in e for e in r7["errors"]),
      str(r7["errors"]))

bad3 = copy.deepcopy(FLOW)
for i in bad3["widgets"][0]["items"]:
    for m in (i.get("sub") or {}).get("metrics", []):
        if isinstance(m, dict) and m.get("diff"):
            m.pop("unit", None)
r8 = layout.check(bad3)
check("pair/diff 缺 unit 被提醒（会显示成裸数字）",
      any("裸数字" in w for w in r8["warnings"]), str(r8["warnings"]))

bad4 = copy.deepcopy(FLOW)
bad4["widgets"].append({"type": "sparkline", "items": ["gpu.nope_missing"]})
r9 = layout.check(bad4)
check("未知部件 type 报错误而不是静默跳过",
      any("sparkline" in e for e in r9["errors"]), str(r9["errors"]))
check("未知部件里的引用仍被收集校验",
      any("gpu.nope_missing" in e for e in r9["errors"]), str(r9["errors"]))

print(f"\n通过 {passed}，失败 {len(failed)}")
raise SystemExit(1 if failed else 0)
