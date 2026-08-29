"""标定器的纯函数测试：不需要真实流量。

流量不足时 measure() 必须给 low confidence 并说明原因，而不是硬选一个单位 ——
这条也在这里断言（用无流量的窗口会太慢，改为断言判定分支）。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hwobs import calibrate    # noqa: E402
from hwobs import registry     # noqa: E402

passed, failed = 0, []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}  {detail}")


print("[单位归一]")
check("1024 归到 KiB/s 并提示与 KB/s 难以区分",
      calibrate.match_factor(1024)["name"] == "KiB/s"
      and calibrate.match_factor(1024)["ambiguous_with"] == "KB/s")
check("1000 归到 KB/s 并提示与 KiB/s 难以区分",
      calibrate.match_factor(1000)["name"] == "KB/s"
      and calibrate.match_factor(1000)["ambiguous_with"] == "KiB/s")
check("125 归到 kbps 且无歧义",
      calibrate.match_factor(125)["name"] == "kbps"
      and calibrate.match_factor(125)["ambiguous_with"] is None)
check("125000 归到 Mbps", calibrate.match_factor(125_000)["name"] == "Mbps")
check("0 或 None 不抛错，返回空判定",
      calibrate.match_factor(0)["name"] is None
      and calibrate.match_factor(None)["name"] is None)
check("轻微噪声仍归到最近的真实单位",
      calibrate.match_factor(1021)["name"] == "KiB/s")

print("\n[与换算表的联动]")
reg = registry.load()
check("未标定时 registry 不带 bytes_per_unit 覆盖",
      reg.get("_bytes_per_unit") is None or isinstance(reg.get("_bytes_per_unit"), (int, float)),
      str(reg.get("_bytes_per_unit")))
m = {"convert": "rate_to_mbps"}
check("无标定时按单位名表换算（KB/s -> *8/1000）",
      abs(registry._convert(m, 1000, "KB/s") - 8.0) < 1e-9,
      str(registry._convert(m, 1000, "KB/s")))
check("标定过则用量出来的 bytes_per_unit（1024 -> *8/1024）",
      abs(registry._convert(m, 1000, "KB/s", 1024) - 7.8125) < 1e-6,
      str(registry._convert(m, 1000, "KB/s", 1024)))
check("MB/s 换算同样优先用标定值",
      abs(registry._convert({"convert": "rate_to_mb_per_s"}, 1000, "KB/s", 1024)
          - 1000 * 1024 / 1024 ** 2) < 1e-9)

print(f"\n通过 {passed}，失败 {len(failed)}")
raise SystemExit(1 if failed else 0)
