import { Chip } from "@heroui/react";
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

export default function WizardPage({ shared }: { shared: Shared }) {
  const { status } = shared;

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
      <Section title="连接 AIDA64">{step1}</Section>
      <Section title="挑选指标与排版" divider={false}>
        <Step kind="todo" title="② 去注册传感器、挑版式">
          <Hint>
            各家机器的 AIDA64 传感器名不一样，所以这里不预置任何指标：
            去「自定义指标」页把传感器注册成指标（新机器可以一键加载默认指标集），
            再去「版式编辑」排版 —— 默认是空白画布，有"加载默认样式"按钮一键上手。
          </Hint>
        </Step>
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
