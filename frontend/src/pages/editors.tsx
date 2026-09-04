import { Accordion, Checkbox, cn, Input, Label, ListBox, Modal, Select, TextArea, TextField, toast } from "@heroui/react";
/** 版式编辑器的子组件：指标选择器、槽位编辑、卡片/chips/text 部件编辑器、模板库弹窗。
 * 控件一律用 HeroUI，样式学 Now Playing（淡蓝字段标签、flat 控件、卡片底）。
 * 草稿对象直接原地改，改完调 onChange() 触发上层重渲染 + 防抖校验。 */

import { useEffect, useRef, useState } from "react";
import type {
  CardItem, CardsWidget, ChipsWidget, GaugeWidget, GroupDef, HtmlWidget, LayoutPreset, Metric,
  MetricRef, OverlayConfig, ProgressWidget, StatWidget, TextWidget, Widget,
} from "../types";
type TFProps = React.ComponentProps<typeof TextField>;
import { AnimatedRow } from "../motion";
import { api } from "../api";
import { Btn, CARD_CLS, FieldLabel, Hint, TSwitch } from "../ui";

/** v3 的输入框拆成 TextField（状态）+ Input（外观）两层。这里薄封装回单节点写法：
 * 状态 props（value/defaultValue/onChange/type/placeholder/aria-label/onBlur）挂外壳，
 * variant 统一 secondary（我们全是嵌在卡片/面板里的矮富度输入）。
 * Input 加 px-4 py-3：v3 没有 size=lg，NP 的大输入框（size lg + px-4）用内边距抄出来。
 * 字体一律 Poppins + tabular-nums（NP 数字也不写等宽体，改值时不跳位靠 tnum）。 */
export const TF = ({ className = "", placeholder, title, ...props }: TFProps & { placeholder?: string; title?: string }) => {
  const f = (
    <TextField className={cn(className, "font-poppins tabular-nums")} variant="secondary" {...props}>
      <Input className="px-4 py-3" placeholder={placeholder} />
    </TextField>
  );
  return title ? <span title={title} className="inline-flex">{f}</span> : f;
};

/** 多行版（自定义 HTML 编辑器用）。rows 是原生 textarea 属性，走 TextArea。 */
export const TFArea = ({ className = "", rows, placeholder, ...props }: TFProps & { rows?: number; placeholder?: string }) => (
  <TextField className={cn("font-poppins", className)} variant="secondary" {...props}>
    <TextArea className="px-4 py-3" rows={rows} placeholder={placeholder} />
  </TextField>
);

const GROUP_TITLES: Record<string, string> = {
  cpu: "CPU", gpu: "显卡", ram: "内存", net: "网络", misc: "主板 / 其他", custom: "自定义",
};

export const outPaths = (metrics: Metric[]): string[] => metrics.filter(m => m.out).map(m => m.out!);

export const metricOpt = (metrics: Metric[], p: string): string => {
  const name = metrics.find(m => m.out === p)?.name || p;
  return `${name} · ${p}`;
};

const NONE = "__none__";

export function MetricSelect({ metrics, value, allowEmpty = true, compact, onChange }: {
  metrics: Metric[];
  value?: string;
  allowEmpty?: boolean;
  /** 紧凑模式（浮动面板里）：不锁 240px 定宽，随所在行伸缩 */
  compact?: boolean;
  onChange: (v: string) => void;
}) {
  const selected = value ?? (allowEmpty ? NONE : null);
  const options = [
    ...(value ? [{ id: value, label: metricOpt(metrics, value) }] : []),
    ...(allowEmpty ? [{ id: NONE, label: "（不用）" }] : []),
    ...metrics.filter(m => m.out && m.out !== value).map(m => ({ id: m.out!, label: metricOpt(metrics, m.out!) })),
  ];
  return (
    <Select
      aria-label="选择指标"
      placeholder="选择指标"
      className={cn(compact ? "w-full" : "w-[240px] flex-none", "font-jetbrains")}
      value={selected ?? null}
      onChange={k => onChange(!k || k === NONE ? "" : String(k))}
    >
      <Select.Trigger className="min-h-12 w-full min-w-0 px-4">
        <Select.Value className="min-w-0 truncate" />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(o => (
            <ListBox.Item key={o.id} id={o.id} textValue={o.label} className="min-h-11 px-4 text-base">
              {o.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

const MiniBtn = ({ onClick, title, children }: {
  onClick: () => void; title?: string; children: React.ReactNode;
}) => (
  <Btn size="sm" className="h-8 rounded-lg bg-[#1a1a1d] px-3 font-poppins text-sm text-foreground hover:bg-[#222226]"
    title={title} onPress={onClick}>
    {children}
  </Btn>
);

/** 槽位（value/sub）的条目行：字符串引用就地改；复合对象只读 + 可删。
 * value 槽位每行带"带单位"开关：写进条目的 unit_on，没动过的行沿用组级策略。 */
function SlotRow({ arr, i, total, unitAll, allowLabel, metrics, onChange, rebuild, compact }: {
  arr: (string | GroupDef["metrics"][number])[];
  i: number;
  total: number;
  unitAll: boolean;
  allowLabel: boolean;
  metrics: Metric[];
  onChange: () => void;
  rebuild: () => void;
  compact?: boolean;
}) {
  const item = arr[i];
  const del = (
    <Btn isIconOnly variant="ghost" className={compact
      ? "h-8 w-8 min-w-0 shrink-0 rounded-lg text-muted hover:bg-danger/15 hover:text-danger"
      : "h-7 w-7 min-w-0 rounded-full text-muted"}
      title="移除这一项" onPress={() => { arr.splice(i, 1); rebuild(); onChange(); }}>
      ✕
    </Btn>
  );

  // 带单位与否：条目写了 unit_on 听条目的，没写按组级策略推（last 策略只给最后一行）
  const unitOn = typeof item === "object" && item !== null && "unit_on" in item
    ? !!(item as { unit_on?: boolean }).unit_on
    : unitAll || i === total - 1;
  const setUnit = (next: boolean) => {
    if (typeof item === "object" && item !== null) {
      (item as { unit_on?: boolean }).unit_on = next;
    } else {
      arr[i] = { metric: arr[i] as string, unit_on: next };
    }
    rebuild();
    onChange();
  };

  const metricSel = (
    <MetricSelect metrics={metrics}
      value={typeof item === "string" ? item : (item && "metric" in item ? item.metric : undefined)}
      allowEmpty={false} compact={compact}
      onChange={v => {
        if (!v) return;
        if (typeof item === "object" && item !== null) item.metric = v;
        else arr[i] = v;
        onChange();
      }} />
  );

  const unitSwitch = (
    <TSwitch className="shrink-0" aria-label="这个值带单位" title="显示单位"
      isSelected={unitOn} onChange={setUnit} />
  );

  const rowCls = compact ? "flex items-center gap-2" : "my-1 flex items-center gap-1.5";
  // 小字槽位（带前缀输入框）在 320px 面板里横排塞不下，改竖排：下拉一行、前缀+✕ 一行
  const verticalSub = compact && allowLabel;

  if (typeof item === "string") {
    const prefix = (
      <TF
        aria-label="前缀文字" placeholder="前缀（可空）"
        className="min-w-0 flex-1 font-poppins" title="直播时显示在这个值前面"
        onBlur={e => {
          if (e.target.value) { arr[i] = { metric: arr[i] as string, label: e.target.value }; rebuild(); onChange(); }
        }}
      />
    );
    if (verticalSub) {
      return (
        <div className="flex flex-col gap-1.5">
          {metricSel}
          <div className="flex items-center gap-2">{prefix}{del}</div>
        </div>
      );
    }
    return (
      <div className={rowCls}>
        <div className="min-w-0 flex-1">{metricSel}</div>
        {!allowLabel && unitSwitch}
        {allowLabel && prefix}
        {del}
      </div>
    );
  }
  if (item && "metric" in item && item.metric) {
    const prefix = (
      <TF
        aria-label="前缀文字" placeholder="前缀（可空）"
        className="min-w-0 flex-1 font-poppins" title="直播时显示在这个值前面"
        defaultValue={item.label ?? ""}
        onChange={v => { item.label = v || undefined; onChange(); }}
      />
    );
    if (verticalSub) {
      return (
        <div className="flex flex-col gap-1.5">
          {metricSel}
          <div className="flex items-center gap-2">{prefix}{del}</div>
        </div>
      );
    }
    return (
      <div className={rowCls}>
        <div className="min-w-0 flex-1">{metricSel}</div>
        {!allowLabel && unitSwitch}
        {allowLabel && prefix}
        {del}
      </div>
    );
  }
  if (item && "pair" in item) {
    const vals = item.pair!;
    const numField = (text: string, key: "divide" | "digits" | "digits2", val?: number) => (
      <label className="flex items-center gap-1.5 text-xs text-muted">
        {text}
        <TF type="number" aria-label={`${text}`}
          className="w-20 font-poppins" value={String(val ?? "")}
          onChange={v => {
            (item as unknown as Record<string, number | undefined>)[key] = v === "" ? undefined : +v;
            onChange();
          }} />
      </label>
    );
    const sel = (which: 0 | 1) => (
      <div className="min-w-0 flex-1">
        <MetricSelect metrics={metrics} value={vals[which]} allowEmpty={false} compact={compact}
          onChange={v => { if (!v) return; vals[which] = v; onChange(); }} />
      </div>
    );
    return (
      <div className={compact
        ? "flex flex-col gap-2.5 rounded-xl bg-[#1a1a1d] p-3"
        : "my-1 flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] p-2"}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex-none font-poppins text-xs text-muted" title="两个指标相除">比值</span>
          {sel(0)}
          <span className="flex-none text-muted">/</span>
          {sel(1)}
          {del}
        </div>
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${compact ? "" : "ml-auto"}`}>
          {numField("除以", "divide", item.divide)}
          <label className="flex items-center gap-1.5 text-xs text-muted">
            单位
            <TF aria-label="单位" className="w-20 font-poppins"
              value={item.unit ?? ""}
              onChange={v => { item.unit = v || undefined; onChange(); }} />
          </label>
          {numField("小数", "digits", item.digits)}
          {numField("分母小数", "digits2", item.digits2)}
          {allowLabel && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              前缀
              <TF aria-label="前缀" className="w-24 font-poppins"
                defaultValue={item.label ?? ""}
                onBlur={e => { item.label = e.target.value || undefined; onChange(); }} />
            </label>
          )}
          {!allowLabel && unitSwitch}
        </div>
      </div>
    );
  }
  if (item && ("diff" in item)) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-[#1a1a1d] px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-poppins text-sm text-muted">
          差值: {(item.diff || []).join(" − ")}
        </span>
        {del}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-xl bg-[#1a1a1d] px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-jetbrains text-xs text-muted">{JSON.stringify(item)}</span>
      {del}
    </div>
  );
}

/** 大数字（allowLabel=false）与小字（allowLabel=true）槽位。
 * compact：窄面板模式——标签放上方、内容纵向排，不再和 110px 标签列挤一行。 */
export function SlotEditor({ card, defKey, title, allowLabel, metrics, onChange, compact }: {
  card: CardItem;
  defKey: "value" | "sub";
  title: string;
  allowLabel: boolean;
  metrics: Metric[];
  onChange: () => void;
  compact?: boolean;
}) {
  const def: GroupDef | undefined = card[defKey];
  const list = (def?.metrics ?? []) as (string | GroupDef["metrics"][number])[];
  const unitAll = def?.unit_policy === "all";
  const rows = list.map((_, i) => (
    <SlotRow key={i} arr={list} i={i} total={list.length} unitAll={unitAll}
      allowLabel={allowLabel} metrics={metrics} onChange={onChange} compact={compact}
      rebuild={() => onChange()} />
  ));

  const addItem = () => {
    const first = outPaths(metrics)[0];
    if (def) def.metrics.push(first);
    else (card[defKey] as GroupDef) = { metrics: [first] };
    onChange();
  };

  /** 比值（a/b）：比如 显存 已用 ÷1024 / 总量 ÷1024 → 3.2/10GB */
  const addPair = () => {
    const ps = outPaths(metrics);
    const item = { pair: [ps[0], ps[1] ?? ps[0]], digits: 1, digits2: 0 } as MetricRef;
    if (def) def.metrics.push(item);
    else (card[defKey] as GroupDef) = { metrics: [item] };
    onChange();
  };

  return (
    <div className={compact ? "flex flex-col gap-2" : "my-2.5 flex items-start gap-3"}>
      <span className={compact ? "" : "w-[110px] flex-none pt-2"}><FieldLabel>{title}</FieldLabel></span>
      <div className="flex min-w-0 flex-col gap-2">
        {rows}
        <div className="flex gap-2 pt-0.5">
          <MiniBtn title={allowLabel ? "这一行再加一个值" : "这一格再加一个值"} onClick={addItem}>+ 加指标</MiniBtn>
          <MiniBtn title="两个指标相除，比如 显存 已用/总量" onClick={addPair}>+ 加比值</MiniBtn>
        </div>
      </div>
    </div>
  );
}

/** 大数字格的组级设置：只剩分隔符 —— 单位改成每行自己的开关了。 */
export function ValueGroupEditor({ card, onChange, compact }: { card: CardItem; onChange: () => void; compact?: boolean }) {
  const ensure = (): GroupDef => {
    if (!card.value) card.value = { metrics: [] };
    return card.value;
  };
  return (
    <div className={compact ? "flex flex-col gap-1.5" : "my-2.5 flex items-start gap-3"}>
      <span className={compact ? "" : "w-[110px] flex-none pt-2"}><FieldLabel>分隔符</FieldLabel></span>
      <TF
        aria-label="分隔符"
        defaultValue={card.value?.sep ?? " · "} className={compact ? "w-full font-poppins" : "w-32 font-poppins"}
        onChange={v => { ensure().sep = v; onChange(); }}
      />
    </div>
  );
}

function CardEditor({ w, card, index, metrics, onChange, compact }: {
  w: CardsWidget;
  card: CardItem;
  index: number;
  metrics: Metric[];
  onChange: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`${CARD_CLS} rounded-2xl p-4`}>
      <div className="mb-4 flex items-center justify-between">
        <b className="text-[15px] font-bold text-foreground">卡 {index + 1}</b>
        <Btn variant="ghost" className="h-7 min-w-0 px-2 text-xs text-muted hover:text-danger"
          onPress={() => { w.items.splice(index, 1); onChange(); }}>
          删卡
        </Btn>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>标题（卡片左上）</FieldLabel>
          <TF
            aria-label="卡片标题"
            defaultValue={card.label ?? ""} className={compact ? "w-full font-poppins" : "max-w-md font-poppins"}
            onChange={v => { card.label = v; onChange(); }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <FieldLabel>进度条</FieldLabel>
            <MetricSelect metrics={metrics} value={card.bar} compact onChange={
              v => { if (v) card.bar = v; else delete card.bar; onChange(); }} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <FieldLabel>迷你曲线</FieldLabel>
            <MetricSelect metrics={metrics} value={card.spark} compact onChange={
              v => { if (v) card.spark = v; else delete card.spark; onChange(); }} />
          </div>
        </div>

        <SlotEditor card={card} defKey="value" title="大数字（右上）" allowLabel={false} metrics={metrics} onChange={onChange} compact={compact} />
        <ValueGroupEditor card={card} onChange={onChange} compact={compact} />
        <SlotEditor card={card} defKey="sub" title="小字（下方一行）" allowLabel metrics={metrics} onChange={onChange} compact={compact} />
      </div>
    </div>
  );
}

export function CardsEditor({ w, metrics, onChange, compact }: { w: CardsWidget; metrics: Metric[]; onChange: () => void; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {w.items.map((c, i) => (
        <CardEditor key={c.key ?? i} w={w} card={c} index={i} metrics={metrics} onChange={onChange} compact={compact} />
      ))}
      <MiniBtn onClick={() => {
        const first = outPaths(metrics)[0];
        const keys = new Set(w.items.map(c => c.key));
        let n = 1;
        while (keys.has(`card${n}`)) n += 1;
        w.items.push({ key: `card${n}`, label: "新卡片", bar: first,
          value: { metrics: [first] }, sub: { sep: " · ", metrics: [] } });
        onChange();
      }}>+ 加一张卡</MiniBtn>
    </div>
  );
}

export function ChipsEditor({ w, metrics, onChange }: { w: ChipsWidget; metrics: Metric[]; onChange: () => void }) {
  const inChips = new Set(w.items || []);
  const byPrefix = new Map<string, string[]>();
  for (const p of outPaths(metrics)) {
    const prefix = p.split(".")[0];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push(p);
  }
  return (
    <div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>字号</FieldLabel>
        <TF
          aria-label="字号" type="number"
          defaultValue={String(w.font ?? 15)} className="w-full font-poppins"
          onChange={v => { w.font = +v || 15; onChange(); }}
        />
      </div>
      <Accordion
        allowsMultipleExpanded variant="surface"
        className="mt-3" hideSeparator
        defaultExpandedKeys={[...byPrefix].filter(([, paths]) => paths.some(p => inChips.has(p))).map(([k]) => k)}
      >
        {[...byPrefix].map(([prefix, paths]) => {
          const checkedCount = paths.filter(p => inChips.has(p)).length;
          return (
            <Accordion.Item key={prefix} id={prefix}
              className="mb-2 rounded-xl border border-white/[0.04] bg-[#1a1a1d] px-4 last:mb-0">
              <Accordion.Heading>
                <Accordion.Trigger className="flex items-center gap-2 py-2 text-sm font-medium">
                  <span>{GROUP_TITLES[prefix] || prefix.toUpperCase()}
                    <span className="ml-2 text-xs text-muted">{checkedCount} 项</span></span>
                  <Accordion.Indicator className="ml-auto text-muted">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  </Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="pb-2">
                  <div className="flex flex-col gap-0.5">
                    {paths.map(p => {
                      const m = metrics.find(x => x.out === p);
                      return (
                        <Checkbox
                          key={p}
                          className="rounded-lg px-2 py-1.5 hover:bg-white/[0.04]"
                          isSelected={inChips.has(p)}
                          onChange={checked => {
                            w.items = (w.items || []).filter(x => x !== p);
                            if (checked) w.items.push(p);
                            onChange();
                          }}
                        >
                          <Checkbox.Content>
                            <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                            <span className="text-sm">{m?.name ?? p}
                              <span className="ml-1 font-jetbrains text-xs text-muted">{p}</span>
                            </span>
                          </Checkbox.Content>
                        </Checkbox>
                      );
                    })}
                  </div>
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
    </div>
  );
}

const QUICK = ["cpu.usage", "cpu.temp", "gpu.usage", "gpu.temp", "ram.used", "ram.total", "net.up_mbps", "net.down_mbps"];

export function TextEditor({ w, metrics, onChange, compact }: { w: TextWidget; metrics: Metric[]; onChange: () => void; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>正文</FieldLabel>
        {/* 受控：快捷插入按钮直接改 w.text，非受控框看不见这种外部改动，还会被下一次键入覆盖 */}
        <TF
          aria-label="正文" placeholder="想写的话 + {指标} 占位符"
          value={w.text ?? ""} className={compact ? "w-full font-poppins" : "max-w-xl font-poppins"}
          onChange={v => { w.text = v; onChange(); }}
        />
        <Hint className="text-xs">{"{指标路径}"} 插实时值；{"{time} {date}"} 为本地时钟/日期。</Hint>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>字号</FieldLabel>
        <TF
          aria-label="字号" type="number"
          defaultValue={String(w.size ?? 19)} className={compact ? "w-full font-poppins" : "w-24 font-poppins"}
          onChange={v => { w.size = +v || 19; onChange(); }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel>点击插入指标</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map(p => {
            const name = metrics.find(m => m.out === p)?.name || p;
            return (
              <Btn key={p} size="sm" className="h-8 rounded-lg bg-[#1a1a1d] px-3 font-poppins text-sm text-muted hover:bg-[#222226] hover:text-foreground"
                onPress={() => { w.text = `${w.text || ""}{${p}}`; onChange(); }}>
                {name}
              </Btn>
            );
          })}
          {["time", "date"].map(p => (
            <Btn key={p} size="sm" className="h-8 rounded-lg bg-[#1a1a1d] px-3 font-poppins text-sm text-accent hover:bg-[#222226]"
              title={p === "time" ? "本地时钟 HH:MM:SS，每秒跳动" : "本地日期 YYYY-MM-DD"}
              onPress={() => { w.text = `${w.text || ""}{${p}}`; onChange(); }}>
              {p === "time" ? "时钟" : "日期"}
            </Btn>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- 自由画布部件的参数面板 ---------------------------------------------------

export function StatEditor({ w, metrics, onChange, compact }: { w: StatWidget; metrics: Metric[]; onChange: () => void; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel>指标</FieldLabel>
        <MetricSelect metrics={metrics} value={w.metric} allowEmpty={false} compact
          onChange={v => { if (v) { w.metric = v; onChange(); } }} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel>名字（可空）</FieldLabel>
          <TF className="w-full font-poppins" placeholder="如 CPU"
            defaultValue={w.label ?? ""}
            onChange={v => { w.label = v || undefined; onChange(); }} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel>字号</FieldLabel>
          <TF type="number" className="w-full font-poppins"
            defaultValue={String(w.size ?? 26)}
            onChange={v => { w.size = +v || 26; onChange(); }} />
        </div>
      </div>
    </div>
  );
}

export function ProgressEditor({ w, metrics, onChange, compact }: { w: ProgressWidget; metrics: Metric[]; onChange: () => void; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel>指标</FieldLabel>
        <MetricSelect metrics={metrics} value={w.metric} allowEmpty={false} compact
          onChange={v => { if (v) { w.metric = v; onChange(); } }} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel>宽度</FieldLabel>
          <TF type="number" className="w-full font-poppins"
            defaultValue={String(w.w ?? 260)}
            onChange={v => { w.w = +v || 260; onChange(); }} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel>条高</FieldLabel>
          <TF type="number" className="w-full font-poppins"
            defaultValue={String(w.height ?? 10)}
            onChange={v => { w.height = +v || 10; onChange(); }} />
        </div>
      </div>
    </div>
  );
}

export function GaugeEditor({ w, metrics, onChange, compact }: { w: GaugeWidget; metrics: Metric[]; onChange: () => void; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel>指标</FieldLabel>
        <MetricSelect metrics={metrics} value={w.metric} allowEmpty={false} compact
          onChange={v => { if (v) { w.metric = v; onChange(); } }} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel>标签（圆环下小字，可空）</FieldLabel>
        <TF className="w-full font-poppins" placeholder="如 CPU"
          defaultValue={typeof w.label === "string" ? w.label : ""}
          onChange={v => { w.label = v || undefined; onChange(); }} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel>大小</FieldLabel>
          <TF type="number" className="w-full font-poppins"
            defaultValue={String(w.size ?? 120)}
            onChange={v => { w.size = +v || 120; onChange(); }} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel>环宽</FieldLabel>
          <TF type="number" className="w-full font-poppins"
            defaultValue={String(w.ring ?? 10)}
            onChange={v => { w.ring = +v || 10; onChange(); }} />
        </div>
      </div>
    </div>
  );
}

/** HtmlEditor 的示例片段：一键插入可跑的动态组件范本 */
const HTML_SNIPPETS: { name: string; title: string; html: string; w: number; h: number }[] = [
  {
    name: "动态圆环",
    title: "canvas 画的动态圆环，每秒跟着值转",
    w: 160, h: 160,
    html: `<canvas id="c" width="160" height="160"></canvas>
<script>
const cv = HWOB.root.querySelector('#c'), g = cv.getContext('2d');
const draw = () => {
  const v = HWOB.get('cpu.usage') ?? 0;
  g.clearRect(0, 0, 160, 160);
  g.lineWidth = 12; g.lineCap = 'round';
  g.strokeStyle = '#2e3440';
  g.beginPath(); g.arc(80, 80, 62, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#a3be8c';
  g.beginPath(); g.arc(80, 80, 62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v / 100); g.stroke();
  g.fillStyle = '#eceff4'; g.font = '700 26px monospace'; g.textAlign = 'center';
  g.fillText(HWOB.text('cpu.usage'), 80, 90);
};
HWOB.onTick(draw); draw();
</script>`,
  },
  {
    name: "60 秒曲线",
    title: "最近 60 秒的走势曲线",
    w: 360, h: 120,
    html: `<canvas id="c" width="360" height="120"></canvas>
<script>
const cv = HWOB.root.querySelector('#c'), g = cv.getContext('2d');
const N = 60;
const draw = () => {
  const h = HWOB.history('cpu.usage', N);
  g.clearRect(0, 0, 360, 120);
  g.strokeStyle = '#2e3440';
  for (let y = 0; y <= 120; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(360, y); g.stroke(); }
  g.strokeStyle = '#88c0d0'; g.lineWidth = 2; g.beginPath();
  for (let i = 0; i < h.length; i++) {
    if (h[i] == null) continue;
    const x = i * (360 / (N - 1)), y = 115 - Math.min(1, h[i] / 100) * 105;
    i === 0 || h[i - 1] == null ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
};
HWOB.onTick(draw);
</script>`,
  },
];

export function HtmlEditor({ w, onChange }: { w: HtmlWidget; onChange: () => void }) {
  // 示例片段要换掉整个编辑区：key 递增让 Textarea 重新挂载（defaultValue 只在挂载时吃）
  const [taKey, setTaKey] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <TFArea
        key={taKey}
        aria-label="自定义 HTML" className="text-xs" rows={5}
        defaultValue={w.html}
        onChange={v => { w.html = v; onChange(); }} />
      <div className="flex flex-wrap gap-2">
        {HTML_SNIPPETS.map(s => (
          <MiniBtn key={s.name} title={s.title} onClick={() => {
            w.html = s.html;
            w.w = s.w;
            w.h = s.h;
            setTaKey(k => k + 1);
            onChange();
          }}>示例：{s.name}</MiniBtn>
        ))}
      </div>
      <Hint className="text-xs">
        {"{cpu.usage}"} 这类占位符会替换成实时值（构建时替换一次）。写 &lt;script&gt; 就是动态组件：
        HWOB.get('路径') 取原始值 · HWOB.text('路径') 取带单位文本 · HWOB.history('路径', 60) 取采样序列 ·
        HWOB.onTick(fn) 每秒回调 · HWOB.root 是本部件的 DOM 根。也可以直接手写 canvas 画动态图。
      </Hint>
    </div>
  );
}

// --- 排版页共用块 ---------------------------------------------------------------

/** 画布尺寸输入：原地改 draft.canvas，调用方负责重渲染。
 * NP 行式布局：小标签在上、通栏圆角输入框在下；开关行标签左、控件右。 */
export function CanvasFields({ draft, onChange }: { draft: OverlayConfig; onChange: () => void }) {
  return (
    <div className="mt-2 flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <FieldLabel>叠加层宽</FieldLabel>
        <TF
          aria-label="叠加层宽" type="number"
          defaultValue={String(draft.canvas.w)} className="w-full"
          onChange={v => { draft.canvas.w = +v || draft.canvas.w; onChange(); }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel>叠加层高</FieldLabel>
        <TF
          aria-label="叠加层高" type="number"
          defaultValue={String(draft.canvas.h)} className="w-full"
          onChange={v => { draft.canvas.h = +v || draft.canvas.h; onChange(); }}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[15px] font-medium text-foreground">背景透明</span>
        <TSwitch size="lg" aria-label="背景透明"
          isSelected={!!draft.canvas.transparent}
          onChange={b => {
            if (b) draft.canvas.transparent = true;
            else delete draft.canvas.transparent;
            onChange();
          }} />
      </div>
    </div>
  );
}

/** 顶部装饰命令行：整行开关 + 内容/字号/光标。原地改 draft.prompt。
 * NP 行式：开关行标签左控件右，文本/数字通栏；编辑器右侧面板专用竖排。 */
export function PromptBar({ draft, onChange, compact }: {
  draft: OverlayConfig;
  onChange: () => void;
  compact?: boolean;
}) {
  const toggle = (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-[2px]">
        <span className="text-[15px] font-medium text-foreground">顶部命令行装饰</span>
        <span className="text-sm text-color-desc">画布顶部的 user@host &gt; 假命令行</span>
      </div>
      <TSwitch size="lg" aria-label="显示顶部命令行装饰"
        isSelected={!!draft.prompt}
        onChange={b => {
          if (b) {
            draft.prompt = { user: "streamer@pc", cmd: "./sysmon --source=aida64 --interval=1s", cursor: true, size: 19 };
          } else {
            delete draft.prompt;
          }
          onChange();
        }} />
    </div>
  );
  const fields = (
    <>
      <div className="flex flex-col gap-2">
        <FieldLabel>用户@主机</FieldLabel>
        <TF aria-label="命令行用户"
          className="w-full"
          value={draft.prompt?.user ?? ""}
          onChange={v => { draft.prompt!.user = v; onChange(); }} />
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel>命令行文本</FieldLabel>
        <TF aria-label="命令行文本"
          className="w-full"
          value={draft.prompt?.cmd ?? ""}
          onChange={v => { draft.prompt!.cmd = v; onChange(); }} />
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel>命令行字号</FieldLabel>
        <TF aria-label="命令行字号" type="number" className="w-full"
          value={String(draft.prompt?.size ?? 19)}
          onChange={v => { draft.prompt!.size = +v || 19; onChange(); }} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[15px] font-medium text-foreground">闪烁光标</span>
        <TSwitch size="lg" aria-label="闪烁光标"
          isSelected={draft.prompt?.cursor ?? true}
          onChange={b => { draft.prompt!.cursor = b; onChange(); }} />
      </div>
    </>
  );
  // 开/关命令行装饰时，字段整块 spring 滑入滑出（AnimatedRow 退出期保留旧内容，不闪不崩）
  return (
    <div className={`mt-2 flex flex-col ${compact ? "gap-4" : "gap-5"}`}>
      {toggle}
      <AnimatedRow show={!!draft.prompt}>
        <div className="flex flex-col gap-4">{fields}</div>
      </AnimatedRow>
    </div>
  );
}

/** 模板缩略图：按画布真实比例画各部件占位块，一眼看清尺寸与布局。 */
function PresetThumb({ cfg }: { cfg: OverlayConfig }) {
  const c = cfg.canvas;
  const line = (px: number) => Math.round(px * 1.2);
  const estH = (w: Widget): number => {
    switch (w.type) {
      case "cards": {
        const cols = Math.max(1, w.cols ?? 4);
        const rows = Math.ceil((w.items?.length ?? 0) / cols);
        return rows * (w.item_height ?? 66) + Math.max(0, rows - 1) * (w.gap ?? 32);
      }
      case "chips": return line(w.font ?? 15) + (w.margin_top ?? 10);
      case "text": return line(w.size ?? 19) + (w.margin_top ?? 0);
      case "stat": return line(w.size ?? 26);
      case "progress": return w.height ?? 10;
      case "html": return w.h ?? 60;
      case "gauge": return (w.size ?? 120) + (w.label ? 20 : 0);
      default: return 40;
    }
  };
  const pct = (n: number, dim: number) => `${(n / dim) * 100}%`;
  const free = c.mode === "free";
  const pad = c.padding ?? [12, 24];
  const promptH = cfg.prompt ? line(cfg.prompt.size ?? 19) + 10 : 0;
  // 流式：从顶部内边距 + 命令行装饰往下堆；自由：按 x/y 绝对定位
  let cursor = free ? 0 : pad[0] + promptH;
  return (
    <div className="relative w-full overflow-hidden border border-white/10 bg-[#0e0f12]"
      style={{ aspectRatio: `${c.w} / ${c.h}` }}>
      {!free && cfg.prompt && (
        <div className="absolute left-0 top-0 h-[6%] w-full bg-accent/25"
          style={{ marginTop: pct(pad[0], c.h) }} />
      )}
      {cfg.widgets.map((w, i) => {
        const h = estH(w);
        const pos = w as { x?: number; y?: number; w?: number };
        const style = free
          ? {
              left: pct(pos.x ?? 0, c.w), top: pct(pos.y ?? 0, c.h),
              width: pct(pos.w ?? (w.type === "gauge" ? (w as GaugeWidget).size ?? 120 : c.w - (pos.x ?? 0)), c.w),
              height: pct(h, c.h),
            }
          : { left: pct(pad[1], c.w), top: pct(cursor, c.h), width: pct(c.w - pad[1] * 2, c.w), height: pct(h, c.h) };
        if (!free) cursor += h + 8;
        return <div key={i} className="absolute bg-accent/45" style={style} />;
      })}
    </div>
  );
}

/** 把任意版式导出成模板文件（浏览器直接下载，不经过服务器）。 */
function downloadTemplate(entry: { name: string; desc: string; config: OverlayConfig }) {
  const safe = entry.name.replace(/[\\/:*?"<>|\s]+/g, "_") || "template";
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.hwobs-template.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 模板库弹窗：内置 + 自存模板，点一个装进草稿；支持存为模板 / 导入 / 导出 / 删除。 */
export function TemplatePicker({ isOpen, onOpenChange, onPick, current }: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (p: LayoutPreset) => void;
  /** 编辑器当前草稿：供「存为模板」「导出文件」用 */
  current: OverlayConfig | null;
}) {
  const [list, setList] = useState<LayoutPreset[] | null>(null);
  const [form, setForm] = useState(false);       // "存为模板" 的命名表单
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => api.layoutPresets().then(d => setList(d.presets)).catch(() => setList([]));
  useEffect(() => { if (isOpen) load(); }, [isOpen]);   // 每次打开都拿最新库

  const save = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const rep = await api.saveLayoutPreset({
        name: name.trim() || "我的版式", desc: desc.trim(), config: current,
      });
      if (!rep.saved) {
        toast.danger("存为模板失败", { description: (rep.errors || []).join("；"), timeout: 6000 });
        return;
      }
      toast.success(`已存入模板库：${rep.entry!.name}`, { timeout: 2000 });
      setForm(false); setName(""); setDesc("");
      load();
    } finally {
      setBusy(false);
    }
  };

  const exportCurrent = () => {
    if (!current) return;
    downloadTemplate({ name: name.trim() || current.name || "我的版式", desc: desc.trim(), config: current });
  };

  /** 导入模板文件：认 {name,desc,config} 封装，也认裸的版式 JSON（如 overlays/monitor.json）。 */
  const importFile = async (f: File) => {
    setBusy(true);
    try {
      const data = JSON.parse(await f.text());
      const cfg = data && typeof data === "object" && data.config ? data.config : data;
      const pname = String(data?.name || f.name.replace(/\.json$/i, "")).slice(0, 40);
      const rep = await api.saveLayoutPreset({ name: pname, desc: String(data?.desc || "导入的模板"), config: cfg });
      if (!rep.saved) {
        toast.danger("导入失败", { description: (rep.errors || []).join("；"), timeout: 6000 });
      } else {
        toast.success(`已导入模板：${pname}`, { timeout: 2000 });
        load();
      }
    } catch (e) {
      toast.danger("导入失败", { description: `文件不是合法 JSON：${e}`, timeout: 6000 });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (p: LayoutPreset) => {
    const rep = await api.removeLayoutPreset(p.id);
    if (rep.removed) {
      setList(l => (l || []).filter(x => x.id !== p.id));
      toast(`已删除模板：${p.name}`);
    } else {
      toast.danger("删除失败", { description: rep.error, timeout: 6000 });
    }
  };

  const card = (p: LayoutPreset) => (
    <div key={p.id} className="relative">
      <button type="button"
        className="flex w-full flex-col gap-2 border border-white/10 bg-[#1a1a1d] p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/70"
        onClick={() => { onPick(p); onOpenChange(false); }}>
        <PresetThumb cfg={p.config} />
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-foreground">{p.name}</span>
          {p.source === "user" && (
            <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent">我的</span>
          )}
          <span className="font-poppins text-[11px] text-muted">
            {p.config.canvas.w}×{p.config.canvas.h}
            {p.config.canvas.mode === "free" ? " · 自由" : " · 流式"}
          </span>
        </span>
        <span className="text-xs leading-5 text-muted">{p.desc}</span>
      </button>
      {p.source === "user" && (
        <button type="button" title="删除这个模板" onClick={() => remove(p)}
          className="absolute right-2 top-2 z-10 grid size-6 place-items-center rounded border border-white/10 bg-black/60 text-xs text-muted transition-colors hover:border-danger hover:bg-danger hover:text-white">
          ✕
        </button>
      )}
    </div>
  );

  const mine = (list || []).filter(p => p.source === "user");
  const builtin = (list || []).filter(p => p.source !== "user");
  const grid = "grid grid-cols-2 gap-3";
  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container size="lg">
          <Modal.Dialog className="sm:max-w-[860px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>模板库</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Btn size="sm" variant="secondary" className="bg-[#27272a]" isDisabled={busy}
                    onPress={() => fileRef.current?.click()}
                    title="从 .json 文件导入一套模板（导出文件 / 别人的分享 / 你保存的版式）">
                    导入文件
                  </Btn>
                  <Btn size="sm" variant="secondary" className="bg-[#27272a]" isDisabled={!current || busy}
                    onPress={() => setForm(v => !v)}
                    title="把编辑器里这份草稿存进模板库，以后随时一键载入">
                    存为模板
                  </Btn>
                  <Btn size="sm" variant="secondary" className="bg-[#27272a]" isDisabled={!current || busy}
                    onPress={exportCurrent}
                    title="把当前草稿下载成模板文件（备份 / 分享）">
                    导出当前版式
                  </Btn>
                  <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); }} />
                </div>
                {form && (
                  <div className="flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-[#1a1a1d] p-3">
                    <TextField className="w-52" value={name} onChange={setName}
                      onKeyDown={e => { if (e.key === "Enter" && !busy) save(); }}>
                      <Label>模板名</Label>
                      <Input placeholder="例如：我的直播底栏" />
                    </TextField>
                    <TextField className="min-w-52 flex-1" value={desc} onChange={setDesc}
                      onKeyDown={e => { if (e.key === "Enter" && !busy) save(); }}>
                      <Label>一句话简介（可选）</Label>
                      <Input />
                    </TextField>
                    <Btn size="sm" isDisabled={busy} onPress={save}>保存</Btn>
                  </div>
                )}
                <div className="flex max-h-[58vh] flex-col gap-3 overflow-y-auto pr-1">
                  {!list && <Hint>加载模板列表…</Hint>}
                  {list?.length === 0 && <Hint>模板库是空的</Hint>}
                  {!!mine.length && (
                    <>
                      <Hint>我的模板</Hint>
                      <div className={grid}>{mine.map(card)}</div>
                    </>
                  )}
                  {!!builtin.length && (
                    <>
                      {list?.length ? <Hint>内置模板</Hint> : null}
                      <div className={grid}>{builtin.map(card)}</div>
                    </>
                  )}
                </div>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
