"""导出计划（needed_ids / plan_export）的不变量测试。

核心不变量：用户照补全清单把版式所需的传感器都导出后，版式引用的
每个指标都要能取到值。曾经的 bug 就是 needed_ids 漏收 sum_of 依赖与
agg 正则匹配的 ID —— 面板上对应格子会永远显示 -- 且没有任何报错。
本软件不写 AIDA64 的清单，这里的职责是保证"告诉用户的东西是对的"。
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


print("[版式所需集合是否自足]")
kept = {sid: v for sid, v in sensors.items() if sid in needed}   # needed 是最小充分集；补全清单（现有∪缺口）只会是它的超集
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
check("照最小集导出后，版式引用的指标没有一个变成空值",
      not silent, "; ".join(silent))

print("\n[两条曾经漏收的路径]")
check("sum_of 依赖被保留（显存总量要的是 SFREEVMEM）",
      "SFREEVMEM" in needed, "被漏收就会被删")
# 网卡编号因机器/重连而异（SNIC4/5/6 都见过），按实采的 WLANRSSI 判定
wlan = [s for s in sensors if s.endswith("WLANRSSI")]
check("agg 正则匹配的 ID 被保留（WiFi 信号要的是当前网卡的 WLANRSSI）",
      not wlan or all(s in needed for s in wlan),
      f"实采 {wlan or '无'}，needed 缺 {[s for s in wlan if s not in needed]}")

print("\n[只读对比：缺口、冗余、补全清单 —— 本软件不写 AIDA64 的清单]")
p = controller.plan_export(cfg, sensors=sensors)
check("missing = 版式所需 − 当前导出",
      p["missing"] == [i for i in needed if i not in sensors], str(p["missing"]))
check("unused 与版式引用链无交集（仅告知，绝不动）",
      not (set(p["unused"]) & set(needed)), str(set(p["unused"]) & set(needed)))
check("补全清单 = 现有 ∪ 缺口（现有传感器一个不丢）",
      set(p["merged_items"].split()) == set(sensors) | set(needed),
      f"{len(p['merged_items'].split())} 项")
check("补全清单能被 ini.get_items 原样解析回列表（空格分隔约定一致）",
      " ".join(p["merged_items"].split()) == p["merged_items"], p["merged_items"][:60])
check("补全后预算放得下", p["fits"], str(p["budget_merged"]))
check("unchanged 只看有没有缺口", p["unchanged"] == (not p["missing"]))

print(f"\n通过 {passed}，失败 {len(failed)}")
raise SystemExit(1 if failed else 0)
