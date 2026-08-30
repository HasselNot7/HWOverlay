import { Divider } from "@heroui/react";

/** Now Playing 版式的公共零件：页面标题、分区标题、字段小标签、灰色说明。
 * 尺寸照抄它的设置页：页题 30px 粗白、区题 20px、小节题 16px、字段标签 12px 淡蓝加粗。 */

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
        <h2 className="text-xl font-bold leading-9 text-default-800">{title}</h2>
        {right}
      </div>
      {children}
    </div>
    {divider && <Divider />}
  </>
);

/** 小节标题（音频设备 / 启动选项 那一级）。 */
export const SubTitle = ({ children, right }: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) => (
  <div className="flex items-center gap-1.5">
    <h3 className="flex items-center gap-1.5 text-base font-bold leading-6 text-default-800">{children}</h3>
    {right}
  </div>
);

/** 字段小标签：淡蓝色 12px 加粗，Now Playing 的表单标签通用样式。 */
export const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="cursor-default text-xs font-bold text-primary-900">{children}</span>
);

/** 灰色说明文字。 */
export const Hint = ({ children, className = "" }: {
  children: React.ReactNode;
  className?: string;
}) => <p className={`text-sm text-color-desc ${className}`}>{children}</p>;

/** Now Playing 卡片底：近黑底 + 极淡描边 + rounded-xl，悬停微亮。 */
export const CARD_CLS = "rounded-xl border border-white/[0.04] bg-[#1a1a1d]";
