"""指标注册表：把「传感器 ID → 有名字、有单位、有阈值的指标」从代码里搬到数据里。

分发模型（0.3.0 起）：
- **用户文件 metrics.user.json 就是注册表的全部**。新装机器上它不存在 -> 注册表为空，
  AIDA64 导出的每个传感器都是"未知传感器"，用户在管理页自己挑着注册 —— 各家
  AIDA64 版本/主板不同，传感器名对不上是常态，内置的一套硬编码 ID 在别人机器上
  大半是死行，反而碍事。
- 内置的 metrics.json 降级为**默认指标集（预设）**：管理页一键"注册默认指标集"
  （seed_builtin）整包搬进用户文件，幂等；想要开箱即用的人一下就能上手。
- **迁移**：旧版装过、已有用户文件但没有 preset_seeded 标记的机器，首次加载时
  自动把内置集补进去并打标记 —— 行为与旧版"内置+用户合并"完全一致，老机器无感。

约定（重要）：
- `id` 用扁平名（cpu_usage），它是 /hw.json 里 matched 的键；`out` 才是输出路径（cpu.usage）。
- `out: null` 表示这条只作中间量，不出现在输出里（例如显存空闲，仅用于求总量）。
- 只有带 `sources.aida64` 的条目参与 matched / missing；聚合与派生条目不进这两张表。
- 单位一律在这里解读，数据源只出原始字符串。速率类标了 `rate_untrusted`，
  因为 AIDA64 导出的是自动换算后的显示值且不带单位，M4 要与 Windows 计数器对拍标定。
- 删除任何条目（save_custom 造的也好、预设搬进来的也好）= 从用户文件里删掉，
  对应传感器自动回到"未知传感器"池子。
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


def _skeleton():
    """注册表骨架：速率单位等元数据仍来自内置文件，条目本身全部来自用户。"""
    meta = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    return {"version": meta.get("version", 1),
            "rate_unit": meta.get("rate_unit", "KB/s"),
            "metrics": [], "_bytes_per_unit": read_profile()}


def _valid(entry):
    return isinstance(entry, dict) and entry.get("id") and entry.get("name")


def _build(user_path):
    data = _read_user(user_path)
    # 旧版迁移：有用户文件但没有预设标记 -> 自动补内置集并打标记（见模块 docstring）。
    # 新装机没有这个文件，从空白开始，一切交给用户注册。
    if user_path.is_file() and not data.get("preset_seeded"):
        _append_builtin(data)
        data["preset_seeded"] = True
        _write_user(data, user_path)
    reg = _skeleton()
    reg["metrics"] = [e for e in data.get("metrics", []) if _valid(e)]
    return reg


def load(path=REGISTRY_FILE, user_path=None):
    """显式传 user_path（测试/工具）时绕过缓存现算；默认路径走单例缓存。"""
    user_path = USER_METRICS_FILE if user_path is None else paths.Path(user_path)
    global _CACHED
    if user_path == USER_METRICS_FILE:
        if _CACHED is None:
            _CACHED = _build(user_path)
        return _CACHED
    return _build(user_path)


def reload_():
    global _CACHED
    _CACHED = None
    return load()


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


def _append_builtin(data):
    """把内置指标集追加进 data（跳过已有 id，标上 preset）。原地改，返回新增 id 列表。"""
    meta = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    have = {m.get("id") for m in data.get("metrics", [])}
    added = []
    for m in meta.get("metrics", []):
        if not _valid(m) or m["id"] in have:
            continue
        e = dict(m)
        e.setdefault("preset", True)
        data.setdefault("metrics", []).append(e)
        have.add(e["id"])
        added.append(e["id"])
    return added


def seed_builtin(user_path=None):
    """一键注册内置指标集。幂等：已有的 id 原样保留。返回本次新增的 id 列表。"""
    user_path = USER_METRICS_FILE if user_path is None else paths.Path(user_path)
    data = _read_user(user_path)
    added = _append_builtin(data)
    data["preset_seeded"] = True
    _write_user(data, user_path)
    if user_path == USER_METRICS_FILE:
        reload_()
    return added


def save_custom(spec, sensors=None, user_path=None, reg=None):
    """把"未知传感器"注册成用户指标。返回 (条目, None) 或 (None, 错误说明)。

    spec: {sensor_id, name, unit, digits, na_zero}
    """
    reg = reg if reg is not None else load(user_path=user_path)
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

    user_path = USER_METRICS_FILE if user_path is None else paths.Path(user_path)
    data = _read_user(user_path)
    data["metrics"] = [m for m in data.get("metrics", []) if m.get("id") != mid]
    data["metrics"].append(entry)
    _write_user(data, user_path)
    if user_path == USER_METRICS_FILE:
        reload_()
    return entry, None


def remove_custom(metric_id, user_path=None):
    """删除一个指标（自定义的、预设搬来的都一样）。删掉后它的传感器回到未知池。"""
    user_path = USER_METRICS_FILE if user_path is None else paths.Path(user_path)
    data = _read_user(user_path)
    kept = [m for m in data.get("metrics", []) if m.get("id") != metric_id]
    if len(kept) == len(data.get("metrics", [])):
        return False
    data["metrics"] = kept
    _write_user(data, user_path)
    if user_path == USER_METRICS_FILE:
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
