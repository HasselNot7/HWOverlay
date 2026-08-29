"""指标注册表：把「传感器 ID → 有名字、有单位、有阈值的指标」从代码里搬到数据里。

约定（重要）：
- `id` 用扁平名（cpu_usage），它是 /hw.json 里 matched 的键；`out` 才是输出路径（cpu.usage）。
  两者分开，是为了在重构期保持与 legacy 实现逐字段一致。
- `out: null` 表示这条只作中间量，不出现在输出里（例如显存空闲，仅用于求总量）。
- 只有带 `sources.aida64` 的条目参与 matched / missing；聚合与派生条目不进这两张表，
  否则 missing 会多出 legacy 里没有的键。
- 单位一律在这里解读，数据源只出原始字符串。速率类标了 `rate_untrusted`，
  因为 AIDA64 导出的是自动换算后的显示值且不带单位，M4 要与 Windows 计数器对拍标定。
"""

import json
import re
from pathlib import Path

from ..metrics import TO_MBS, TO_MBPS, num, pick

REGISTRY_FILE = Path(__file__).resolve().parent / "metrics.json"

_CACHED = None


def load(path=REGISTRY_FILE):
    global _CACHED
    if _CACHED is None:
        _CACHED = json.loads(path.read_text(encoding="utf-8"))
    return _CACHED


def reload_():
    global _CACHED
    _CACHED = None
    return load()


def _convert(m, raw_total, rate_unit):
    kind = m.get("convert")
    if kind == "rate_to_mbps":
        return raw_total * TO_MBPS[rate_unit]
    if kind == "rate_to_mb_per_s":
        return raw_total * TO_MBS[rate_unit]
    return raw_total


def _aggregate(sensors, m, rate_unit):
    rx = re.compile(m["regex"])
    vals = [num(raw) for sid, (_label, raw) in sensors.items() if rx.match(sid)]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    if m["agg"] == "regex_max":
        return max(vals)
    if m["agg"] == "regex_min":
        return min(vals)
    return round(_convert(m, sum(vals), rate_unit), 2)


def resolve(sensors, reg=None):
    """返回 (指标值, 命中的传感器ID, 缺失的候选ID列表)。"""
    reg = reg or load()
    rate_unit = reg["rate_unit"]
    values, matched, missing = {}, {}, []

    for m in reg["metrics"]:
        ids = m.get("sources", {}).get("aida64")
        if ids:
            sid, val = pick(sensors, ids, m.get("na_zero", False))
            matched[m["id"]] = sid
            if sid is None:
                missing.append(ids[0])
            values[m["id"]] = val
        elif m.get("agg"):
            values[m["id"]] = _aggregate(sensors, m, rate_unit)

    # 派生量单独一轮，这样 JSON 里的条目顺序不会静默影响结果
    for m in reg["metrics"]:
        if m.get("sum_of"):
            parts = [values.get(i) for i in m["sum_of"]]
            values[m["id"]] = None if any(p is None for p in parts) else sum(parts)

    return values, matched, missing


def apply(values, reg=None):
    """按 out 路径装配成嵌套字典。"""
    reg = reg or load()
    tree = {}
    for m in reg["metrics"]:
        path = m.get("out")
        if not path:
            continue
        node = tree
        keys = path.split(".")
        for k in keys[:-1]:
            node = node.setdefault(k, {})
        node[keys[-1]] = values.get(m["id"])
    return tree


def by_id(metric_id, reg=None):
    for m in (reg or load())["metrics"]:
        if m["id"] == metric_id:
            return m
    return None
