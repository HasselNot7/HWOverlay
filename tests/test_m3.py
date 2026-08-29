"""M3 的纯函数测试：不启停 AIDA64、不写它的 ini。

用真实的 aida64.ini 做**只读**往返验证（复制到临时目录再改），
以及用真实共享内存标定值验证预算模型。apply() 不在这里测 —— 它会重启外部程序。
"""

import json
import shutil
import sys
import tempfile
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


def t_ini_roundtrip():
    print("\n[ini 定点改写]")
    if not LIVE_INI.is_file():
        print("  skip 找不到 aida64.ini，跳过")
        return
    with tempfile.TemporaryDirectory() as td:
        copy = Path(td) / "aida64.ini"
        shutil.copy2(LIVE_INI, copy)

        raw_before = copy.read_bytes()
        lines = ini.load(copy)
        copy.write_text(ini.dump(lines), encoding=ini.ENCODING, newline="")
        check("不改任何东西时字节级往返一致", copy.read_bytes() == raw_before,
              f"{len(raw_before)} -> {len(copy.read_bytes())}")

        ids = ["SCPUUTI", "TCPUPKG", "TGPU1"]
        bak, hit = ini.set_items(copy, ids)
        check("命中并改写 HWMonExtAppItems", hit)
        check("备份文件已生成", bak.is_file())
        ok, detail = ini.verify_untouched(copy, lines)
        check("除目标键外其余行未被改动", ok, detail)
        check("回读得到刚写入的 ID 列表", ini.get_items(ini.load(copy)) == ids)
        check("UTF-16 BOM 保留", copy.read_bytes()[:2] == b"\xff\xfe")

        _, found = ini.replace_line(lines, "NO_SUCH_KEY_X", "1")
        check("目标键不存在时 replace_line 报告未命中", not found)
        with tempfile.TemporaryDirectory() as td2:
            orphan = Path(td2) / "other.ini"
            _write = ini._write
            _write(orphan, "\r\n".join(["[General]", "Foo=1"]))
            try:
                ini.set_items(orphan, ids, backup=False)
                check("目标键不存在时 set_items 拒绝写入而非盲加", False, "没有抛错")
            except KeyError:
                after = ini.dump(ini.load(orphan))
                check("目标键不存在时 set_items 拒绝写入而非盲加",
                      "Foo=1" in after and ini.ITEMS_KEY not in after, after[:80])


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


def t_apply_is_gated():
    print("\n[危险入口]")
    r = controller.apply(["SCPUUTI"])
    check("apply() 不带 confirm 时拒绝执行", r.get("applied") is False, str(r)[:120])
    st = controller.status()
    check("status() 只读且能拿到 ini 路径", bool(st["ini"]))


if __name__ == "__main__":
    t_ini_roundtrip()
    t_budget()
    t_needed()
    t_apply_is_gated()
    print(f"\n通过 {passed}，失败 {len(failed)}")
    if failed:
        print("失败项：" + ", ".join(failed))
    raise SystemExit(1 if failed else 0)
