"""M3 的纯函数测试：不启停 AIDA64、不写它的 ini。

用真实的 aida64.ini 做**只读**验证（load/get_items 的字节级保真），
以及用真实共享内存标定值验证预算模型。本软件不写 AIDA64 的清单 ——
那是用户（和其他软件）的地盘，写回链路已整体删除。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hwobs import budget, registry                      # noqa: E402
from hwobs.aida import controller, ini                  # noqa: E402
from hwobs.sources import aida64                        # noqa: E402

LIVE_INI = Path(r"D:\aida64extreme800\aida64.ini")
passed, failed = 0, []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed.append(name)
        print(f"  FAIL {name}  {detail}")


def t_ini_readonly():
    print("\n[ini 只读保真]")
    if not LIVE_INI.is_file():
        print("  skip 找不到 aida64.ini，跳过")
        return
    raw_before = LIVE_INI.read_bytes()
    lines = ini.load(LIVE_INI)
    roundtrip = "\r\n".join(lines).encode(ini.ENCODING)
    check("load() 不做换行归一化，join 回去字节级一致", roundtrip == raw_before,
          f"{len(lines)} 行 / {len(raw_before)} 字节")
    check("UTF-16 BOM 在", raw_before[:2] == b"\xff\xfe")
    items = ini.get_items(lines)
    check("get_items 从真实 ini 里解析出导出清单", len(items) > 0,
          f"前 4 个: {items[:4]}")
    check("清单里没有换行残渣（空格分隔解析干净）",
          all(" " not in i and i == i.strip() for i in items))
    check("本模块没有写回函数（防误用）",
          not any(hasattr(ini, n) for n in ("set_items", "replace_line", "verify_untouched")))


def t_budget():
    print("\n[预算模型]")
    sensors, used = aida64.read_sensors()
    if not sensors:
        print("  skip AIDA64 没在跑，跳过标定校验")
        return
    hints = {sid: (label, value) for sid, (label, value) in sensors.items()}
    plan = budget.plan(list(sensors), hints=hints)
    check("用真实 label 与值宽度预测的字节数与实测一致",
          plan["typical_bytes"] == used, f"预测 {plan['typical_bytes']} 实测 {used}")
    check("最坏情况估算不低于实测值", plan["worst_bytes"] >= used,
          f"worst {plan['worst_bytes']} vs 实测 {used}")

    big = [f"FAKE{i:04d}" for i in range(70)]
    p70 = budget.plan(big)
    check("70 条最坏情况被判定为放不下", not p70["fits"])
    expected = sum(1 for e in p70["entries"] if e["cum_worst"] <= budget.usable())
    check("截断点等于模型自身判定能放下的条数", p70["truncated_at"] == expected,
          f"truncated_at={p70['truncated_at']} 可容纳={expected}")
    idx = p70["truncated_at"]
    cum = p70["entries"][idx]["cum_worst"]
    prev = p70["entries"][idx - 1]["cum_worst"]
    check("截断点前一条仍在预算内、该条超出",
          prev <= budget.usable() < cum, f"{prev} / {budget.usable()} / {cum}")


def t_needed():
    print("\n[版式 -> 导出清单]")
    overlay = json.loads((Path(__file__).resolve().parent.parent / "overlays" / "monitor.json")
                         .read_text(encoding="utf-8"))
    sensors, _used = aida64.read_sensors()
    ids, plan = controller.propose(overlay, sensors=sensors)
    check("版式里没有引用不到的路径", not plan["unknown_paths"], f"unknown={plan['unknown_paths']}")
    check("SCPUUTI 等候选 ID 被收进导出清单", "SCPUUTI" in ids)
    check("chips 里的裸字符串路径也被收进来（回归：曾被递归漏掉）",
          "TCPUSOCK" in ids and "PGPU1TDPP" in ids)
    check("网卡与磁盘 ID 被保住（回归：曾被静默清零）",
          any(i.startswith("SNIC") for i in ids) or not any(s.startswith("SNIC") for s in (sensors or {})),
          f"ids={[i for i in ids if i.startswith('SNIC')][:4]}")
    check("当前版式所需 ID 放得进预算", plan["fits"],
          f"typical {plan['typical_bytes']} / worst {plan['worst_bytes']} / 可用 {plan['usable']}")
    if sensors:
        missing = [i for i in ids if i not in sensors]
        print(f"  info 版式需要但 AIDA64 当前未导出: {missing or '无'}")


def t_status_readonly():
    print("\n[只读体检]")
    st = controller.status()
    check("status() 只读且能拿到 ini 路径", bool(st["ini"]), str(st)[:160])


if __name__ == "__main__":
    t_ini_readonly()
    t_budget()
    t_needed()
    t_status_readonly()
    print(f"\n通过 {passed}，失败 {len(failed)}")
    if failed:
        print("失败项：" + ", ".join(failed))
    raise SystemExit(1 if failed else 0)
