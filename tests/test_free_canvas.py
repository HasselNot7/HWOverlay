"""自由画布（canvas.mode=free）的校验测试。

free 模式不做纵向堆叠预算，改为 x/y 边界检查；新增三种部件
stat / progress / html 的结构与引用收集也在这里验证。
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from hwobs import layout, refs                        # noqa: E402

passed, failed = 0, []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}  {detail}")


FREE = {"version": 2, "canvas": {"w": 1920, "h": 400, "mode": "free"}, "widgets": [
    {"type": "stat", "x": 40, "y": 20, "w": 300, "metric": "cpu.usage", "label": "CPU"},
    {"type": "progress", "x": 40, "y": 80, "w": 260, "metric": "gpu.usage"},
    {"type": "gauge", "x": 40, "y": 120, "size": 120, "metric": "cpu.usage", "label": "CPU"},
    {"type": "html", "x": 400, "y": 20, "w": 300, "h": 80,
     "html": "<div>CPU {cpu.usage} / {cpu.temp}</div>"},
    {"type": "text", "x": 400, "y": 120, "text": "{time} · {date} · {cpu.usage}"},
]}

print("[引用收集]")
refs_found = sorted(set(refs.collect_refs(FREE)))
check("stat/progress/gauge 的 metric 与 html/text 占位符都被收集",
      refs_found == ["cpu.temp", "cpu.usage", "gpu.usage"], str(refs_found))
check("本地伪路径 time/date 不参与注册表校验",
      "time" not in refs_found and "date" not in refs_found)

print("\n[合法自由版式]")
rep = layout.check(FREE)
check("无错误", not rep["errors"], str(rep["errors"]))
check("free 不做纵向堆叠预算（est_height 为 0）", rep["est_height"] == 0, str(rep["est_height"]))
check("部件数照常报告", rep["widgets"] == 5)

print("\n[定位与边界]")
bad = dict(FREE, widgets=[dict(FREE["widgets"][0], x=5000)])
rep = layout.check(bad)
check("x 超出画布宽被点名", any("x=5000" in e for e in rep["errors"]), str(rep["errors"]))
bad = dict(FREE, widgets=[{"type": "stat", "metric": "cpu.usage"}])
rep = layout.check(bad)
check("缺 x/y 被点名", any("x / y" in e for e in rep["errors"]), str(rep["errors"]))
edge = dict(FREE, widgets=[dict(FREE["widgets"][0], x=1700)])
rep = layout.check(edge)
check("右缘略超出只提醒不报错", not rep["errors"] and rep["warnings"], str(rep))

print("\n[结构校验仍然生效]")
bad = dict(FREE, widgets=[{"type": "stat", "x": 10, "y": 10}])
rep = layout.check(bad)
check("stat 缺 metric 被拒", any("metric" in e for e in rep["errors"]), str(rep["errors"]))
bad = dict(FREE, widgets=[{"type": "html", "x": 10, "y": 10, "w": 100, "h": 40}])
rep = layout.check(bad)
check("html 缺内容被拒", any("html" in e for e in rep["errors"]), str(rep["errors"]))
bad = dict(FREE, widgets=[{"type": "gauge", "x": 10, "y": 10}])
rep = layout.check(bad)
check("gauge 缺 metric 被拒", any("gauge" in e and "metric" in e for e in rep["errors"]), str(rep["errors"]))
bad = dict(FREE, widgets=[{"type": "gauge", "x": 10, "y": 10, "metric": "cpu.usage", "ring": 99}])
rep = layout.check(bad)
check("gauge 环宽超范围被拒", any("ring" in e for e in rep["errors"]), str(rep["errors"]))
check("新类型已进注册表",
      all(widgets_ok := True for _ in [0]) and all(
          __import__("hwobs.widgets", fromlist=["get"]).get(t) for t in ("stat", "progress", "html", "gauge")))

print("\n[gauge 高度与 monitor 同口径]")
from hwobs import widgets                             # noqa: E402
g = widgets.get("gauge")
check("带标签 = 直径 + 20", g["height"]({"size": 120, "label": "CPU"}) == 140)
check("无标签 = 直径", g["height"]({"size": 150}) == 150)
check("缺 size 用默认 120", g["height"]({}) == 120)

print(f"\n通过 {passed}，失败 {len(failed)}")
raise SystemExit(1 if failed else 0)
