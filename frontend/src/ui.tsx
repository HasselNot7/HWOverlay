import { Button, Separator, Switch } from "@heroui/react";

/** v3 的 Button 不再转发原生 title（RAC filterDOMProps 白名单没有它）——编辑器里
 * 那三十来处中文悬停提示全靠它。包一层：有 title 就套个 inline-flex 的 span 承接，
 * 没有就原样透出，调用点无感。 */
export function Btn({ title, ...props }: React.ComponentProps<typeof Button> & { title?: string }) {
  const btn = <Button {...props} />;
  return title
    ? <span title={title} className="inline-flex">{btn}</span>
    : btn;
}

/** v3 Switch 的根只是 SwitchField（状态容器），隐藏 input 由 Switch.Content 渲染 ——
 * 裸 Control/Thumb 组合不可交互。无可见标签的开关统一走这个封装。 */
export function TSwitch({ title, ...props }:
  React.ComponentProps<typeof Switch> & { title?: string }) {
  const sw = (
    <Switch {...props}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
  return title ? <span title={title} className="inline-flex">{sw}</span> : sw;
}

/** Now Playing 版式的公共零件：页面标题、分区标题、字段小标签、灰色说明。
 * 尺寸照抄它的设置页：页题 30px 粗白、区题 20px、小节题 16px、字段标签 12px 淡蓝加粗。
 * v3 删掉了 default-500/800 数字色阶：前景用 text-foreground、弱化说明用 text-muted。 */

export const Page = ({ title, children }: {
  title: string;
  children: React.ReactNode;
}) => (
  <>
    <h1 className="text-3xl font-bold leading-9 text-white">{title}</h1>
    {children}
  </>
);

/** 区块标题（音乐服务 / 系统设置 那一级），right 放在标题行末尾（如状态 Chip）。 */
export const Section = ({ title, right, children, divider = true }: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  divider?: boolean;
}) => (
  <>
    <div className="flex flex-col">
      <div className="flex flex-row items-end justify-between gap-2">
        <h2 className="text-xl font-bold leading-9 text-foreground">{title}</h2>
        {right}
      </div>
      {children}
    </div>
    {divider && <Separator />}
  </>
);

/** 小节标题（音频设备 / 启动选项 那一级）。 */
export const SubTitle = ({ children, right }: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) => (
  <div className="flex items-center gap-1.5">
    <h3 className="flex items-center gap-1.5 text-base font-bold leading-6 text-foreground">{children}</h3>
    {right}
  </div>
);

/** 字段小标签：NP 源码是 text-primary-900 text-xs font-bold —— dark 主题下 900 号
 * 是最浅一档（近白带一丝蓝），不是实蓝。这里用 foreground 对齐。 */
export const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="cursor-default text-xs font-bold text-foreground">{children}</span>
);

/** 灰色说明文字。 */
export const Hint = ({ children, className = "" }: {
  children: React.ReactNode;
  className?: string;
}) => <p className={`text-sm leading-6 text-color-desc ${className}`}>{children}</p>;

/** 设置行：Now Playing 全站通用的高 64px 行 —— 左边标题 + 灰描述，右边控件。
 * NP 把这套 class 配方复制了 40+ 次没抽组件，我们抽出来。divider 控制行底分隔线。 */
export const SettingsRow = ({ title, desc, right, divider = true }: {
  title: React.ReactNode;
  desc?: React.ReactNode;
  right: React.ReactNode;
  divider?: boolean;
}) => (
  <div className={`flex min-h-16 items-center justify-between gap-6 ${
    divider ? "border-b border-white/[0.04]" : ""}`}>
    <div className="flex min-w-0 flex-col gap-[2px]">
      <span className="text-sm font-medium text-foreground">{title}</span>
      {desc && <span className="text-xs text-color-desc">{desc}</span>}
    </div>
    <div className="flex shrink-0 items-center gap-2">{right}</div>
  </div>
);

/** Now Playing 卡片底：近黑底 + 极淡描边 + rounded-xl，悬停微亮。 */
export const CARD_CLS = "rounded-xl border border-white/[0.04] bg-[#1a1a1d]";
