import { Accordion, AccordionItem, Button, Checkbox, Input, Select, SelectItem } from "@heroui/react";
/** 版式编辑器的子组件：指标选择器、槽位编辑、卡片/chips/text 部件编辑器。
 * 控件一律用 HeroUI。草稿对象直接原地改，改完调 onChange() 触发上层重渲染 + 防抖校验。 */

import { useState } from "react";
import type { CardItem, CardsWidget, ChipsWidget, GroupDef, Metric, TextWidget } from "../types";

const GROUP_TITLES: Record<string, string> = {
  cpu: "CPU", gpu: "显卡", ram: "内存", net: "网络", misc: "主板 / 其他", custom: "自定义",
};

export const outPaths = (metrics: Metric[]): string[] => metrics.filter(m => m.out).map(m => m.out!);

export const metricOpt = (metrics: Metric[], p: string): string => {
  const name = metrics.find(m => m.out === p)?.name || p;
  return `${name} · ${p}`;
};

const NONE = "__none__";

export function MetricSelect({ metrics, value, allowEmpty = true, onChange }: {
  metrics: Metric[];
  value?: string;
  allowEmpty?: boolean;
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
      size="sm" variant="faded"
      className="w-[240px] flex-none"
      selectedKeys={selected ? [selected] : []}
      disallowEmptySelection={!allowEmpty}
      onSelectionChange={keys => {
        const k = [...keys][0] as string | undefined;
        onChange(!k || k === NONE ? "" : k);
      }}
    >
      {options.map(o => <SelectItem key={o.key}>{o.label}</SelectItem>)}
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

/** 槽位（value/sub）的条目行：字符串引用就地改；复合对象只读 + 可删。 */
function SlotRow({ arr, i, allowLabel, metrics, onChange, rebuild }: {
  arr: (string | GroupDef["metrics"][number])[];
  i: number;
  allowLabel: boolean;
  metrics: Metric[];
  onChange: () => void;
  rebuild: () => void;
}) {
  const item = arr[i];
  const del = (
    <Button isIconOnly size="sm" variant="light" radius="full" className="h-7 w-7 min-w-0 text-default-400"
      title="移除这一项" onPress={() => { arr.splice(i, 1); rebuild(); onChange(); }}>
      ✕
    </Button>
  );

  if (typeof item === "string") {
    return (
      <div className="my-1 flex items-center gap-1.5">
        <MetricSelect metrics={metrics} value={item} allowEmpty={false}
          onChange={v => { if (v) { arr[i] = v; onChange(); } }} />
        {allowLabel && (
          <Input
            aria-label="前缀文字" size="sm" variant="flat" placeholder="前面加字（可空）"
            className="w-32 min-w-28" title="填了字，直播时这个值前面就会显示它"
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
      <div className="my-1 flex items-center gap-1.5">
        <MetricSelect metrics={metrics} value={item.metric} allowEmpty={false}
          onChange={v => { if (v) { item.metric = v; onChange(); } }} />
        {allowLabel && (
          <Input
            aria-label="前缀文字" size="sm" variant="flat" placeholder="前面加字（可空）"
            className="w-32 min-w-28" title="填了字，直播时这个值前面就会显示它"
            defaultValue={item.label ?? ""}
            onValueChange={v => { item.label = v || undefined; onChange(); }}
          />
        )}
        {del}
      </div>
    );
  }
  if (item && ("pair" in item || "diff" in item)) {
    const pair = (item.pair || item.diff)!;
    return (
      <div className="my-1 flex items-center gap-1.5">
        <span className="text-xs text-default-500">
          {item.pair ? "pair" : "diff"}: {pair.join(" / ")}
        </span>
        {del}
      </div>
    );
  }
  return (
    <div className="my-1 flex items-center gap-1.5">
      <span className="text-xs text-default-500">{JSON.stringify(item)}</span>
      {del}
    </div>
  );
}

/** 大数字（allowLabel=false）与小字（allowLabel=true）槽位。 */
export function SlotEditor({ card, defKey, title, allowLabel, note, metrics, onChange }: {
  card: CardItem;
  defKey: "value" | "sub";
  title: string;
  allowLabel: boolean;
  note?: string;
  metrics: Metric[];
  onChange: () => void;
}) {
  const def: GroupDef | undefined = card[defKey];
  const list = (def?.metrics ?? []) as (string | GroupDef["metrics"][number])[];
  const rows = list.map((_, i) => (
    <SlotRow key={i} arr={list} i={i}
      allowLabel={allowLabel} metrics={metrics} onChange={onChange}
      rebuild={() => onChange()} />
  ));

  const addItem = () => {
    const first = outPaths(metrics)[0];
    if (def) def.metrics.push(first);
    else (card[defKey] as GroupDef) = { metrics: [first] };
    onChange();
  };

  return (
    <div className="my-2.5 flex items-start gap-3">
      <span className="w-[110px] flex-none pt-2 text-xs text-default-500">{title}</span>
      <div className="min-w-0 flex-1">
        {rows}
        <div className="mt-1">
          <MiniBtn title={allowLabel ? "这一行再加一个值" : "这一格再加一个值"} onClick={addItem}>+ 加指标</MiniBtn>
        </div>
        {note && <div className="mt-1 text-xs text-default-500">{note}</div>}
      </div>
    </div>
  );
}

/** 大数字格的组级设置：分隔符 + 单位显示策略。 */
export function ValueGroupEditor({ card, onChange }: { card: CardItem; onChange: () => void }) {
  const ensure = (): GroupDef => {
    if (!card.value) card.value = { metrics: [] };
    return card.value;
  };
  return (
    <div className="my-2.5 flex items-start gap-3">
      <span className="w-[110px] flex-none pt-2 text-xs text-default-500">分隔符/单位</span>
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-default-500">分隔符</span>
          <Input
            aria-label="分隔符" size="sm" variant="flat"
            defaultValue={card.value?.sep ?? " · "} className="w-32"
            onValueChange={v => { ensure().sep = v; onChange(); }}
          />
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-default-500">单位</span>
          <Select
            aria-label="单位策略" size="sm" variant="flat" className="w-52"
            selectedKeys={[card.value?.unit_policy ?? "last"]}
            disallowEmptySelection
            onSelectionChange={keys => {
              const k = [...keys][0] as string;
              ensure().unit_policy = (k === "all" ? "all" : "last");
              onChange();
            }}
          >
            <SelectItem key="last">只最后一个值带单位</SelectItem>
            <SelectItem key="all">每个值都带单位</SelectItem>
          </Select>
        </div>
      </div>
    </div>
  );
}

function CardEditor({ w, card, index, metrics, onChange }: {
  w: CardsWidget;
  card: CardItem;
  index: number;
  metrics: Metric[];
  onChange: () => void;
}) {
  return (
    <fieldset className="my-3 rounded-2xl border border-divider bg-background px-4 pb-3">
      <legend className="flex items-center gap-2 px-2 text-xs text-default-500">
        卡 {index + 1}
        <Button size="sm" variant="light" className="h-6 min-w-0 px-1.5 text-xs text-default-400"
          onPress={() => { w.items.splice(index, 1); onChange(); }}>
          删卡
        </Button>
      </legend>

      <div className="my-3 flex items-center gap-3">
        <span className="text-xs text-default-500">标题（卡片左上）</span>
        <Input
          aria-label="卡片标题" size="sm" variant="flat"
          defaultValue={card.label ?? ""} className="max-w-md"
          onValueChange={v => { card.label = v; onChange(); }}
        />
      </div>

      <div className="my-3 flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2 text-xs text-default-500">进度条
          <MetricSelect metrics={metrics} value={card.bar}
            onChange={v => { if (v) card.bar = v; else delete card.bar; onChange(); }} />
        </label>
        <label className="flex items-center gap-2 text-xs text-default-500">迷你曲线
          <MetricSelect metrics={metrics} value={card.spark}
            onChange={v => { if (v) card.spark = v; else delete card.spark; onChange(); }} />
        </label>
      </div>

      <SlotEditor card={card} defKey="value" title="大数字（右上）" allowLabel={false} metrics={metrics}
        note="这一格只显示数值不加名字；想给值加“核心”这样的前缀字，放进小字行" onChange={onChange} />
      <ValueGroupEditor card={card} onChange={onChange} />
      <SlotEditor card={card} defKey="sub" title="小字（下方一行）" allowLabel metrics={metrics} onChange={onChange} />
    </fieldset>
  );
}

export function CardsEditor({ w, metrics, onChange }: { w: CardsWidget; metrics: Metric[]; onChange: () => void }) {
  return (
    <div>
      <p className="mb-2 rounded-lg border border-divider bg-content1 px-3 py-1.5 text-xs text-default-500">
        每张卡片：左边标题，右上角大数字，中间一条进度条，下面一行小字和迷你曲线。哪个格显示什么指标都能换。
      </p>
      {w.items.map((c, i) => (
        <CardEditor key={c.key ?? i} w={w} card={c} index={i} metrics={metrics} onChange={onChange} />
      ))}
      <div className="mt-1.5">
        <Button size="sm" variant="flat" onPress={() => {
          const first = outPaths(metrics)[0];
          const keys = new Set(w.items.map(c => c.key));
          let n = 1;
          while (keys.has(`card${n}`)) n += 1;
          w.items.push({ key: `card${n}`, label: "新卡片", bar: first,
            value: { metrics: [first] }, sub: { sep: " · ", metrics: [] } });
          onChange();
        }}>+ 加一张卡</Button>
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
      <p className="mb-2 rounded-lg border border-divider bg-content1 px-3 py-1.5 text-xs text-default-500">
        叠加层底部那一行小指标。勾谁谁出现，顺序跟着勾的先后走；放不下会自动缩小一号。
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-default-500">字号</span>
        <Input
          aria-label="字号" type="number" size="sm" variant="flat"
          defaultValue={String(w.font ?? 15)} className="w-24"
          onValueChange={v => { w.font = +v || 15; onChange(); }}
        />
      </div>
      <Accordion
        selectionMode="multiple"
        className="mt-2 px-0"
        defaultExpandedKeys={[...byPrefix].filter(([, paths]) => paths.some(p => inChips.has(p))).map(([k]) => k)}
      >
        {[...byPrefix].map(([prefix, paths]) => {
          const checkedCount = paths.filter(p => inChips.has(p)).length;
          return (
            <AccordionItem
              key={prefix}
              aria-label={prefix}
              title={<span className="text-[13px]">{GROUP_TITLES[prefix] || prefix.toUpperCase()}
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
                      <span className="text-[13px]">{m?.name ?? p}
                        <span className="ml-1 text-[11px] text-default-500">{p}</span>
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

export function TextEditor({ w, metrics, onChange }: { w: TextWidget; metrics: Metric[]; onChange: () => void }) {
  return (
    <div>
      <p className="mb-2 rounded-lg border border-divider bg-content1 px-3 py-1.5 text-xs text-default-500">
        想写什么就写什么，指标值用花括号插进去：正文里放 {"{cpu.usage}"}，
        直播时它就变成 CPU 使用率的实时数字，没有数据时显示 --。
      </p>
      <Input
        aria-label="正文" size="sm" variant="flat" placeholder="想写的话 + {指标} 占位符"
        defaultValue={w.text ?? ""} className="max-w-xl"
        onValueChange={v => { w.text = v; onChange(); }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-default-500">字号</span>
          <Input
            aria-label="字号" type="number" size="sm" variant="flat"
            defaultValue={String(w.size ?? 19)} className="w-24"
            onValueChange={v => { w.size = +v || 19; onChange(); }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pb-1">
          <span className="text-xs text-default-500">点击插入指标：</span>
          {QUICK.map(p => {
            const name = metrics.find(m => m.out === p)?.name || p;
            return (
              <Button key={p} size="sm" variant="flat" className="h-7 min-w-0 px-2 text-xs"
                onPress={() => { w.text = `${w.text || ""}{${p}}`; onChange(); }}>
                {name}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
