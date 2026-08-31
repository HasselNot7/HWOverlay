/** 与 FastAPI 端点一一对应的类型定义。字段以 hwobs 各模块的返回为准。 */

export type Widget = CardsWidget | ChipsWidget | TextWidget | StatWidget | ProgressWidget | HtmlWidget | GaugeWidget;

export interface MetricRef {
  metric: string;
  label?: string;
  unit?: string;
  /** 大数字槽位专用：这个值带不带单位（不写则沿用组级 unit_policy） */
  unit_on?: boolean;
  digits?: number;
  divide?: number;
  digits2?: number;
  pair?: string[];
  diff?: string[];
}

export interface GroupDef {
  metrics: (string | MetricRef)[];
  sep?: string;
  unit_policy?: "last" | "all";
  unit?: string;
  digits?: number;
  divide?: number;
}

export interface CardItem {
  key: string;
  label: string;
  bar?: string;
  bar_full?: number;
  value?: GroupDef;
  sub?: GroupDef;
  spark?: string;
}

export interface CardsWidget {
  type: "cards";
  cols?: number;
  gap?: number;
  item_height?: number;
  items: CardItem[];
}

export interface ChipsWidget {
  type: "chips";
  font?: number;
  margin_top?: number;
  fit?: "none" | "shrink";
  items: string[];
}

export interface TextWidget {
  type: "text";
  text: string;
  size?: number;
  margin_top?: number;
}

/** 自由画布部件的定位字段：mode=free 时生效 */
export interface FreePos {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface StatWidget extends FreePos {
  type: "stat";
  metric: string;
  label?: string;
  size?: number;
}

export interface ProgressWidget extends FreePos {
  type: "progress";
  metric: string;
  w?: number;
  height?: number;
}

export interface HtmlWidget extends FreePos {
  type: "html";
  html: string;
}

export interface GaugeWidget extends FreePos {
  type: "gauge";
  metric: string;
  label?: string | true;
  size?: number;
  ring?: number;
}


export interface Canvas {
  w: number;
  h: number;
  theme?: string;
  padding?: [number, number];
  /** flow=自上而下堆叠（默认）；free=部件按 x/y 绝对定位 */
  mode?: "flow" | "free";
  /** true=叠加层背景透明，OBS 里直接叠在画面上 */
  transparent?: boolean;
}

export interface OverlayConfig {
  version: number;
  name?: string;
  canvas: Canvas;
  prompt?: {
    user?: string; cmd?: string; cursor?: boolean; size?: number;
    /** 自由画布专用：可拖到任意位置，不写回退画布内边距 */
    x?: number;
    y?: number;
  };
  widgets: Widget[];
}

/** 模板库里的一条：一个不同尺寸的常用版式。 */
export interface LayoutPreset {
  id: string;
  name: string;
  desc: string;
  config: OverlayConfig;
}

export interface Metric {
  id: string;
  out: string | null;
  name: string;
  kind?: string;
  unit?: string | null;
  digits?: number;
  divide?: number;
  custom?: boolean;
  /** 从内置指标集（metrics.json）一键注册进来的 */
  preset?: boolean;
  rate_untrusted?: boolean;
  na_zero?: boolean;
  sources?: { aida64?: string[]; winapi?: string };
  agg?: string;
  regex?: string;
}

export interface LayoutCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  est_height: number;
  canvas_w: number | null;
  canvas_h: number | null;
  widgets: number;
  referenced: string[];
  needed_ids: string[];
  budget?: {
    count: number;
    usable: number;
    worst_bytes: number;
    typical_bytes: number;
    fits: boolean;
    truncated_at: number | null;
  };
}

export interface AidaStatus {
  running: boolean;
  install: string | null;
  ini: string | null;
  exported_ids: string[];
  shm_bytes: number;
  shm_limit: number;
  shm_pct: number;
  shm_readable: boolean;
  usable_bytes: number;
  /** 读取过程出错时的原因（接口永远 200，错误写在这里） */
  error?: string | null;
  windows_net_sampler?: {
    sampling: boolean;
    error: string | null;
    up_mbps: number | null;
    down_mbps: number | null;
  };
}

export interface BudgetBrief {
  count: number;
  usable: number;
  worst_bytes: number;
  typical_bytes: number;
  fits: boolean;
  truncated_at?: number | null;
}

export interface AidaPlan {
  current_count: number;
  needed_count: number;
  /** 版式需要、但 AIDA64 还没导出的传感器（用户自己去补，本软件不写 ini） */
  missing: string[];
  missing_reasons: Record<string, string[]>;
  /** 清单里本软件用不到的传感器——仅列出告知，绝不动它们 */
  unused: string[];
  /** 补全清单：现有 ∪ 缺口，供用户复制粘贴进 ini 的整行值 */
  merged_key: string;
  merged_items: string;
  budget_now: BudgetBrief;
  budget_merged: BudgetBrief;
  fits: boolean;
  unchanged: boolean;
}

export interface UnknownSensor {
  id: string;
  label: string;
  value: string;
}

export interface HW {
  ok: boolean;
  degraded?: string | null;
  exported: number;
  missing: string[];
  sources: Record<string, string | null>;
  [key: string]: unknown;
}
