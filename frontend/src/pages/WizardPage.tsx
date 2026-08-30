import { addToast, Button, Chip } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { api } from "../api";
import type { AidaPlan } from "../types";
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

const DiffChips = ({ ids }: { ids: string[] }) => (
  <div className="mt-1.5 flex flex-wrap gap-1.5">
    {ids.map(id => (
      <span key={id}
        className="rounded-lg border border-default-100 bg-default-100/50 px-1.5 py-0.5 font-poppins text-xs text-primary">
        {id}
      </span>
    ))}
  </div>
);

export default function WizardPage({ shared }: { shared: Shared }) {
  const [plan, setPlan] = useState<AidaPlan | null>(null);
  const { status } = shared;

  const loadPlan = useCallback(async () => {
    try { setPlan(await api.aidaPlan()); } catch { setPlan(null); }
  }, []);

  useEffect(() => { loadPlan(); }, [loadPlan, shared.check]);

  /** 复制补全后的 HWMonExtAppItems 整行。写不写 ini 是用户自己的动作，本软件不碰。 */
  const copyMerged = async () => {
    if (!plan) return;
    try {
      await navigator.clipboard.writeText(`${plan.merged_key}=${plan.merged_items}`);
      addToast({
        title: "已复制补全清单",
        description: "粘贴替换 aida64.ini 里的 HWMonExtAppItems= 行（改之前先关 AIDA64）",
        color: "success",
      });
    } catch (e) {
      addToast({ title: "复制失败", description: String(e), color: "danger" });
    }
  };

  const step2 = () => {
    if (!plan) return <Step kind="todo" title="② 读取导出清单…" />;
    if (plan.unchanged) {
      return (
        <Step kind="done" title="② AIDA64 导出清单已满足版式">
          {plan.unused.length > 0 && (
            <Hint>
              清单里另有 {plan.unused.length} 个本软件用不到的传感器（{plan.unused.join("、")}），
              照常保留——它们可能正被其他软件使用。
            </Hint>
          )}
        </Step>
      );
    }
    return (
      <Step kind="todo" title={`② AIDA64 还没导出 ${plan.missing.length} 个版式要用的传感器`}>
        <div className="flex flex-col gap-2 text-sm">
          <div>缺这些：<DiffChips ids={plan.missing} /></div>
          <Hint>
            对应的指标：{plan.missing.map(id => {
              const names = plan.missing_reasons[id] || [];
              return `${id}（${names.join("/") || "聚合来源"}）`;
            }).join("、")}。不补的话这些指标在叠加层上一直是 --。
          </Hint>
          <Hint>
            本软件不会替你改 AIDA64 的配置：HWMonExtAppItems 是 AIDA64 的清单，
            其他软件（OSD、看板…）可能也在读。补全有两种办法：
          </Hint>
          <ol className="ml-5 list-decimal flex flex-col gap-1 text-color-desc text-sm">
            <li>在 AIDA64 里把这些传感器加进共享内存导出清单（和你之前加 WiFi 传感器一样）；</li>
            <li>或复制下面的整行，关闭 AIDA64 → 打开 aida64.ini → 替换 HWMonExtAppItems= 那一行 → 保存 → 再启动 AIDA64。</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="md" variant="flat" startContent={<Copy size={15} />} onPress={copyMerged}>
              复制补全后的清单
            </Button>
            <code className="max-w-full truncate rounded-md bg-default-100 px-2 py-1 font-poppins text-xs text-default-500">
              {plan.merged_key}={plan.merged_items}
            </code>
          </div>
          <div className={`text-color-desc ${plan.fits ? "" : "text-warning"}`}>
            补全后预算：{plan.current_count} → {plan.budget_merged.count} 个传感器，
            最坏 {plan.budget_now.worst_bytes} → {plan.budget_merged.worst_bytes} / {plan.budget_merged.usable} 字节
            {plan.fits ? "" : " —— 超预算，先回编辑器去掉几个指标再补"}
          </div>
        </div>
      </Step>
    );
  };

  const step1 = !status ? (
    <Step kind="todo" title="① 连接 AIDA64">
      <Hint>状态接口还没读到 —— 服务可能刚启动，点侧栏「刷新数据」重试。</Hint>
    </Step>
  ) : status.error ? (
    <Step kind="bad" title="① 连接 AIDA64">
      <Hint>读取状态时出错：{status.error}</Hint>
    </Step>
  ) : !status.running || !status.ini ? (
    <Step kind="bad" title="① 连接 AIDA64">
      <Hint>
        {status.running ? "AIDA64 在跑，但共享内存读不到" : "AIDA64 没在运行"}
        {status.running && !status.shm_readable ? " —— 请确认 AIDA64 里开了共享内存（文件 → 设置 → 硬件监视工具 → 外部程序）" : ""}
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
    </Page>
  );
}
