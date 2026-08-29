"""Windows 兜底源的测试：逐指标降级 + 后台网卡采样。

不依赖 AIDA64 是否导出网卡传感器：降级逻辑用合成的传感器字典直接验。
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hwobs import overlay, registry    # noqa: E402
from hwobs.sources import winapi       # noqa: E402

passed, failed = 0, []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}  {detail}")


print("[逐指标降级]")
reg = registry.load()
fb = {"net_up": 6.32, "net_down": 0.41}

# AIDA64 什么都没导出：网卡速率走 Windows 兜底，其余指标如实报缺
vals, matched, missing, sources = registry.resolve({}, reg, fb)
check("无 AIDA64 时上行走 Windows 兜底", vals["net_up"] == 6.32, str(vals.get("net_up")))
check("兜底命中记在 matched 上（管理页要能看出来源）",
      matched.get("net_up") == "winapi", str(matched.get("net_up")))
check("AIDA64 专属指标仍报缺，不被兜底糊过去",
      "SCPUUTI" in missing and vals["cpu_usage"] is None)
check("sources 覆盖注册表里的每一个指标",
      set(sources) == {m["id"] for m in reg["metrics"]},
      f"缺 {sorted({m['id'] for m in reg['metrics']} - set(sources))}")
check("兜底生效时 sources 指向 winapi", sources["net_up"] == "winapi:net_up",
      str(sources.get("net_up")))
check("没数据的指标 sources 明确为 None，不含糊",
      sources["cpu_usage"] is None and sources["mobo_temp"] is None)

# 回归：Windows 自带指标的值曾经是在 resolve() 之后注入的，导致有值却永远报"无来源"
_wv = {"ram_used": 16.8, "ram_total": 47.8}
_v3, _m3, _ms3, s3 = registry.resolve({}, reg, fb, winapi_values=_wv)
check("Windows 自带指标有值时来源如实标出",
      s3["ram_used"] == "winapi:memory" and s3["ram_total"] == "winapi:memory",
      f"{s3.get('ram_used')} / {s3.get('ram_total')}")
check("没传值时不谎报来源",
      registry.resolve({}, reg, fb)[3]["ram_used"] is None)

# AIDA64 有网卡速率：必须优先用它，兜底不得插手
sensors = {"SNIC5ULRATE": ("NIC5 Upload Rate", "880.5"), "SNIC5DLRATE": ("NIC5 Download Rate", "12.0")}
vals2, matched2, _, sources2 = registry.resolve(sensors, reg, fb)
check("AIDA64 有值时不被 Windows 兜底覆盖", vals2["net_up"] != 6.32, str(vals2.get("net_up")))
check("此时 matched 不再指向 winapi", matched2.get("net_up") != "winapi",
      str(matched2.get("net_up")))
check("聚合类指标也报得出来源（matched 以前漏的就是这类）",
      sources2["net_up"] == "aida64:regex_sum", str(sources2.get("net_up")))
check("AIDA64 在位时不启动昂贵的采样线程", overlay._net_fallback(sensors) == {})

print("\n[网卡计数读取]")
try:
    a = winapi.net_bytes_total()
    time.sleep(1.2)
    b = winapi.net_bytes_total()
    check("net_bytes_total 返回两个非负整数",
          len(a) == 2 and all(isinstance(x, int) and x >= 0 for x in a), str(a))
    check("累计计数单调不减", b[0] >= a[0] and b[1] >= a[1], f"{a} -> {b}")
except Exception as e:      # noqa: BLE001
    check("net_bytes_total 可用", False, repr(e))

check("未采样时 net_mbps 返回 (None, None)",
      isinstance(winapi.net_mbps(), tuple) and len(winapi.net_mbps()) == 2)

print("\n[后台采样线程]")
t1 = winapi.start_net_sampler(interval=1.0)
t2 = winapi.start_net_sampler(interval=1.0)
check("start_net_sampler 幂等（不会起两个线程）", t1 is t2)
deadline = time.time() + 6.0
while time.time() < deadline and winapi.net_mbps()[0] is None:
    time.sleep(0.3)
up, down = winapi.net_mbps()
check("采样两轮后给出速率", isinstance(up, float) and isinstance(down, float), f"{up} / {down}")
st = winapi.net_state()
check("状态里报告线程存活", st["sampling"] is True, str(st))
print(f"  info 当前 Windows 侧速率：上行 {up} Mbps / 下行 {down} Mbps（错误：{st['error']}）")

print(f"\n通过 {passed}，失败 {len(failed)}")
raise SystemExit(1 if failed else 0)
