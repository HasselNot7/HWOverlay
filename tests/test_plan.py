"""导出计划（plan_export）的不变量测试。

核心不变量：按这份计划删传感器之后，版式引用的每个指标仍然要有值。
曾经的 bug 就是 needed_ids 漏收 sum_of 依赖与 agg 正则匹配的 ID，
apply() 一旦执行会把"显存总量"和"WiFi 信号"的底层传感器删掉，
面板上对应格子当场变 -- 且没有任何报错。
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from hwobs import config, layout, registry    # noqa: E402
from hwobs.aida import controller             # noqa: E402
from hwobs.sources import aida64              # noqa: E402

passed, failed = 0, []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}  {detail}")



cfg = config.read()
sensors, _used = aida64.read_sensors()
if not sensors:
    print("  skip  AIDA64 没在跑，无法验证计划不变量")
    raise SystemExit(0)

reg = registry.load()
by_id = {m["id"]: m for m in reg["metrics"]}
by_out = {m["out"]: m for m in reg["metrics"] if m.get("out")}

needed, _unknown = controller.needed_ids(cfg, sensors=sensors)
referenced = layout.check(cfg)["referenced"]


def dig(obj, path):
    for k in path.split("."):
        obj = obj.get(k) if isinstance(obj, dict) else None
    return obj


def backing(m):
    """一个指标最终依赖哪些传感器 ID：候选 + sum_of 递归 + agg 正则展开。"""
    ids = list(m.get("sources", {}).get("aida64", []))
    for dep in m.get("sum_of", []):
        ids += backing(by_id.get(dep) or {})
    if m.get("regex"):
        rx = re.compile(m["regex"])
        ids += [s for s in sensors if rx.match(s)]
    return ids


print("[删完之后版式还能不能取到值]")
kept = {sid: v for sid, v in sensors.items() if sid in needed}   # 模拟勾选"精简"后的导出集（默认只加不删是它的超集，更安全）
vals, _m, _ms, _src = registry.resolve(kept, reg)
tree = registry.apply(vals, reg)

silent = []
for path in referenced:
    m = by_out.get(path)
    if not m:
        continue
    bs = backing(m)
    if not any(b in sensors for b in bs):
        continue                       # 这台机器本来就没有这个传感器，不算被计划删掉
    if dig(tree, path) is None:
        silent.append(f"{path} ← {bs}")
check("按此计划删完后，版式引用的指标没有一个变成空值",
      not silent, "; ".join(silent))

print("\n[两条曾经漏收的路径]")
check("sum_of 依赖被保留（显存总量要的是 SFREEVMEM）",
      "SFREEVMEM" in needed, "被漏收就会被删")
# 网卡编号因机器/重连而异（SNIC4/5/6 都见过），按实采的 WLANRSSI 判定
wlan = [s for s in sensors if s.endswith("WLANRSSI")]
check("agg 正则匹配的 ID 被保留（WiFi 信号要的是当前网卡的 WLANRSSI）",
      not wlan or all(s in needed for s in wlan),
      f"实采 {wlan or '无'}，needed 缺 {[s for s in wlan if s not in needed]}")

print("\n[默认只加不删 —— 共享内存里的清单其他软件也在读]")
p = controller.plan_export(cfg, sensors=sensors)
check("确实识别出了可精简的冗余传感器", len(p["to_remove"]) > 0, str(p["to_remove"]))
check("冗余项都不在版式引用链上",
      not (set(p["to_remove"]) & set(needed)), str(set(p["to_remove"]) & set(needed)))
check("needed_count 与实际清单一致", p["needed_count"] == len(needed))
check("只加不删后的预算仍算得过来", p["fits"], str(p["budget_new"]))
check("budget_new 按只加不删算（现有传感器一个不丢）",
      p["budget_new"]["count"] == p["current_count"] + len(p["to_add"]),
      f"{p['budget_new']['count']} != {p['current_count']} + {len(p['to_add'])}")
check("精简是独立方案：预算收敛到版式所需，且与 fits_prune 一致",
      p["budget_prune"]["count"] == p["needed_count"] and p["fits_prune"] == p["budget_prune"]["fits"],
      str(p["budget_prune"]))
check("unchanged 只看有没有要补的（冗余不再算待办）", p["unchanged"] == (len(p["to_add"]) == 0))

print(f"\n通过 {passed}，失败 {len(failed)}")
raise SystemExit(1 if failed else 0)
