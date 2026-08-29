"""4096 字节预算：选指标本质上是在分配字节。

成本模型是拿真实共享内存标定出来的，不是估的：
重建每条 <cat><id>..</id><label>..</label><value>..</value></cat> 后与实际内容逐字节相等
（30 条 / 2212 字节，平均 73.7 B），固定开销 = 44 + 2×类别名长度。

label 长度只有 AIDA64 自己知道（实测 3~26 字节，最长是 SSD 型号名），
所以未探测过的 ID 一律按最坏情况计，宁少报几个也别写爆 —— 写爆是静默截断。
"""

SHM_LIMIT = 4096
FIXED_BASE = 44
DEFAULT_CAT_LEN = 4       # 没见过的 ID 保守按最长的类别名算
DEFAULT_LABEL_LEN = 28    # 实测最长 26，留一点余量
DEFAULT_VALUE_LEN = 6     # "1234.5" / "-56"
SAFETY = 0.15             # 安全垫：label 猜错也不至于截断

# AIDA64 的 XML 标签名由 ID 首字母决定（本机 30 条全部吻合）。开闭标签各算一次，
# 所以 3 字符的 sys/fan/pwr 比 4 字符的 temp/volt 每条少 2 字节。
CAT_BY_PREFIX = {"S": "sys", "T": "temp", "F": "fan", "V": "volt", "P": "pwr"}


def cat_len_for(sid, cat_len=None):
    if cat_len is not None:
        return cat_len
    return len(CAT_BY_PREFIX.get(sid[:1], "x" * DEFAULT_CAT_LEN))


def entry_cost(sid, label_len=DEFAULT_LABEL_LEN, cat_len=None, value_len=DEFAULT_VALUE_LEN):
    return FIXED_BASE + 2 * cat_len_for(sid, cat_len) + len(sid) + label_len + value_len


def usable(limit=SHM_LIMIT, safety=SAFETY):
    return int(limit * (1 - safety))


def plan(ids, hints=None, limit=SHM_LIMIT, safety=SAFETY):
    """ids 按期望的导出顺序排列。

    hints: {传感器ID: (label 文本, 值字符串)} —— 来自一次真实探测。
    有 hint 的条目按实际长度算（可逐字节还原真实占用），
    没探测过的 ID 一律按最坏情况算，宁少报几条也别写爆 —— 写爆是静默截断。
    返回的 truncated_at 是第一条放不下的下标。
    """
    hints = hints or {}
    cap = usable(limit, safety)
    worst = typical = 0
    truncated_at = None
    rows = []
    for i, sid in enumerate(ids):
        hint = hints.get(sid)
        c_worst = entry_cost(sid)
        c_typ = entry_cost(sid, label_len=len(hint[0]), value_len=len(hint[1])) if hint else c_worst
        worst += c_worst
        typical += c_typ
        if truncated_at is None and worst > cap:
            truncated_at = i
        rows.append({"id": sid, "worst": c_worst, "typical": c_typ, "cum_worst": worst})

    return {
        "limit": limit,
        "usable": cap,
        "count": len(ids),
        "worst_bytes": worst,
        "typical_bytes": typical,
        "fits": truncated_at is None,
        "truncated_at": truncated_at,
        "capacity_worst": len(ids) - truncated_at if truncated_at is not None else None,
        "entries": rows,
    }
