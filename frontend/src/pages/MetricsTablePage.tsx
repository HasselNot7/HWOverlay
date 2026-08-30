import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@heroui/react";
import { fmt } from "../api";
import type { Shared } from "../App";

/** 指标总表：每个指标的当前值、来源、是否被版式引用、候选传感器 ID。 */
export default function MetricsTablePage({ shared }: { shared: Shared }) {
  const { metrics, hw, check } = shared;
  const used = new Set(check?.referenced || []);
  const dig = (obj: unknown, path: string): unknown =>
    path.split(".").reduce((n: unknown, k: string) =>
      n != null && typeof n === "object" ? (n as Record<string, unknown>)[k] : null, obj);

  return (
    <>
      <h1 className="mb-5 text-[21px] font-bold">指标总表</h1>
      <div className="rounded-2xl border border-divider bg-content1 p-5 shadow-lg">
        <Table aria-label="指标总表" removeWrapper className="text-[13px]">
          <TableHeader>
            <TableColumn>指标</TableColumn>
            <TableColumn>当前值</TableColumn>
            <TableColumn>来源</TableColumn>
            <TableColumn>用于版式</TableColumn>
            <TableColumn>候选传感器 ID</TableColumn>
          </TableHeader>
          <TableBody emptyContent="载入中…" isLoading={!metrics || !hw}>
            {(metrics || []).map(m => {
              const out = m.out || m.id;
              const v = m.out ? dig(hw, m.out) : null;
              const src = hw?.sources?.[m.id];
              const isUsed = used.has(out);
              return (
                <TableRow key={m.id} className={isUsed ? "" : "opacity-45"}>
                  <TableCell>{m.name}{m.rate_untrusted ? " ⚠" : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(v, m)}</TableCell>
                  <TableCell className="text-xs text-default-500">{src || "无数据"}</TableCell>
                  <TableCell>{isUsed ? "是" : "—"}</TableCell>
                  <TableCell className="text-xs text-default-500">
                    {(m.sources?.aida64 || []).join(" ") || m.agg || "winapi"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="mt-2 text-xs text-default-500">
          ⚠ = 速率类，单位由 AIDA64 自动换算且不带字段，已按实测标定；灰色行是版式没用到的指标。
        </div>
      </div>
    </>
  );
}
