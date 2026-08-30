import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@heroui/react";
import { fmt } from "../api";
import type { Shared } from "../App";
import { CARD_CLS, Hint, Page, Section } from "../ui";

/** 指标总表：每个指标的当前值、来源、是否被版式引用、候选传感器 ID。 */
export default function MetricsTablePage({ shared }: { shared: Shared }) {
  const { metrics, hw, check } = shared;
  const used = new Set(check?.referenced || []);
  const dig = (obj: unknown, path: string): unknown =>
    path.split(".").reduce((n: unknown, k: string) =>
      n != null && typeof n === "object" ? (n as Record<string, unknown>)[k] : null, obj);

  return (
    <Page title="指标总表">
      <Section title="全部指标" divider={false}>
        <div className={`px-2 py-1 ${CARD_CLS}`}>
          <Table
            aria-label="指标总表" removeWrapper
            classNames={{
              th: "rounded-none border-b border-white/[0.04] bg-transparent text-xs font-normal text-default-500",
              td: "text-sm",
            }}
          >
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
                    <TableCell className="text-right font-poppins tabular-nums">{fmt(v, m)}</TableCell>
                    <TableCell className="font-poppins text-xs text-default-500">{src || "无数据"}</TableCell>
                    <TableCell>{isUsed ? "是" : "—"}</TableCell>
                    <TableCell className="font-poppins text-xs text-default-500">
                      {(m.sources?.aida64 || []).join(" ") || m.agg || "winapi"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <Hint className="mt-2 text-xs">
          ⚠ = 速率类，单位由 AIDA64 自动换算且不带字段，已按实测标定；灰色行是版式没用到的指标。
        </Hint>
      </Section>
    </Page>
  );
}
