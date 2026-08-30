"""自定义指标（用户指标）的纯函数测试：合并、保存、删除、未知传感器识别。

用户指标存 metrics.user.json（可写数据目录），load() 时合并进注册表；
custom 条目不进 matched（冻结的回归契约）。全部用临时文件，不碰真实数据。
"""

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from hwobs import registry                     # noqa: E402

passed, failed = 0, []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}  {detail}")


td = tempfile.TemporaryDirectory()
USER = Path(td.name) / "metrics.user.json"
SENSORS = {"THDD1": ("KIOXIA SSD", "37"), "SCPUUTI": ("CPU Utilization", "20"),
           "SNIC9CONNSPD": ("NIC9 Connection Speed", "360")}


print("[未知传感器识别]")
base = registry.load()
unclaimed = registry.unclaimed_ids(SENSORS, reg=base)
check("SCPUUTI 已注册，不算未知", "SCPUUTI" not in unclaimed, str(unclaimed))
check("THDD1 没有注册，是未知传感器", "THDD1" in unclaimed, str(unclaimed))
check("CONNSPD 已被 net_linkspeed 的正则认领，不算未知", "SNIC9CONNSPD" not in unclaimed, str(unclaimed))
check("凭空造出的 ID 算未知", "TFAKE9" in registry.unclaimed_ids(
    dict(SENSORS, TFAKE9=("Fake", "1")), reg=base))

print("\n[注册成自定义指标]")
entry, err = registry.save_custom(
    {"sensor_id": "THDD1", "name": "SSD 温度", "unit": "°C", "digits": 0, "na_zero": True},
    sensors=SENSORS, user_path=USER, reg=base)
check("注册成功", entry is not None, str(err))
check("id 由传感器 ID 生成", entry["id"] == "custom_thdd1", str(entry))
check("out 落在 custom. 命名空间", entry["out"] == "custom.thdd1", str(entry))
check("带 custom 标记", entry.get("custom") is True)
check("用户文件已写盘且是合法 JSON", USER.is_file() and json.loads(USER.read_text(encoding="utf-8")))

merged = registry._merge_user(registry.json.loads(registry.REGISTRY_FILE.read_text(encoding="utf-8")), USER)
by_id = {m["id"]: m for m in merged["metrics"]}
check("合并后注册表里有它", "custom_thdd1" in by_id)

print("\n[重复注册与校验]")
dup, err = registry.save_custom({"sensor_id": "THDD1", "name": "再来一次"},
                                sensors=SENSORS, user_path=USER, reg=merged)
check("重复注册被拒绝", dup is None and "已经注册" in err, str(err))
bad, err = registry.save_custom({"sensor_id": "NOPE1", "name": "x"},
                                sensors=SENSORS, user_path=USER, reg=merged)
check("传感器不在导出清单被拒绝", bad is None and "NOPE1" in err, str(err))
bad, err = registry.save_custom({"sensor_id": "THDD2", "name": ""},
                                sensors=SENSORS, user_path=USER, reg=merged)
check("空名字被拒绝", bad is None, str(err))

print("\n[resolve：custom 不进 matched，sources 照常]")
vals, matched, missing, sources = registry.resolve(SENSORS, merged)
check("值被解析出来", vals["custom_thdd1"] == 37, str(vals.get("custom_thdd1")))
check("matched 不含 custom（冻结契约）", "custom_thdd1" not in matched, str(matched.keys()))
check("sources 照常指向传感器", sources["custom_thdd1"] == "aida64:THDD1", str(sources.get("custom_thdd1")))

print("\n[删除]")
ok = registry.remove_custom("custom_thdd1", user_path=USER)
check("删除成功", ok is True)
check("注册表即时生效（reload 后消失）",
      "custom_thdd1" not in {m["id"] for m in registry.load(user_path=USER)["metrics"]})
check("再删一次明确返回 False", registry.remove_custom("custom_thdd1", user_path=USER) is False)

td.cleanup()
print(f"\n通过 {passed}，失败 {len(failed)}")
raise SystemExit(1 if failed else 0)
