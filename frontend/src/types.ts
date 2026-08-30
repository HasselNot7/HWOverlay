/** 与 FastAPI 端点一一对应的类型定义。字段以 hwobs 各模块的返回为准。 */

export type Widget = CardsWidget | ChipsWidget | TextWidget;

export interface MetricRef {
  metric: string;
  label?: string;
  unit?: string;
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

export interface Canvas {
  w: number;
  h: number;
  theme?: string;
  padding?: [number, number];
}

export interface OverlayConfig {
  version: number;
  name?: string;
  canvas: Canvas;
  prompt?: { user?: string; cmd?: string; cursor?: boolean; size?: number };
  widgets: Widget[];
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
  to_add: string[];
  to_remove: string[];
  add_reasons: Record<string, string[]>;
  budget_now: BudgetBrief;
  budget_new: BudgetBrief;
  fits: boolean;
  restart_required: boolean;
  unchanged: boolean;
}

export interface ApplyResult {
  applied: boolean;
  reason?: string;
  rolled_back?: boolean;
  verified?: boolean;
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
