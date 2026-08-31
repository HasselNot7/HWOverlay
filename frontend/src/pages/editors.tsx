import {
  Accordion, AccordionItem, Button, Checkbox, Input, Modal, ModalBody, ModalContent,
  ModalHeader, Select, SelectItem, Switch, Textarea,
} from "@heroui/react";
/** 版式编辑器的子组件：指标选择器、槽位编辑、卡片/chips/text 部件编辑器、模板库弹窗。
 * 控件一律用 HeroUI，样式学 Now Playing（淡蓝字段标签、flat 控件、卡片底）。
 * 草稿对象直接原地改，改完调 onChange() 触发上层重渲染 + 防抖校验。 */

import { useEffect, useState } from "react";
import type {
  CardItem, CardsWidget, ChipsWidget, GaugeWidget, GroupDef, HtmlWidget, LayoutPreset, Metric,
  MetricRef, OverlayConfig, ProgressWidget, StatWidget, TextWidget, Widget,
} from "../types";
import { api } from "../api";
import { CARD_CLS, FieldLabel, Hint } from "../ui";

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
  const selected = value ?? (allowEmpty ? NONE : "");
  const options = [
    ...(value ? [{ key: value, label: metricOpt(metrics, value) }] : []),
    ...(allowEmpty ? [{ key: NONE, label: "（不用）" }] : []),
    ...metrics.filter(m => m.out && m.out !== value).map(m => ({ key: m.out!, label: metricOpt(metrics, m.out!) })),
  ];
  return (
    <Select
      aria-label="选择指标"
      size="sm" variant="flat"
      className={compact ? "w-full font-poppins" : "w-[240px] flex-none font-poppins"}
      classNames={{ trigger: "cursor-pointer transition-background !duration-150" }}
      selectedKeys={selected ? [selected] : []}
      disallowEmptySelection={!allowEmpty}
      onSelectionChange={keys => {
        const k = [...keys][0] as string | undefined;
        onChange(!k || k === NONE ? "" : k);
      }}
    >
      {options.map(o => (
        <SelectItem key={o.key} classNames={{ title: "text-sm font-poppins" }}>{o.label}</SelectItem>
      ))}
    </Select>
  );
}

const MiniBtn = ({ onClick, title, children }: {
  onClick: () => void; title?: string; children: React.ReactNode;
}) => (
  <Button size="sm" variant="flat" className="h-7 min-w-0 px-2 text-xs text-default-400"
    title={title} onPress={onClick}>
    {children}
  </Button>
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
    <Button isIconOnly size="sm" variant="light" radius="full" className="h-7 w-7 min-w-0 text-default-400"
      title="移除这一项" onPress={() => { arr.splice(i, 1); rebuild(); onChange(); }}>
      ✕
    </Button>
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

  const metricSel = compact ? (
    <div className="w-full">
      <MetricSelect metrics={metrics}
        value={typeof item === "string" ? item : (item && "metric" in item ? item.metric : undefined)}
        allowEmpty={false} compact
        onChange={v => {
          if (!v) return;
          if (typeof item === "object" && item !== null) item.metric = v;
          else arr[i] = v;
          onChange();
        }} />
    </div>
  ) : (
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

  const rowCls = compact ? "my-1.5 flex flex-wrap items-center gap-1.5" : "my-1 flex items-center gap-1.5";

  if (typeof item === "string") {
    return (
      <div className={rowCls}>
        {metricSel}
        {!allowLabel && <Switch size="sm" aria-label="这个值带单位" title="显示单位"
          isSelected={unitOn} onValueChange={setUnit} />}
        {allowLabel && (
          <Input
            aria-label="前缀文字" size="sm" variant="flat" placeholder="前缀"
            className="w-32 min-w-28 font-poppins" title="直播时显示在这个值前面"
            onBlur={e => {
              if (e.target.value) { arr[i] = { metric: arr[i] as string, label: e.target.value }; rebuild(); onChange(); }
            }}
          />
        )}
        {del}
      </div>
    );
  }
  if (item && "metric" in item && item.metric) {
    return (
      <div className={rowCls}>
        {metricSel}
        {!allowLabel && <Switch size="sm" aria-label="这个值带单位" title="显示单位"
          isSelected={unitOn} onValueChange={setUnit} />}
        {allowLabel && (
          <Input
            aria-label="前缀文字" size="sm" variant="flat" placeholder="前缀"
            className="w-32 min-w-28 font-poppins" title="直播时显示在这个值前面"
            defaultValue={item.label ?? ""}
            onValueChange={v => { item.label = v || undefined; onChange(); }}
          />
        )}
        {del}
      </div>
    );
  }
  if (item && "pair" in item) {
    const vals = item.pair!;
    const numField = (text: string, key: "divide" | "digits" | "digits2", val?: number) => (
      <label className="flex items-center gap-1.5 text-xs text-default-500">
        {text}
        <Input type="number" size="sm" variant="flat" aria-label={`${text}`}
          className="w-16 font-poppins" value={String(val ?? "")}
          onValueChange={v => {
            (item as unknown as Record<string, number | undefined>)[key] = v === "" ? undefined : +v;
            onChange();
          }} />
      </label>
    );
    const sel = (which: 0 | 1) => (
      <MetricSelect metrics={metrics} value={vals[which]} allowEmpty={false} compact={compact}
        onChange={v => { if (!v) return; vals[which] = v; onChange(); }} />
    );
    return (
      <div className={`my-1 flex gap-2 rounded-lg border border-white/[0.06] p-2 ${compact ? "flex-col" : "flex-wrap items-center"}`}>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="flex-none font-poppins text-xs text-default-500" title="两个指标相除">比值</span>
          <div className="min-w-0 flex-1">{sel(0)}</div>
          <span className="flex-none text-default-500">/</span>
          <div className="min-w-0 flex-1">{sel(1)}</div>
          {del}
        </div>
        <div className={`flex flex-wrap items-center gap-3 ${compact ? "" : "ml-auto"}`}>
          {numField("除以", "divide", item.divide)}
          <label className="flex items-center gap-1.5 text-xs text-default-500">
            单位
            <Input size="sm" variant="flat" aria-label="单位" className="w-16 font-poppins"
              value={item.unit ?? ""}
              onValueChange={v => { item.unit = v || undefined; onChange(); }} />
          </label>
          {numField("小数", "digits", item.digits)}
          {numField("分母小数", "digits2", item.digits2)}
          {allowLabel && (
            <label className="flex items-center gap-1.5 text-xs text-default-500">
              前缀
              <Input size="sm" variant="flat" aria-label="前缀" className="w-20 font-poppins"
                defaultValue={item.label ?? ""}
                onBlur={e => { item.label = e.target.value || undefined; onChange(); }} />
            </label>
          )}
          {!allowLabel && <Switch size="sm" aria-label="这个值带单位" title="显示单位"
            isSelected={unitOn} onValueChange={setUnit} />}
        </div>
      </div>
    );
  }
  if (item && ("diff" in item)) {
    return (
      <div className="my-1 flex items-center gap-1.5">
        <span className="text-xs font-poppins text-default-500">
          diff: {(item.diff || []).join(" − ")}
        </span>
        {del}
      </div>
    );
  }
  return (
    <div className="my-1 flex items-center gap-1.5">
      <span className="text-xs font-poppins text-default-500">{JSON.stringify(item)}</span>
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
    <div className={compact ? "my-2 flex flex-col gap-1.5" : "my-2.5 flex items-start gap-3"}>
      <span className={compact ? "" : "w-[110px] flex-none pt-2"}><FieldLabel>{title}</FieldLabel></span>
      <div className="min-w-0 flex-1">
        {rows}
        <div className="mt-1 flex gap-2">
          <MiniBtn title={allowLabel ? "这一行再加一个值" : "这一格再加一个值"} onClick={addItem}>+ 加指标</MiniBtn>
          <MiniBtn title="两个指标相除，比如 显存 已用/总量" onClick={addPair}>+ 加比值</MiniBtn>
        </div>
        {!allowLabel && <div className="mt-1 text-xs text-color-desc">只显示数值；要加前缀字，放小字行</div>}
      </div>
    </div>
  );
}

/** 大数字格的组级设置：分隔符 + 单位显示策略（分段选择器学它的 Tabs 药丸样式）。 */
/** 大数字格的组级设置：只剩分隔符 —— 单位改成每行自己的开关了。 */
export function ValueGroupEditor({ card, onChange, compact }: { card: CardItem; onChange: () => void; compact?: boolean }) {
  const ensure = (): GroupDef => {
    if (!card.value) card.value = { metrics: [] };
    return card.value;
  };
  return (
    <div className={compact ? "my-2 flex flex-col gap-1.5" : "my-2.5 flex items-start gap-3"}>
      <span className={compact ? "" : "w-[110px] flex-none pt-2"}><FieldLabel>分隔符</FieldLabel></span>
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          aria-label="分隔符" size="sm" variant="flat"
          defaultValue={card.value?.sep ?? " · "} className="w-32 font-poppins"
          onValueChange={v => { ensure().sep = v; onChange(); }}
        />
        <span className="text-xs text-color-desc">每个值的单位在它自己的行上开关</span>
      </div>
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
    <div className={`${CARD_CLS} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <FieldLabel>卡 {index + 1}</FieldLabel>
        <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-xs text-default-400"
          onPress={() => { w.items.splice(index, 1); onChange(); }}>
          删卡
        </Button>
      </div>

      <div className="my-3 flex flex-col gap-1.5">
        <span className="text-xs text-color-desc">标题（卡片左上）</span>
        <Input
          aria-label="卡片标题" size="sm" variant="flat"
          defaultValue={card.label ?? ""} className={compact ? "font-poppins" : "max-w-md font-poppins"}
          onValueChange={v => { card.label = v; onChange(); }}
        />
      </div>

      <div className={compact ? "my-3 flex flex-col gap-2" : "my-3 flex flex-wrap items-center gap-5"}>
        <label className={compact ? "flex items-center gap-2 text-xs text-color-desc" : "flex items-center gap-2 text-xs text-color-desc"}>进度条
          <MetricSelect metrics={metrics} value={card.bar} compact={compact}
            onChange={v => { if (v) card.bar = v; else delete card.bar; onChange(); }} />
        </label>
        <label className="flex items-center gap-2 text-xs text-color-desc">迷你曲线
          <MetricSelect metrics={metrics} value={card.spark} compact={compact}
            onChange={v => { if (v) card.spark = v; else delete card.spark; onChange(); }} />
        </label>
      </div>

      <SlotEditor card={card} defKey="value" title="大数字（右上）" allowLabel={false} metrics={metrics} onChange={onChange} compact={compact} />
      <ValueGroupEditor card={card} onChange={onChange} compact={compact} />
      <SlotEditor card={card} defKey="sub" title="小字（下方一行）" allowLabel metrics={metrics} onChange={onChange} compact={compact} />
    </div>
  );
}

export function CardsEditor({ w, metrics, onChange, compact }: { w: CardsWidget; metrics: Metric[]; onChange: () => void; compact?: boolean }) {
  return (
    <div>
      {w.items.map((c, i) => (
        <CardEditor key={c.key ?? i} w={w} card={c} index={i} metrics={metrics} onChange={onChange} compact={compact} />
      ))}
      <div className="mt-2">
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
      <div className="flex items-center gap-2.5">
        <span className="text-xs text-color-desc">字号</span>
        <Input
          aria-label="字号" type="number" size="sm" variant="flat"
          defaultValue={String(w.font ?? 15)} className="w-24 font-poppins"
          onValueChange={v => { w.font = +v || 15; onChange(); }}
        />
      </div>
      <Accordion
        selectionMode="multiple" variant="splitted"
        className="mt-2 px-0"
        itemClasses={{
          base: "mb-2 rounded-xl border border-white/[0.04] bg-[#1a1a1d] px-4 shadow-none last:mb-0",
          title: "text-sm font-medium",
          trigger: "py-2",
        }}
        defaultExpandedKeys={[...byPrefix].filter(([, paths]) => paths.some(p => inChips.has(p))).map(([k]) => k)}
      >
        {[...byPrefix].map(([prefix, paths]) => {
          const checkedCount = paths.filter(p => inChips.has(p)).length;
          return (
            <AccordionItem
              key={prefix}
              aria-label={prefix}
              title={<span className="text-sm">{GROUP_TITLES[prefix] || prefix.toUpperCase()}
                <span className="ml-2 text-xs text-default-500">{checkedCount} 项</span></span>
              }
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-y-1 gap-x-4 pb-2">
                {paths.map(p => {
                  const m = metrics.find(x => x.out === p);
                  return (
                    <Checkbox
                      key={p} size="sm"
                      isSelected={inChips.has(p)}
                      onValueChange={checked => {
                        w.items = (w.items || []).filter(x => x !== p);
                        if (checked) w.items.push(p);
                        onChange();
                      }}
                    >
                      <span className="text-sm">{m?.name ?? p}
                        <span className="ml-1 font-poppins text-xs text-default-500">{p}</span>
                      </span>
                    </Checkbox>
                  );
                })}
              </div>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

const QUICK = ["cpu.usage", "cpu.temp", "gpu.usage", "gpu.temp", "ram.used", "ram.total", "net.up_mbps", "net.down_mbps"];

export function TextEditor({ w, metrics, onChange, compact }: { w: TextWidget; metrics: Metric[]; onChange: () => void; compact?: boolean }) {
  return (
    <div>
      <Hint className="mb-2">{"{指标路径}"} 插实时值；{"{time} {date}"} 为本地时钟/日期。</Hint>
      <Input
        aria-label="正文" size="sm" variant="flat" placeholder="想写的话 + {指标} 占位符"
        defaultValue={w.text ?? ""} className={compact ? "font-poppins" : "max-w-xl font-poppins"}
        onValueChange={v => { w.text = v; onChange(); }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-color-desc">字号</span>
          <Input
            aria-label="字号" type="number" size="sm" variant="flat"
            defaultValue={String(w.size ?? 19)} className="w-24 font-poppins"
            onValueChange={v => { w.size = +v || 19; onChange(); }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pb-1">
          <span className="text-xs text-color-desc">点击插入指标：</span>
          {QUICK.map(p => {
            const name = metrics.find(m => m.out === p)?.name || p;
            return (
              <Button key={p} size="sm" variant="flat" className="h-7 min-w-0 px-2 font-poppins text-xs"
                onPress={() => { w.text = `${w.text || ""}{${p}}`; onChange(); }}>
                {name}
              </Button>
            );
          })}
          {["time", "date"].map(p => (
            <Button key={p} size="sm" variant="flat" className="h-7 min-w-0 px-2 font-poppins text-xs text-primary"
              title={p === "time" ? "本地时钟 HH:MM:SS，每秒跳动" : "本地日期 YYYY-MM-DD"}
              onPress={() => { w.text = `${w.text || ""}{${p}}`; onChange(); }}>
              {p === "time" ? "时钟" : "日期"}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- 自由画布部件的参数面板 ---------------------------------------------------

export function StatEditor({ w, metrics, onChange, compact }: { w: StatWidget; metrics: Metric[]; onChange: () => void; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span className="w-[64px] flex-none text-xs text-color-desc">指标</span>
        <MetricSelect metrics={metrics} value={w.metric} allowEmpty={false} compact={compact}
          onChange={v => { if (v) { w.metric = v; onChange(); } }} />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="w-[64px] flex-none text-xs text-color-desc">名字</span>
        <Input size="sm" variant="flat" className={compact ? "min-w-0 flex-1 font-poppins" : "w-56 font-poppins"} placeholder="可空"
          defaultValue={w.label ?? ""}
          onValueChange={v => { w.label = v || undefined; onChange(); }} />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="w-[64px] flex-none text-xs text-color-desc">字号</span>
        <Input type="number" size="sm" variant="flat" className="w-24 font-poppins"
          defaultValue={String(w.size ?? 26)}
          onValueChange={v => { w.size = +v || 26; onChange(); }} />
      </div>
    </div>
  );
}

export function ProgressEditor({ w, metrics, onChange, compact }: { w: ProgressWidget; metrics: Metric[]; onChange: () => void; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span className="w-[64px] flex-none text-xs text-color-desc">指标</span>
        <MetricSelect metrics={metrics} value={w.metric} allowEmpty={false} compact={compact}
          onChange={v => { if (v) { w.metric = v; onChange(); } }} />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="w-[64px] flex-none text-xs text-color-desc">宽度</span>
        <Input type="number" size="sm" variant="flat" className="w-24 font-poppins"
          defaultValue={String(w.w ?? 260)}
          onValueChange={v => { w.w = +v || 260; onChange(); }} />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="w-[64px] flex-none text-xs text-color-desc">条高</span>
        <Input type="number" size="sm" variant="flat" className="w-24 font-poppins"
          defaultValue={String(w.height ?? 10)}
          onValueChange={v => { w.height = +v || 10; onChange(); }} />
      </div>
    </div>
  );
}

export function GaugeEditor({ w, metrics, onChange, compact }: { w: GaugeWidget; metrics: Metric[]; onChange: () => void; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span className="w-[64px] flex-none text-xs text-color-desc">指标</span>
        <MetricSelect metrics={metrics} value={w.metric} allowEmpty={false} compact={compact}
          onChange={v => { if (v) { w.metric = v; onChange(); } }} />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="w-[64px] flex-none text-xs text-color-desc">标签</span>
        <Input size="sm" variant="flat" className="font-poppins" placeholder="圆环下的小字（可空）"
          defaultValue={typeof w.label === "string" ? w.label : ""}
          onValueChange={v => { w.label = v || undefined; onChange(); }} />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="w-[64px] flex-none text-xs text-color-desc">大小</span>
        <Input type="number" size="sm" variant="flat" className="w-24 font-poppins"
          defaultValue={String(w.size ?? 120)}
          onValueChange={v => { w.size = +v || 120; onChange(); }} />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="w-[64px] flex-none text-xs text-color-desc">环宽</span>
        <Input type="number" size="sm" variant="flat" className="w-24 font-poppins"
          defaultValue={String(w.ring ?? 10)}
          onValueChange={v => { w.ring = +v || 10; onChange(); }} />
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
      <Textarea
        key={taKey}
        aria-label="自定义 HTML" variant="flat" className="font-poppins text-xs" minRows={5}
        defaultValue={w.html}
        onValueChange={v => { w.html = v; onChange(); }} />
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

/** 画布尺寸输入：原地改 draft.canvas，调用方负责重渲染。 */
export function CanvasFields({ draft, onChange }: { draft: OverlayConfig; onChange: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-end gap-5">
      <div className="flex flex-col gap-2">
        <FieldLabel>叠加层宽</FieldLabel>
        <Input
          aria-label="叠加层宽" type="number" size="lg" variant="flat"
          classNames={{ inputWrapper: "px-4" }}
          defaultValue={String(draft.canvas.w)} className="w-36 font-poppins"
          onValueChange={v => { draft.canvas.w = +v || draft.canvas.w; onChange(); }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel>叠加层高</FieldLabel>
        <Input
          aria-label="叠加层高" type="number" size="lg" variant="flat"
          classNames={{ inputWrapper: "px-4" }}
          defaultValue={String(draft.canvas.h)} className="w-36 font-poppins"
          onValueChange={v => { draft.canvas.h = +v || draft.canvas.h; onChange(); }}
        />
      </div>
      <div className="flex flex-col gap-2 pb-3">
        <FieldLabel>背景透明</FieldLabel>
        <div className="flex h-12 items-center">
          <Switch size="sm" aria-label="背景透明"
            isSelected={!!draft.canvas.transparent}
            onValueChange={b => {
              if (b) draft.canvas.transparent = true;
              else delete draft.canvas.transparent;
              onChange();
            }} />
        </div>
      </div>
    </div>
  );
}

/** 顶部装饰命令行：整行开关 + 内容/字号/光标。原地改 draft.prompt。
 * compact：自由排版右侧面板（420px）用竖排，不然定宽输入框会横向溢出。 */
export function PromptBar({ draft, onChange, compact }: {
  draft: OverlayConfig;
  onChange: () => void;
  compact?: boolean;
}) {
  const toggle = (
    <div className={compact ? "flex flex-col gap-2" : "flex flex-col gap-2"}>
      <FieldLabel>顶部命令行装饰</FieldLabel>
      <div className="flex h-12 items-center">
        <Switch size="sm" aria-label="显示顶部命令行装饰"
          isSelected={!!draft.prompt}
          onValueChange={b => {
            if (b) {
              draft.prompt = { user: "streamer@pc", cmd: "./sysmon --source=aida64 --interval=1s", cursor: true, size: 19 };
            } else {
              delete draft.prompt;
            }
            onChange();
          }} />
      </div>
    </div>
  );
  if (!draft.prompt) return <div className="mt-2 flex flex-wrap items-end gap-5">{toggle}</div>;
  const fields = (
    <>
      <div className="flex flex-col gap-2">
        <FieldLabel>用户@主机</FieldLabel>
        <Input aria-label="命令行用户" size="lg" variant="flat"
          className={compact ? "font-poppins" : "w-56 font-poppins"}
          value={draft.prompt.user ?? ""}
          onValueChange={v => { draft.prompt!.user = v; onChange(); }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <FieldLabel>命令行文本</FieldLabel>
        <Input aria-label="命令行文本" size="lg" variant="flat"
          className={compact ? "w-full font-poppins" : "min-w-[280px] font-poppins"}
          value={draft.prompt.cmd ?? ""}
          onValueChange={v => { draft.prompt!.cmd = v; onChange(); }} />
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel>命令行字号</FieldLabel>
        <Input aria-label="命令行字号" type="number" size="lg" variant="flat" className="w-24 font-poppins"
          value={String(draft.prompt.size ?? 19)}
          onValueChange={v => { draft.prompt!.size = +v || 19; onChange(); }} />
      </div>
      <div className="flex flex-col gap-2 pb-3">
        <FieldLabel>闪烁光标</FieldLabel>
        <div className="flex h-12 items-center">
          <Switch size="sm" aria-label="闪烁光标"
            isSelected={draft.prompt.cursor ?? true}
            onValueChange={b => { draft.prompt!.cursor = b; onChange(); }} />
        </div>
      </div>
    </>
  );
  if (compact) {
    return (
      <div className="mt-2 flex flex-col gap-3">
        <div className="flex items-center gap-10">{toggle}</div>
        <div className="flex flex-col gap-3">{fields}</div>
      </div>
    );
  }
  return <div className="mt-2 flex flex-wrap items-end gap-5">{toggle}{fields}</div>;
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
        <div className="absolute left-0 top-0 h-[6%] w-full bg-primary/25"
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
        return <div key={i} className="absolute bg-primary/45" style={style} />;
      })}
    </div>
  );
}

/** 模板库弹窗：几套不同尺寸的常用版式，点一个装进草稿（两个编辑器共用）。 */
export function TemplatePicker({ isOpen, onOpenChange, onPick }: {
  isOpen: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (p: LayoutPreset) => void;
}) {
  const [list, setList] = useState<LayoutPreset[] | null>(null);
  useEffect(() => {
    if (!isOpen || list) return;
    api.layoutPresets().then(d => setList(d.presets)).catch(() => setList([]));
  }, [isOpen, list]);
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex-col items-start gap-1">从模板加载</ModalHeader>
            <ModalBody className="max-h-[68vh] overflow-y-auto">
              {!list && <Hint>加载模板列表…</Hint>}
              {list?.length === 0 && <Hint>模板库读取失败。</Hint>}
              <div className="grid grid-cols-2 gap-3">
                {list?.map(p => (
                  <button key={p.id} type="button"
                    className="flex flex-col gap-2 border border-white/10 bg-[#1a1a1d] p-3 text-left transition-colors hover:border-primary/70"
                    onClick={() => { onPick(p); onClose(); }}>
                    <PresetThumb cfg={p.config} />
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-bold text-default-700">{p.name}</span>
                      <span className="font-poppins text-[11px] text-default-500">
                        {p.config.canvas.w}×{p.config.canvas.h}
                        {p.config.canvas.mode === "free" ? " · 自由" : ""}
                      </span>
                    </span>
                    <span className="text-xs leading-5 text-default-500">{p.desc}</span>
                  </button>
                ))}
              </div>
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
