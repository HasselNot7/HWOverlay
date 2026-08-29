"""版式校验测试。

核心是复现并拦住那个实测踩到的坑：cols 从 4 改成 3、卡片仍是 4 个时，
第 4 张卡换行把 chips 顶到 bottom=204 而 body 只有 170，底部整块静默消失。
"""

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from hwobs import layout    # noqa: E402

CFG = json.loads((ROOT / "overlays" / "monitor.json").read_text(encoding="utf-8"))
passed, failed = 0, []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}  {detail}")


print("[当前版式]")
rep = layout.check(CFG)
check("现行配置无版式错误", not rep["errors"], str(rep["errors"]))
check("预估高度不超过 canvas.h", rep["est_height"] <= rep["canvas_h"],
      f"{rep['est_height']} > {rep['canvas_h']}")
# 浏览器实测：chips 底边在 body 内 153px 处（内容顶到 153，body 170）
check("预估高度与浏览器实测量级吻合（±15px）", abs(rep["est_height"] - 153) <= 15,
      f"预估 {rep['est_height']} vs 实测 153")

print("\n[拦住实测那个静默裁切]")
bad = copy.deepcopy(CFG)
bad["rows"][0]["cols"] = 3        # 4 张卡塞进 3 列 -> 换行 -> 底部被裁
r2 = layout.check(bad)
check("cols=3 且 4 张卡被判为错误", not r2["ok"], str(r2))
check("错误里明确指出会被裁切", any("裁" in e for e in r2["errors"]), str(r2["errors"]))
check("同时提醒最后一行不满", any("不满" in w for w in r2["warnings"]), str(r2["warnings"]))

print("\n[引用完整性]")
bad2 = copy.deepcopy(CFG)
bad2["rows"][1]["items"].append("gpu.nope_missing")
r3 = layout.check(bad2)
check("引用不存在的路径报错误", any("gpu.nope_missing" in e for e in r3["errors"]),
      str(r3["errors"]))

bad3 = copy.deepcopy(CFG)
for i in bad3["rows"][1]["items"]:
    if isinstance(i, dict) and i.get("max_of"):
        i.pop("unit", None)
r4 = layout.check(bad3)
check("max_of 缺 unit 被提醒（会显示成裸数字）",
      any("裸数字" in w for w in r4["warnings"]), str(r4["warnings"]))

bad4 = copy.deepcopy(CFG)
bad4["rows"].append({"type": "sparkline", "items": []})
r5 = layout.check(bad4)
check("未知 row type 报错误而不是静默跳过",
      any("sparkline" in e for e in r5["errors"]), str(r5["errors"]))

print("\n[预算联动]")
r6 = layout.check(CFG, plan={"fits": False, "worst_bytes": 5000, "usable": 3481,
                             "truncated_at": 40})
check("预算放不下时给出截断警告",
      any("截断" in w for w in r6["warnings"]), str(r6["warnings"]))

print(f"\n通过 {passed}，失败 {len(failed)}")
raise SystemExit(1 if failed else 0)
