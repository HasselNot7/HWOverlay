import {
  addToast, Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  Table, TableBody, TableCell, TableColumn, TableHeader, TableRow,
} from "@heroui/react";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { fmt } from "../api";
import type { Metric } from "../types";
import type { Shared } from "../App";
import { CARD_CLS, Hint, Page, Section } from "../ui";

/** 指标总表：每个指标的当前值、来源、是否被版式引用、候选传感器 ID。
 * 行内可删除 —— 删掉的指标回"自定义指标"的未知池，注册表里不再占用。 */
export default function MetricsTablePage({ shared }: { shared: Shared }) {
  const { metrics, hw, check } = shared;
  const [pending, setPending] = useState<Metric | null>(null);
  const used = new Set(check?.referenced || []);
  const dig = (obj: unknown, path: string): unknown =>
    path.split(".").reduce((n: unknown, k: string) =>
      n != null && typeof n === "object" ? (n as Record<string, unknown>)[k] : null, obj);

  const remove = async () => {
    if (!pending) return;
    const m = pending;
    setPending(null);
    try {
      const rep = await fetch(`/api/metrics/custom?id=${encodeURIComponent(m.id)}`, { method: "DELETE" })
        .then(r => r.json()) as { removed: boolean; error?: string };
      if (!rep.removed) {
        addToast({ title: "删除失败", description: rep.error, color: "danger" });
        return;
      }
      addToast({
        title: `已删除「${m.name}」`,
        description: "它的传感器回到了「自定义指标」的未知池；版式里引用它的地方会显示 --",
        color: "success",
      });
      await shared.reloadMetrics();
      await shared.refreshAll();
    } catch (e) {
      addToast({ title: "删除失败", description: String(e), color: "danger" });
    }
  };

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
              <TableColumn> </TableColumn>
            </TableHeader>
            <TableBody
              emptyContent="一个指标都没有 —— 去「自定义指标」注册传感器，或一键加载默认指标集"
              isLoading={!metrics || !hw}>
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
                    <TableCell>
                      <Button isIconOnly size="sm" variant="light" radius="full"
                        className="h-7 w-7 min-w-0 text-default-400 hover:text-danger"
                        title="删除这个指标（回未知池）" onPress={() => setPending(m)}>
                        <Trash2 size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <Hint className="mt-2 text-xs">
          ⚠ = 速率类，单位由 AIDA64 自动换算且不带字段，已按实测标定；灰色行是版式没用到的指标。
          删除只影响本软件的注册表，不会碰 AIDA64 的配置。
        </Hint>
      </Section>

      <Modal isOpen={!!pending} onOpenChange={open => { if (!open) setPending(null); }} size="sm">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex-col gap-1">删除「{pending?.name}」？</ModalHeader>
              <ModalBody>
                <p className="text-sm leading-6 text-color-desc">
                  删除后它的传感器回到「自定义指标」的未知池，随时可以再注册回来；
                  版式里引用它的地方会显示 --。AIDA64 那边不受任何影响。
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" className="bg-[#27272a]" onPress={onClose}>取消</Button>
                <Button color="danger" onPress={() => { onClose(); remove(); }}>删除</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </Page>
  );
}
