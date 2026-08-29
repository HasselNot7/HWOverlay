"""一次性标定 AIDA64 速率传感器的单位。

AIDA64 导出的速率是自动换算后的显示值，XML 里不带单位字段，量级一跳单位就变。
猜错就是 8 倍或 1000 倍的错，而且表面上看不出来。

标定不猜单位名，直接量一个数：**1 个显示单位等于多少字节**。
同一时间窗内取 AIDA64 的 SNIC*ULRATE 读数均值与 Windows 网卡 SentBytes 的真实增量，
两者之比就是它。有了这个数，换算成 Mbps 是 value*8/bytes_per_unit，不再依赖名字表。

需要窗口内有可观测流量；流量太小会给出 low confidence 而不是假装标定成功。
"""

import json
import math
import re
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

from .sources import aida64, winapi

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "profiles" / "rate_unit.json"
SAMPLE_INTERVAL = 0.25

# 候选的"1 显示单位 = 多少字节"。AIDA64 可能用十进制也可能用二进制，
# 两者差 2.4%，窗口内流量不够时区分不开 —— 那种情况要报 ambiguous 而不是硬选一个。
CANDIDATES = [
    ("B/s", 1), ("KiB/s", 1024), ("KB/s", 1000),
    ("kbps", 125), ("Mbps", 125_000), ("MB/s", 1_000_000), ("MiB/s", 1_048_576),
]

HIGH_BYTES = 20 * 1024 * 1024      # 窗口内至少这么多流量才敢给 high
MEDIUM_BYTES = 2 * 1024 * 1024


def _aida_sum(direction):
    rx = re.compile(rf"^SNIC\d+{direction}RATE$")
    sensors, _used = aida64.read_sensors()
    if not sensors:
        return None
    vals = []
    for sid, (_label, raw) in sensors.items():
        if rx.match(sid):
            m = re.search(r"-?\d+(?:\.\d+)?", str(raw))
            if m:
                vals.append(float(m.group(0)))
    return sum(vals) if vals else None


def match_factor(factor):
    """把量到的 bytes_per_unit 归到最接近的候选单位。"""
    if not factor or factor <= 0:
        return {"name": None, "candidate": None, "rel_err": None, "ambiguous_with": None}
    best, second = sorted(CANDIDATES, key=lambda c: abs(math.log(factor) - math.log(c[1])))[:2]
    rel = abs(factor - best[1]) / best[1]
    near_second = abs(math.log(factor) - math.log(second[1])) < 0.03
    return {"name": best[0], "candidate": best[1], "rel_err": round(rel, 4),
            "ambiguous_with": second[0] if near_second and second[1] != best[1] else None}


def measure(seconds=8.0):
    """量一次。计数器与 AIDA64 采样成对读取，保证两者覆盖完全相同的区间。

    之前分别取区间端点会差一个"采样裁剪比例"的系统偏差（20 秒窗口裁 1.2 秒 ≈ 6%），
    表现为上行算出 1021、下行算出 935 —— 同一个单位不可能这样。
    """
    t_end = time.time() + seconds
    pairs = []
    while time.time() < t_end:
        u, d = _aida_sum("UL"), _aida_sum("DL")
        if u is None or d is None:
            return {"ok": False, "reason": "AIDA64 没在导出 SNIC* 速率传感器，无法标定"}
        s, r = winapi.net_bytes_total()
        pairs.append((time.time(), s, r, u, d))
        time.sleep(SAMPLE_INTERVAL)
    if len(pairs) < 4:
        return {"ok": False, "reason": "采样太少，请延长窗口或确认 AIDA64 在导出网卡速率"}

    t0, s0, r0, _, _ = pairs[0]
    t1, s1, r1, _, _ = pairs[-1]
    span = t1 - t0
    aida_up = statistics.mean(p[3] for p in pairs)
    aida_down = statistics.mean(p[4] for p in pairs)
    bytes_up = max(0, s1 - s0)
    bytes_down = max(0, r1 - r0)
    if bytes_up + bytes_down == 0:
        return {"ok": False, "reason": "窗口内没有任何流量，标定无意义；请制造一些流量后重试",
                "seconds": round(span, 1)}

    conf = "high" if bytes_up + bytes_down >= HIGH_BYTES else \
           "medium" if bytes_up + bytes_down >= MEDIUM_BYTES else "low"
    up_factor = bytes_up / span / aida_up if aida_up > 0 else None
    down_factor = bytes_down / span / aida_down if aida_down > 0 else None
    m_up, m_down = match_factor(up_factor), match_factor(down_factor)

    # 两个方向共用同一个单位：谁离真实单位更近，谁就是更可信的那一侧
    sides = [(m_up, "up", bytes_up), (m_down, "down", bytes_down)]
    usable_sides = [x for x in sides if x[0]["name"]]
    best = min(usable_sides, key=lambda x: x[0]["rel_err"]) if usable_sides else (None, None, 0)
    agree = bool(m_up["name"]) and m_up["name"] == m_down["name"]
    return {
        "ok": True,
        "confidence": conf,
        "seconds": round(span, 1),
        "samples": len(pairs),
        "bytes_up": bytes_up, "bytes_down": bytes_down,
        "aida_up_mean": round(aida_up, 3), "aida_down_mean": round(aida_down, 3),
        "up": {"bytes_per_unit": None if up_factor is None else round(up_factor, 1), **m_up},
        "down": {"bytes_per_unit": None if down_factor is None else round(down_factor, 1), **m_down},
        "agree": agree,
        "recommend": best[0]["name"] if best[0] else None,
        "bytes_per_unit": (best[0]["candidate"] if best[0] else None),
        "note": ("上下行判定一致" if agree else
                 f"上下行不一致（上行 {m_up['rel_err']:.1%} 误差 / 下行 {m_down['rel_err']:.1%}），"
                 f"取更接近真实单位的一侧")
                + ("" if conf != "low" else "；流量太小，1000 与 1024 这类相近单位区分不开"),
    }


def read_profile():
    """已标定的话返回 bytes_per_unit，否则 None。"""
    if PROFILE.is_file():
        try:
            data = json.loads(PROFILE.read_text(encoding="utf-8"))
            bpu = data.get("bytes_per_unit")
            return bpu if isinstance(bpu, (int, float)) and bpu > 0 else None
        except (ValueError, OSError):
            return None
    return None


def write_profile(result):
    # 存归一化后的单位值（1024），不是带噪声的原始测量（1021）；原始值留在 detail 里可查
    bpu = result.get("bytes_per_unit")
    if not bpu:
        return None
    PROFILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"bytes_per_unit": round(bpu, 2), "unit_name": result.get("recommend"),
               "confidence": result.get("confidence"),
               "measured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "detail": result}
    PROFILE.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    return PROFILE


def main(argv=None):
    argv = argv if argv is not None else []
    seconds = 20.0 if "--long" in argv else 8.0
    print(f"标定中：{seconds:.0f} 秒窗口，期间请保持网络有可观测流量...")
    r = measure(seconds)
    print(json.dumps(r, ensure_ascii=False, indent=1))
    if r.get("ok") and "--write" in argv:
        p = write_profile(r)
        print(f"\n已写入 {p}（bytes_per_unit={r['up'].get('bytes_per_unit') or r['down'].get('bytes_per_unit')}）")
    return 0 if r.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main(__import__("sys").argv[1:]))
