import { fmt } from "../api";
import type { Shared } from "../App";

/** 指标总表：每个指标的当前值、来源、是否被版式引用、候选传感器 ID。 */
export default function MetricsTablePage({ shared }: { shared: Shared }) {
  const { metrics, hw, check } = shared;
  if (!metrics || !hw) {
    return (
      <>
        <h1 className="mb-5 text-[21px] font-bold">指标总表</h1>
        <div className="rounded-2xl border border-divider bg-content1 p-6 text-sm text-default-500">载入中…</div>
      </>
    );
  }
  const used = new Set(check?.referenced || []);
  const dig = (obj: unknown, path: string): unknown =>
    path.split(".").reduce((n: unknown, k: string) =>
      n != null && typeof n === "object" ? (n as Record<string, unknown>)[k] : null, obj);

  return (
    <>
      <h1 className="mb-5 text-[21px] font-bold">指标总表</h1>
      <div className="rounded-2xl border border-divider bg-content1 p-5 shadow-lg">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              {["指标", "当前值", "来源", "用于版式", "候选传感器 ID"].map(h => (
                <th key={h} className="border-b border-divider px-2 py-1.5 text-left text-xs font-normal tracking-wide text-default-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => {
              const out = m.out || m.id;
              const v = m.out ? dig(hw, m.out) : null;
              const src = hw.sources?.[m.id];
              const isUsed = used.has(out);
              return (
                <tr key={m.id} className="border-b border-divider hover:bg-primary/5">
                  <td className={`px-2 py-1.5 ${m.rate_untrusted ? "" : ""}`}>
                    {m.name}{m.rate_untrusted ? " ⚠" : ""}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(v, m)}</td>
                  <td className="px-2 py-1.5 text-xs text-default-500">{src || "无数据"}</td>
                  <td className={`px-2 py-1.5 ${isUsed ? "" : "opacity-45"}`}>{isUsed ? "是" : "—"}</td>
                  <td className={`px-2 py-1.5 text-xs text-default-500 ${isUsed ? "" : "opacity-45"}`}>
                    {(m.sources?.aida64 || []).join(" ") || m.agg || "winapi"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-2 text-xs text-default-500">
          ⚠ = 速率类，单位由 AIDA64 自动换算且不带字段，已按实测标定；灰色行是版式没用到的指标。
        </div>
      </div>
    </>
  );
}
