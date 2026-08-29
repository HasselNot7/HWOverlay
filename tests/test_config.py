"""配置写入路径的测试：校验不过就不落盘、原子替换、备份与回滚、v1 迁移。

直接对临时副本调用 config.save/rollback，不依赖服务在跑。
曾经测出的真 bug：请求体是 JSON 数组时 validate() 先于结构检查执行，
对 list 调 cfg.get() 抛 AttributeError，异常没兜住 → 连接裸退无响应。
"""

import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from hwobs import config    # noqa: E402

REAL = config.OVERLAY_FILE
REAL_BYTES = REAL.read_bytes()
passed, failed = 0, []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}  {detail}")


def fresh():
    """把真实配置复制到临时目录，所有写操作只碰临时文件。"""
    td = tempfile.TemporaryDirectory()
    p = Path(td.name) / "monitor.json"
    shutil.copy2(REAL, p)
    return td, p


cfg = json.loads(REAL.read_text(encoding="utf-8"))

print("[v1 -> v2 迁移]")
v1 = json.loads(json.dumps(cfg))
v1.pop("version", None)
v1["rows"], v1["widgets"] = v1["widgets"], None
m = config.migrate(v1)
check("rows 改名为 widgets", m["widgets"] == cfg["widgets"] and "rows" not in m)
check("版本号补成 2", m["version"] == 2)
check("v2 原样返回（不深拷贝也行）", config.migrate(cfg) is cfg)
check("非 dict 不炸", config.migrate([1]) == [1])
td, p = fresh()
p.write_text(json.dumps(v1), encoding="utf-8")     # 磁盘上放一份 v1
r = config.read(p)
check("read() 读 v1 得到 v2", r["widgets"] == cfg["widgets"] and "rows" not in r)
saved, rep = config.save(v1, path=p)
check("v1 入参保存成功且落盘为 v2",
      saved and json.loads(p.read_text(encoding="utf-8"))["version"] == 2, str(rep["errors"]))
td.cleanup()

print("\n[结构底线：畸形请求体不能崩]")
for name, junk in [("数组", [1, 2, 3]), ("null", None), ("字符串", "hello"), ("数字", 42)]:
    try:
        saved, rep = config.save(junk)
        check(f"{name} 被拒且返回可读错误", not saved and bool(rep["errors"]), str(rep)[:120])
    except Exception as e:      # noqa: BLE001
        check(f"{name} 被拒且返回可读错误", False, f"抛异常 {type(e).__name__}: {e}")

td, p = fresh()
before = p.read_text(encoding="utf-8")
bad = json.loads(json.dumps(cfg))
bad["widgets"] = []
saved, rep = config.save(bad, path=p)
check("widgets 为空被拒", not saved and any("widgets" in e for e in rep["errors"]),
      str(rep["errors"]))
check("被拒时文件一字节未动", p.read_text(encoding="utf-8") == before)

print("\n[校验不过就不落盘]")
bad2 = json.loads(json.dumps(cfg))
bad2["widgets"][1]["items"].append("gpu.does_not_exist")
saved, rep = config.save(bad2, path=p)
check("引用不存在的路径被拒", not saved and any("does_not_exist" in e for e in rep["errors"]))
check("文件仍未改动", p.read_text(encoding="utf-8") == before)

too_tall = json.loads(json.dumps(cfg))
too_tall["widgets"][0]["cols"] = 3     # 4 张卡塞 3 列 -> 换行 -> 底部被裁
saved, rep = config.save(too_tall, path=p)
check("会导致裁切的版式被拒", not saved and any("裁" in e for e in rep["errors"]), str(rep["errors"]))
check("裁切版式同样没落盘", p.read_text(encoding="utf-8") == before)

print("\n[正常写入与回滚]")
base_h = cfg["canvas"]["h"]
alt_h = 166 if base_h != 166 else 176        # 只要求"与基准不同"，不假设基准是多少
good = json.loads(json.dumps(cfg))
good["canvas"]["h"] = alt_h
saved, rep = config.save(good, path=p)
check("合法修改写入成功", saved, str(rep["errors"]))
check("落盘内容就是提交的", json.loads(p.read_text(encoding="utf-8"))["canvas"]["h"] == alt_h)
check("备份保留了旧内容",
      json.loads(p.with_suffix(".json.bak").read_text(encoding="utf-8"))["canvas"]["h"] == base_h)
check("没有残留 .tmp 文件", not list(p.parent.glob("*.tmp")))

saved, rep = config.rollback(path=p)
check("回滚成功", saved and json.loads(p.read_text(encoding="utf-8"))["canvas"]["h"] == base_h)

print("\n[幂等与边界]")
saved, rep = config.save(cfg, path=p)   # 先规范一次排版（回滚恢复的是原始排版，字节不同）
check("语义相同的保存成功并规范格式", saved, str(rep["errors"]))
before2 = p.read_text(encoding="utf-8")
baks = list(p.parent.glob("*.bak"))
saved, rep = config.save(cfg, path=p)
check("内容未变时不重复备份", rep.get("unchanged") is True and len(list(p.parent.glob("*.bak"))) == len(baks),
      str(rep.get("unchanged")))
check("未变化也不改文件", p.read_text(encoding="utf-8") == before2)

td2, p2 = fresh()
p2.with_suffix(".json.bak").unlink(missing_ok=True)
ok, rep = config.rollback(path=p2)
check("没有备份时回滚明确失败而不是崩", ok is False and rep is None)

check("真实配置文件全程未被改动", REAL.read_bytes() == REAL_BYTES)
td.cleanup(); td2.cleanup()

print(f"\n通过 {passed}，失败 {len(failed)}")
raise SystemExit(1 if failed else 0)
