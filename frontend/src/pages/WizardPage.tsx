import { Button, Checkbox, Chip, Divider } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AidaPlan, ApplyResult } from "../types";
import type { Shared } from "../App";
import { Hint, Page, Section, SubTitle } from "../ui";

type StepKind = "done" | "todo" | "bad";

const KIND_CHIP = { done: "success", todo: "warning", bad: "danger" } as const;
const KIND_TEXT = { done: "已完成", todo: "待办", bad: "有问题" } as const;

/** 单个步骤：小节标题 + 状态点 Chip，正文用灰色说明。 */
function Step({ kind, title, children }: {
  kind: StepKind;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SubTitle right={
        <Chip size="sm" variant="dot" color={KIND_CHIP[kind]}>{KIND_TEXT[kind]}</Chip>
      }>{title}</SubTitle>
      {children}
    </div>
  );
}

const DiffChips = ({ ids, kind }: { ids: string[]; kind: "add" | "del" }) => (
  <div className="mt-1.5 flex flex-wrap gap-1.5">
    {ids.map(id => (
      <span key={id}
        className={`rounded-lg border px-1.5 py-0.5 text-xs font-poppins ${
          kind === "add"
            ? "border-default-100 bg-default-100/50 text-primary"
            : "border-default-100 text-default-500 line-through"
        }`}>
        {id}
      </span>
    ))}
  </div>
);

export default function WizardPage({ shared }: { shared: Shared }) {
  const [plan, setPlan] = useState<AidaPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pruneOpt, setPruneOpt] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "bad" | "warn" } | null>(null);
  const [busy, setBusy] = useState(false);
  const { status } = shared;

  const loadPlan = useCallback(async () => {
    try { setPlan(await api.aidaPlan()); } catch { setPlan(null); }
  }, []);

  useEffect(() => { loadPlan(); }, [loadPlan, shared.check]);

  const apply = async (prune: boolean) => {
    if (!plan) return;
    setBusy(true);
    setMsg({ text: "应用中：关闭 AIDA64 → 写 ini → 重启 → 回读校验…", kind: "warn" });
    try {
      const rep: ApplyResult = await api.aidaApply(plan.needed_count, prune);
      if (!rep.applied) {
        setMsg({ text: `✗ ${rep.reason || "未应用"}`, kind: "bad" });
      } else {
        setMsg({
          text: rep.rolled_back ? "✗ 已应用，但回读发现截断，已自动回滚——请减少指标"
            : "✓ 已应用，共享内存已更新",
          kind: rep.rolled_back ? "bad" : "ok",
        });
        await shared.refreshAll();
        await loadPlan();
      }
    } catch (e) {
      setMsg({ text: `✗ 请求失败：${e}`, kind: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const step2 = () => {
    if (!plan) return <Step kind="todo" title="② 读取导出清单…" />;
    if (plan.unchanged) {
      return (
        <Step kind="done" title="② 导出清单已满足版式">
          {plan.to_remove.length > 0 && (
            <Hint>
              另有 {plan.to_remove.length} 个传感器在清单里但本软件用不到
              （{plan.to_remove.join("、")}），默认保留——共享内存里的清单其他软件也可能在读。
            </Hint>
          )}
        </Step>
      );
    }
    if (!plan.fits && !plan.fits_prune) {
      return (
        <Step kind="bad" title="② 版式需要的传感器超出 4096 预算">
          <Hint>
            最坏 {plan.budget_new.worst_bytes} 字节 &gt; 可用 {plan.budget_new.usable}，
            从第 {(plan.budget_new.truncated_at ?? 0) + 1} 个起会被截断。回编辑器去掉几个小指标。
          </Hint>
        </Step>
      );
    }
    const overBudget = !plan.fits;
    const canApply = (plan.fits || (pruneOpt && plan.fits_prune)) && confirmed && !busy;
    return (
      <Step kind="todo" title={`② 导出清单需要补充（加 ${plan.to_add.length}）`}>
        <div className="flex flex-col gap-2 text-sm">
          <div>需增加 {plan.to_add.length} 个<DiffChips ids={plan.to_add} kind="add" /></div>
          <div className="text-color-desc">
            默认只加不删（保留清单里现有的 {plan.current_count} 个），
            预算 {plan.budget_now.worst_bytes} → {plan.budget_new.worst_bytes} / {plan.budget_new.usable} 字节
          </div>
          {plan.to_remove.length > 0 && (
            <div className="rounded-xl border border-white/[0.04] bg-[#1a1a1d] p-3">
              <div>另有 {plan.to_remove.length} 个本软件用不到：
                <DiffChips ids={plan.to_remove} kind="del" />
              </div>
              <Checkbox className="mt-1.5" isSelected={pruneOpt} onValueChange={setPruneOpt}>
                <span className="text-sm text-color-desc">
                  顺便从清单移除它们（省 {plan.prune_saves} 字节）——
                  注意清单里的传感器其他软件可能也在读，删了会影响它们
                </span>
              </Checkbox>
            </div>
          )}
          {overBudget && (
            <div className="text-warning">
              只加不删会超预算（{plan.budget_new.worst_bytes} / {plan.budget_new.usable} 字节）：
              {plan.fits_prune ? "要么回编辑器去掉几个指标，要么勾选上面的精简。" : "请回编辑器去掉几个指标。"}
            </div>
          )}
          <div className="mt-2 flex items-center gap-4">
            <Checkbox isSelected={confirmed} onValueChange={setConfirmed}>
              <span className="text-sm text-color-desc">
                我确认：这会关闭并重启 AIDA64，期间 OSD / 信息板会断流
              </span>
            </Checkbox>
            <Button
              color="primary" size="lg" className="px-7"
              isDisabled={!canApply} isLoading={busy}
              onPress={() => apply(pruneOpt)}
            >
              应用并重启 AIDA64
            </Button>
          </div>
          <div className="text-color-desc">
            原理：AIDA64 只把 HWMonExtAppItems 列出的传感器写进共享内存，且退出时才回写 ini。
          </div>
        </div>
      </Step>
    );
  };

  const step1 = !status ? (
    <Step kind="todo" title="① 连接 AIDA64"><Hint>检测中…</Hint></Step>
  ) : !status.running || !status.ini ? (
    <Step kind="bad" title="① 连接 AIDA64">
      <Hint>
        {status.running ? "AIDA64 在跑，但共享内存读不到" : "AIDA64 没在运行"}
        <br />
        {status.install || "没找到安装目录（绿色版请先启动一次 AIDA64）"}
      </Hint>
    </Step>
  ) : (
    <Step kind="done" title="① AIDA64 已连接">
      <Hint>
        导出 {status.exported_ids.length} 个传感器 · 共享内存 {status.shm_bytes}/{status.shm_limit} 字节 = {status.shm_pct}%
      </Hint>
    </Step>
  );

  return (
    <Page title="开始使用">
      <Section title="准备 AIDA64">{step1}</Section>
      <Section title="对齐导出清单">{step2()}</Section>
      <Section title="放进 OBS" divider={false}>
        <Step kind="done" title="③ 在 OBS 里添加“浏览器”源">
          <Hint>
            URL {location.origin}/　宽 {shared.check?.canvas_w ?? "—"}　高 {shared.check?.canvas_h ?? "—"}
            <br />
            改过版式后要在浏览器源属性里点“刷新缓存”，否则 OBS 还是旧页面。
          </Hint>
        </Step>
      </Section>
      {msg && (
        <div className={`text-sm ${
          msg.kind === "ok" ? "text-primary"
            : msg.kind === "bad" ? "text-danger" : "text-warning"
        }`}>{msg.text}</div>
      )}
    </Page>
  );
}
