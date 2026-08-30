"""指标注册表：把「传感器 ID → 有名字、有单位、有阈值的指标」从代码里搬到数据里。

约定（重要）：
- `id` 用扁平名（cpu_usage），它是 /hw.json 里 matched 的键；`out` 才是输出路径（cpu.usage）。
  两者分开，是为了在重构期保持与 legacy 实现逐字段一致。
- `out: null` 表示这条只作中间量，不出现在输出里（例如显存空闲，仅用于求总量）。
- 只有带 `sources.aida64` 的条目参与 matched / missing；聚合与派生条目不进这两张表，
  否则 missing 会多出 legacy 里没有的键。
- 单位一律在这里解读，数据源只出原始字符串。速率类标了 `rate_untrusted`，
  因为 AIDA64 导出的是自动换算后的显示值且不带单位，M4 要与 Windows 计数器对拍标定。

用户自定义指标（管理页"未知传感器 -> 做成指标"的产物）：
- 存在独立的 metrics.user.json（可写数据目录，打包后在 %LOCALAPPDATA%），包内资源只读。
- load() 时合并进注册表；custom 条目不进 matched（那张表是冻结的回归契约），
  sources 照常输出，管理页"这个数从哪来"照常可查。
- 保存/删除后调用 reload_()，运行中的服务立即生效，不需要重启。
"""

import json
import os
import re

from .. import paths
from ..calibrate import read_profile   # 单向依赖：calibrate 不认识 registry，无循环
from ..metrics import DISK_RX, TO_MBS, TO_MBPS, num, pick

REGISTRY_FILE = paths.resource("hwobs/registry/metrics.json")
USER_METRICS_FILE = paths.data_root() / "metrics.user.json"

_CACHED = None


def load(path=REGISTRY_FILE, user_path=None):
    global _CACHED
    if _CACHED is None:
        reg = json.loads(path.read_text(encoding="utf-8"))
        # 标定过就用量出来的数，覆盖按单位名猜的换算表（没标定过是 None）
        reg["_bytes_per_unit"] = read_profile()
        reg = _merge_user(reg, USER_METRICS_FILE if user_path is None else user_path)
        _CACHED = reg
    return _CACHED


def reload_():
    global _CACHED
    _CACHED = None
    return load()


def _merge_user(reg, user_path):
    """把用户自定义指标合并进注册表。同 id 覆盖内建条目（留给想微调内建指标的人）。"""
    user_path = paths.Path(user_path)
    if not user_path.is_file():
        return reg
    try:
        data = json.loads(user_path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return reg                      # 用户文件坏了不拖垮主注册表
    for entry in data.get("metrics", []):
        if not isinstance(entry, dict) or not entry.get("id") or not entry.get("name"):
            continue
        entry.setdefault("custom", True)
        entry.setdefault("out", "custom." + entry["id"])
        reg["metrics"] = [m for m in reg["metrics"] if m.get("id") != entry["id"]]
        reg["metrics"].append(entry)
    return reg


def _read_user(user_path):
    user_path = paths.Path(user_path)
    if user_path.is_file():
        try:
            return json.loads(user_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            pass
    return {"version": 1, "metrics": []}


def _write_user(data, user_path):
    user_path = paths.Path(user_path)
    user_path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    tmp = user_path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, user_path)


def save_custom(spec, sensors=None, user_path=None, reg=None):
    """把"未知传感器"注册成用户指标。返回 (条目, None) 或 (None, 错误说明)。

    spec: {sensor_id, name, unit, digits, na_zero}
    """
    reg = reg or load()
    sid = str(spec.get("sensor_id") or "").strip()
    name = str(spec.get("name") or "").strip()
    unit = str(spec.get("unit") or "").strip()
    try:
        digits = int(spec.get("digits", 0))
    except (TypeError, ValueError):
        digits = -1
    if not re.fullmatch(r"[A-Za-z0-9]{3,24}", sid):
        return None, f"传感器 ID 不合法：{sid!r}"
    if sensors is not None and sid not in sensors:
        return None, f"AIDA64 当前没有导出 {sid}，无法注册"
    if not 1 <= len(name) <= 30:
        return None, "名称需要 1~30 个字"
    if not 0 <= digits <= 2:
        return None, "小数位只能是 0~2"
    if len(unit) > 12:
        return None, "单位太长（最多 12 个字）"

    mid = "custom_" + re.sub(r"[^a-z0-9]", "", sid.lower())
    if any(m.get("id") == mid for m in reg["metrics"]):
        return None, f"{sid} 已经注册过了（自定义指标列表里找找）"

    entry = {"id": mid, "out": "custom." + sid.lower(), "name": name, "kind": "gauge",
             "unit": unit or None, "digits": digits, "custom": True,
             "sources": {"aida64": [sid]}}
    if spec.get("na_zero"):
        entry["na_zero"] = True

    user_path = USER_METRICS_FILE if user_path is None else user_path
    data = _read_user(user_path)
    data["metrics"] = [m for m in data.get("metrics", []) if m.get("id") != mid]
    data["metrics"].append(entry)
    _write_user(data, user_path)
    reload_()
    return entry, None


def remove_custom(metric_id, user_path=None):
    """删除一个自定义指标。返回是否删掉了东西。"""
    user_path = USER_METRICS_FILE if user_path is None else user_path
    data = _read_user(user_path)
    kept = [m for m in data.get("metrics", []) if m.get("id") != metric_id]
    if len(kept) == len(data.get("metrics", [])):
        return False
    data["metrics"] = kept
    _write_user(data, user_path)
    reload_()
    return True


def unclaimed_ids(sensors, reg=None):
    """导出了、但注册表和磁盘内部逻辑都不认领的传感器 ID。

    这些就是管理页"未知传感器"区块的候选：认领 = 注册表 sources 列出、
    agg 正则命中，或 DISK_RX（磁盘速率，代码内部消费）。
    """
    reg = reg or load()
    claimed = set()
    for m in reg["metrics"]:
        claimed |= set(m.get("sources", {}).get("aida64", []))
        if m.get("regex"):
            rx = re.compile(m["regex"])
            claimed |= {s for s in sensors if rx.match(s)}
    claimed |= {s for s in sensors if DISK_RX.match(s)}
    return sorted(set(sensors) - claimed)


def _convert(m, raw_total, rate_unit, bytes_per_unit=None):
    kind = m.get("convert")
    if kind == "rate_to_mbps":
        return raw_total * 8 / bytes_per_unit if bytes_per_unit else raw_total * TO_MBPS[rate_unit]
    if kind == "rate_to_mb_per_s":
        return (raw_total * bytes_per_unit / 1024 ** 2 if bytes_per_unit
                else raw_total * TO_MBS[rate_unit])
    return raw_total


def _aggregate(sensors, m, rate_unit, bytes_per_unit=None):
    rx = re.compile(m["regex"])
    vals = [num(raw) for sid, (_label, raw) in sensors.items() if rx.match(sid)]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    if m["agg"] == "regex_max":
        return max(vals)
    if m["agg"] == "regex_min":
        return min(vals)
    return round(_convert(m, sum(vals), rate_unit, bytes_per_unit), 2)


def resolve(sensors, reg=None, fallbacks=None, winapi_values=None):
    """返回 (指标值, 命中的传感器ID, 缺失的候选ID列表, 每个指标的数据来源)。

    fallbacks: {兜底键: 数值}，例如 {"net_up": 6.32, "net_down": 0.4}。
      只填声明了 winapi_fallback 且 AIDA64 没给值的指标 —— 逐指标降级，不整体换源。
    winapi_values: {指标id: 数值}，Windows 自己就能算出来的指标（内存等），
      由调用方读好传进来；值和来源必须同时决定，否则来源会永远是 None。

    matched 只覆盖 AIDA64 候选类指标（历史字段，回归对比依赖它），自定义指标
    不进 matched/missing（那张表是冻结的回归契约）；sources 覆盖全部指标，
    管理页要显示"这个数从哪来"就读它。
    """
    reg = reg or load()
    fallbacks = fallbacks or {}
    winapi_values = winapi_values or {}
    rate_unit = reg["rate_unit"]
    values, matched, missing, sources = {}, {}, [], {}

    for m in reg["metrics"]:
        mid = m["id"]
        ids = m.get("sources", {}).get("aida64")
        if ids:
            sid, val = pick(sensors, ids, m.get("na_zero", False))
            if not m.get("custom"):
                matched[mid] = sid
            sources[mid] = f"aida64:{sid}" if sid else None
            if sid is None:
                missing.append(ids[0])
            values[mid] = val
        elif m.get("agg"):
            val = _aggregate(sensors, m, rate_unit, reg.get("_bytes_per_unit"))
            values[mid] = val
            sources[mid] = f"aida64:{m['agg']}" if val is not None else None
        elif (wkey := m.get("sources", {}).get("winapi")):
            val = winapi_values.get(mid)
            values[mid] = val
            sources[mid] = f"winapi:{wkey}" if val is not None else None
        fb = m.get("winapi_fallback")
        if fb and values.get(mid) is None and fallbacks.get(fb) is not None:
            values[mid] = fallbacks[fb]
            matched[mid] = "winapi"
            sources[mid] = f"winapi:{fb}"

    # 派生量单独一轮，这样 JSON 里的条目顺序不会静默影响结果
    for m in reg["metrics"]:
        if m.get("sum_of"):
            parts = [values.get(i) for i in m["sum_of"]]
            values[m["id"]] = None if any(p is None for p in parts) else sum(parts)
            srcs = {sources.get(i) for i in m["sum_of"]}
            sources[m["id"]] = "+".join(sorted(x for x in srcs if x)) or None

    return values, matched, missing, sources


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
