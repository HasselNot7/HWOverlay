import { Modal, Table, toast } from "@heroui/react";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { fmt } from "../api";
import type { Metric } from "../types";
import type { Shared } from "../App";
import { Btn, CARD_CLS, Hint, Page, Section} from "../ui";

const TH_CLS = "border-b border-white/[0.04] bg-transparent text-xs font-normal text-muted";

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
        toast.danger("删除失败", { description: rep.error, timeout: 6000 });
        return;
      }
      toast.success(`已删除「${m.name}」`, { description: "传感器已回未知池", timeout: 2000 });
      await shared.reloadMetrics();
      await shared.refreshAll();
    } catch (e) {
      toast.danger("删除失败", { description: String(e), timeout: 6000 });
    }
  };

  return (
    <Page title="指标总表">
      <Section title="全部指标" divider={false}>
        <div className={`px-2 py-1 ${CARD_CLS}`}>
          {!metrics || !hw ? (
            <Hint className="py-4">载入中…</Hint>
          ) : (
            <Table>
              <Table.ScrollContainer>
              <Table.Content aria-label="指标总表">
                <Table.Header>
                  <Table.Column className={TH_CLS}>指标</Table.Column>
                  <Table.Column className={TH_CLS}>当前值</Table.Column>
                  <Table.Column className={TH_CLS}>来源</Table.Column>
                  <Table.Column className={TH_CLS}>用于版式</Table.Column>
                  <Table.Column className={TH_CLS}>候选传感器 ID</Table.Column>
                  <Table.Column className={TH_CLS}> </Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <span className="block py-6 text-center text-sm text-muted">
                      还没有指标 —— 去「自定义指标」注册，或一键加载默认指标集
                    </span>
                  )}>
                  {metrics.map(m => {
                    const out = m.out || m.id;
                    const v = m.out ? dig(hw, m.out) : null;
                    const src = hw?.sources?.[m.id];
                    const isUsed = used.has(out);
                    return (
                      <Table.Row key={m.id} className={isUsed ? "" : "opacity-45"}>
                        <Table.Cell>{m.name}{m.rate_untrusted ? " ⚠" : ""}</Table.Cell>
                        <Table.Cell className="text-right font-poppins tabular-nums">{fmt(v, m)}</Table.Cell>
                        <Table.Cell className="font-jetbrains text-xs text-muted">{src || "无数据"}</Table.Cell>
                        <Table.Cell>{isUsed ? "是" : "—"}</Table.Cell>
                        <Table.Cell className="font-jetbrains text-xs text-muted">
                          {(m.sources?.aida64 || []).join(" ") || m.agg || "winapi"}
                        </Table.Cell>
                        <Table.Cell>
                          <Btn isIconOnly size="sm" variant="ghost"
                            className="h-7 w-7 rounded-full text-muted hover:text-danger"
                            title="删除这个指标（回未知池）" onPress={() => setPending(m)}>
                            <Trash2 size={14} />
                          </Btn>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </div>
        <Hint className="mt-2 text-xs">
          灰色行为未使用的指标
        </Hint>
      </Section>

      <Modal>
        <Modal.Backdrop isOpen={!!pending} onOpenChange={open => { if (!open) setPending(null); }}>
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>删除「{pending?.name}」？</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm leading-6 text-color-desc">
                  传感器回未知池，随时可再注册；版式引用处会显示 --。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Btn variant="secondary" className="bg-[#27272a]" onPress={() => setPending(null)}>取消</Btn>
                <Btn variant="danger" onPress={remove}>删除</Btn>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Page>
  );
}
