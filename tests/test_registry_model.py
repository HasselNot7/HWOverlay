"""0.3.0 注册表模型：用户文件即注册表，内置集是可一键加载的预设。

分发场景的四个不变量：
- 新装机（无用户文件）= 空注册表，所有导出传感器都是"未知"；
- seed_builtin 幂等整包注册，不覆盖用户已有的条目；
- 删除任何指标（预设/自定义）= 回未知池；
- 旧版用户文件（无 preset_seeded 标记）首次加载自动补齐内置集，无感迁移。
全部用临时文件，不碰真实数据。
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
SENSORS = {"SCPUUTI": ("CPU Utilization", "20"), "THDD1": ("KIOXIA SSD", "37")}
BUILTIN_COUNT = len(json.loads(registry.REGISTRY_FILE.read_text(encoding="utf-8"))["metrics"])

print("[新装机：空注册表]")
USER = Path(td.name) / "metrics.user.json"
reg = registry.load(user_path=USER)
check("没有用户文件时注册表为空", reg["metrics"] == [])
check("速率单位等元数据仍在", reg.get("rate_unit") == "KB/s")
check("所有导出传感器都是未知", set(registry.unclaimed_ids(SENSORS, reg=reg)) == set(SENSORS))

print("\n[一键注册默认指标集]")
added = registry.seed_builtin(user_path=USER)
check(f"整包注册（内置 {BUILTIN_COUNT} 条）", len(added) == BUILTIN_COUNT, str(len(added)))
reg = registry.load(user_path=USER)
check("SCPUUTI 被认领", registry.unclaimed_ids(SENSORS, reg=reg) == ["THDD1"],
      str(registry.unclaimed_ids(SENSORS, reg=reg)))
check("条目带 preset 标记", all(m.get("preset") for m in reg["metrics"]))
check("文件打上 preset_seeded 标记",
      json.loads(USER.read_text(encoding="utf-8")).get("preset_seeded") is True)
check("幂等：再点一次一个不加", registry.seed_builtin(user_path=USER) == [])

print("\n[空注册表上也能手动注册]")
entry, err = registry.save_custom({"sensor_id": "THDD1", "name": "SSD 温度", "unit": "°C", "digits": 0},
                                  sensors=SENSORS, user_path=USER, reg=reg)
check("注册成功", entry is not None, str(err))

print("\n[删除回未知池]")
check("删除预设指标成功", registry.remove_custom("cpu_usage", user_path=USER) is True)
reg = registry.load(user_path=USER)
check("删掉后从注册表消失", registry.by_id("cpu_usage", reg) is None)
check("它的传感器回到未知池", "SCPUUTI" in registry.unclaimed_ids(SENSORS, reg=reg))
check("再删一次明确返回 False", registry.remove_custom("cpu_usage", user_path=USER) is False)
check("自定义指标删除照常", registry.remove_custom(entry["id"], user_path=USER) is True)

print("\n[旧版用户文件无感迁移]")
USER2 = Path(td.name) / "old.metrics.user.json"
USER2.write_text(json.dumps({"version": 1, "metrics": [
    {"id": "custom_old", "out": "custom.old", "name": "老自定义", "custom": True,
     "sources": {"aida64": ["SCPUUTI"]}}]}), encoding="utf-8")
reg = registry.load(user_path=USER2)
ids = {m["id"] for m in reg["metrics"]}
check("老自定义还在", "custom_old" in ids)
check(f"内置集自动补齐（>= {BUILTIN_COUNT} 条）",
      "cpu_usage" in ids and len(ids) >= BUILTIN_COUNT, str(len(ids)))
check("文件打上迁移标记",
      json.loads(USER2.read_text(encoding="utf-8")).get("preset_seeded") is True)
vals, matched, _missing, _src = registry.resolve(SENSORS, reg)
check("老自定义仍不进 matched（冻结契约）", "custom_old" not in matched)
check("老自定义的值照常解析", vals["custom_old"] == 20, str(vals.get("custom_old")))

td.cleanup()
print(f"\n通过 {passed}，失败 {len(failed)}")
raise SystemExit(1 if failed else 0)
