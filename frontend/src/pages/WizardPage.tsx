import { Button, Chip } from "@heroui/react";
import { Cable, LayoutTemplate, MonitorPlay, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Shared } from "../App";
import { CARD_CLS, Hint, Page } from "../ui";

type StepKind = "done" | "todo" | "bad" | "act";

const KIND_CHIP: Record<StepKind, { color: "success" | "warning" | "danger" | "default"; text: string }> = {
  done: { color: "success", text: "已完成" },
  todo: { color: "warning", text: "待办" },
  bad: { color: "danger", text: "有问题" },
  act: { color: "default", text: "照着做" },     // 没法替用户验证的步骤，如实标注
};

/** 步骤卡片：Now Playing 集成页的卡片语言 —— 近黑底淡描边圆角，左侧彩色步骤图标块，
 * 标题 + 状态点 Chip 一行，正文灰色说明在下面。 */
function StepCard({ kind, num, title, Icon, children, actions }: {
  kind: StepKind;
  num: number;
  title: string;
  Icon: LucideIcon;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const tone = {
    done: "bg-primary/15 text-primary",
    todo: "bg-warning/15 text-warning",
    bad: "bg-danger/15 text-danger",
    act: "bg-default-100 text-default-500",
  }[kind];
  return (
    <div className={`${CARD_CLS} flex gap-4 p-4`}>
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon size={22} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold leading-6 text-default-800">
            <span className="mr-1.5 font-poppins">{num}</span>{title}
          </h3>
          <Chip size="sm" variant="dot" color={KIND_CHIP[kind].color}>{KIND_CHIP[kind].text}</Chip>
        </div>
        {children && <div className="mt-2 flex flex-col gap-2">{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export default function WizardPage({ shared }: { shared: Shared }) {
  const { status, metrics, check } = shared;
  const metricCount = metrics?.length ?? 0;
  const widgetCount = check?.widgets ?? 0;

  const step1 = !status ? (
    <StepCard kind="todo" num={1} title="连接 AIDA64" Icon={Cable}>
      <Hint>状态接口还没读到 —— 服务可能刚启动，点侧栏「刷新数据」重试。</Hint>
    </StepCard>
  ) : status.error ? (
    <StepCard kind="bad" num={1} title="连接 AIDA64" Icon={Cable}>
      <Hint>读取状态时出错：{status.error}</Hint>
    </StepCard>
  ) : !status.running || !status.ini ? (
    <StepCard kind="bad" num={1} title="连接 AIDA64" Icon={Cable}>
      <Hint>
        {status.running ? "AIDA64 在跑，但共享内存读不到" : "AIDA64 没在运行"}
        {status.running && !status.shm_readable ? " —— 请确认 AIDA64 里开了共享内存（文件 → 设置 → 硬件监视工具 → 外部程序）" : ""}
        <br />
        {status.install || "没找到安装目录（绿色版请先启动一次 AIDA64）"}
      </Hint>
    </StepCard>
  ) : (
    <StepCard kind="done" num={1} title="AIDA64 已连接" Icon={Cable}>
      <Hint>
        导出 {status.exported_ids.length} 个传感器 · 共享内存 {status.shm_bytes}/{status.shm_limit} 字节 = {status.shm_pct}%
      </Hint>
    </StepCard>
  );

  const registered = metricCount > 0;
  const laid = widgetCount > 0;
  const step2kind = registered && laid ? "done" as const : "todo" as const;
  const step2 = (
    <StepCard kind={step2kind} num={2} title="注册传感器、挑版式" Icon={LayoutTemplate}
      actions={
        <>
          <Button size="sm" variant="flat" className="bg-[#27272a]"
            endContent={<ArrowRight size={14} />} onPress={() => shared.goto("custom")}>
            去注册指标（已 {metricCount} 个）
          </Button>
          <Button size="sm" variant="flat" className="bg-[#27272a]"
            endContent={<ArrowRight size={14} />} onPress={() => shared.goto("editor")}>
            去排版（{laid ? `已 ${widgetCount} 个部件` : "空白画布，可从模板一键加载"}）
          </Button>
        </>
      }>
      <Hint>
        请先在「自定义指标」注册，或一键加载默认指标集。
      </Hint>
    </StepCard>
  );

  // OBS 有没有加源没法替用户验证 —— 如实给"照着做"；但版式还是空的时候先拦一下
  const step3kind = laid ? "act" as const : "todo" as const;
  const step3 = (
    <StepCard kind={step3kind} num={3} title="在 OBS 里添加“浏览器”源" Icon={MonitorPlay}>
      <Hint>
        URL <code className="rounded-md bg-default-100 px-1.5 py-0.5 font-poppins text-xs">{location.origin}/</code>
        　宽 {check?.canvas_w ?? "—"} × 高 {check?.canvas_h ?? "—"}
        {!laid && " —— 版式还是空的，先去排版"}
        <br />
        修改样式后请刷新
      </Hint>
    </StepCard>
  );

  return (
    <Page title="开始使用">
      <div className="flex flex-col gap-3">
        {step1}
        {step2}
        {step3}
      </div>
    </Page>
  );
}
