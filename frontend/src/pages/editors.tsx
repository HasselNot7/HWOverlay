/** 版式编辑器的子组件：指标选择器、槽位编辑、卡片/chips/text 部件编辑器。
 * 草稿对象直接原地改，改完调 onChange() 触发上层重渲染 + 防抖校验。 */

import type { CardItem, CardsWidget, ChipsWidget, GroupDef, Metric, TextWidget } from "../types";

const GROUP_TITLES: Record<string, string> = {
  cpu: "CPU", gpu: "显卡", ram: "内存", net: "网络", misc: "主板 / 其他", custom: "自定义",
};

export const outPaths = (metrics: Metric[]): string[] => metrics.filter(m => m.out).map(m => m.out!);

export const metricOpt = (metrics: Metric[], p: string): string => {
  const name = metrics.find(m => m.out === p)?.name || p;
  return `${name} · ${p}`;
};

/** 轻量原生 select，外观与 HeroUI 控件一致（chevron 样式在 index.css 的 .sel-chevron） */
export function MetricSelect({ metrics, value, allowEmpty, onChange }: {
  metrics: Metric[];
  value?: string;
  allowEmpty?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="sel-chevron rounded-lg border border-transparent bg-content2 px-3 py-1.5 pr-8 text-xs text-foreground
                 transition-colors hover:bg-[#2a2a2f] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
    >
      {allowEmpty !== false && <option value="">{value ? metricOpt(metrics, value) : "(不用)"}</option>}
      {metrics.filter(m => m.out && m.out !== value).map(m => (
        <option key={m.out} value={m.out!}>{metricOpt(metrics, m.out!)}</option>
      ))}
    </select>
  );
}

const MiniBtn = ({ onClick, title, children }: {
  onClick: () => void; title?: string; children: React.ReactNode;
}) => (
  <button
    onClick={onClick} title={title}
    className="rounded-md border border-transparent bg-content2 px-2 py-0.5 text-xs text-default-400
               transition-colors hover:text-foreground"
  >
    {children}
  </button>
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
    <MiniBtn title="移除这一项" onClick={() => { arr.splice(i, 1); rebuild(); onChange(); }}>✕</MiniBtn>
  );

  if (typeof item === "string") {
    return (
      <div className="my-0.5 flex items-center gap-1">
        <MetricSelect metrics={metrics} value={item} allowEmpty={false}
          onChange={v => { arr[i] = v; onChange(); }} />
        {allowLabel && (
          <input
            type="text" placeholder="前面加字（可空）" className="w-[84px] rounded-lg border border-transparent
              bg-content2 px-2.5 py-1.5 text-xs hover:bg-[#2a2a2f] focus:border-primary focus:outline-none
              focus:ring-2 focus:ring-primary/30"
            title="填了字，直播时这个值前面就会显示它"
            onChange={e => {
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
      <div className="my-0.5 flex items-center gap-1">
        <MetricSelect metrics={metrics} value={item.metric} allowEmpty={false}
          onChange={v => { item.metric = v; onChange(); }} />
        {allowLabel && (
          <input
            type="text" placeholder="前面加字（可空）" defaultValue={item.label ?? ""}
            className="w-[84px] rounded-lg border border-transparent bg-content2 px-2.5 py-1.5 text-xs
              hover:bg-[#2a2a2f] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            title="填了字，直播时这个值前面就会显示它"
            onChange={e => { item.label = e.target.value || undefined; onChange(); }}
          />
        )}
        {del}
      </div>
    );
  }
  if (item && ("pair" in item || "diff" in item)) {
    const pair = (item.pair || item.diff)!;
    return (
      <div className="my-0.5 flex items-center gap-1">
        <span className="text-xs text-default-500">
          {item.pair ? "pair" : "diff"}: {pair.join(" / ")}
        </span>
        {del}
      </div>
    );
  }
  return (
    <div className="my-0.5 flex items-center gap-1">
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
  const list = def?.metrics ?? [];
  const rows = list.map((_, i) => (
    <SlotRow key={i} arr={list as (string | GroupDef["metrics"][number])[]} i={i}
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
    <div className="my-2 flex items-start gap-2.5">
      <span className="w-[110px] flex-none text-xs leading-7 text-default-500">{title}</span>
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
    <div className="my-2 flex items-start gap-2.5">
      <span className="w-[110px] flex-none text-xs leading-7 text-default-500">分隔符/单位</span>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-default-500">分隔符</span>
          <input
            type="text" defaultValue={card.value?.sep ?? " · "} size={8}
            className="rounded-lg border border-transparent bg-content2 px-2.5 py-1.5 text-xs
              hover:bg-[#2a2a2f] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            title="多个值之间的分隔文字；清空则用默认的 ' · '"
            onChange={e => { ensure().sep = e.target.value; onChange(); }}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-default-500">单位</span>
          <select
            className="sel-chevron rounded-lg border border-transparent bg-content2 px-2.5 py-1.5 pr-8 text-xs
              transition-colors hover:bg-[#2a2a2f] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={card.value?.unit_policy ?? "last"} title="单位挂在哪些值后面"
            onChange={e => { ensure().unit_policy = e.target.value as "last" | "all"; onChange(); }}
          >
            <option value="last">只最后一个值带单位</option>
            <option value="all">每个值都带单位</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function CardEditor({ w, card, index, metrics, onChange, rebuildCards, removeCard }: {
  w: CardsWidget;
  card: CardItem;
  index: number;
  metrics: Metric[];
  onChange: () => void;
  rebuildCards: () => void;
  removeCard: () => void;
}) {
  return (
    <fieldset className="my-2.5 rounded-xl border border-divider bg-content1 px-3 pb-2.5">
      <legend className="flex items-center gap-2 px-1.5 text-xs text-default-500">
        卡 {index + 1}
        <MiniBtn title="删除这张卡片" onClick={() => { w.items.splice(index, 1); rebuildCards(); onChange(); }}>删卡</MiniBtn>
      </legend>

      <div className="my-2 flex items-center gap-2">
        <span className="text-xs text-default-500">标题（卡片左上）</span>
        <input
          type="text" defaultValue={card.label ?? ""} size={26}
          className="rounded-lg border border-transparent bg-content2 px-2.5 py-1.5 text-xs
            hover:bg-[#2a2a2f] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          onChange={e => { card.label = e.target.value; onChange(); }}
        />
      </div>

      <div className="my-2 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs text-default-500">进度条
          <MetricSelect metrics={metrics} value={card.bar}
            onChange={v => { if (v) card.bar = v; else delete card.bar; onChange(); }} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-default-500">迷你曲线
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
  const [, bump] = useReducerTick();
  const rebuildCards = () => bump();
  return (
    <div className="w-body">
      <p className="hint">
        每张卡片：左边标题，右上角大数字，中间一条进度条，下面一行小字和迷你曲线。哪个格显示什么指标都能换。
      </p>
      {w.items.map((c, i) => (
        <CardEditor key={c.key ?? i} w={w} card={c} index={i} metrics={metrics}
          onChange={onChange} rebuildCards={rebuildCards}
          removeCard={() => { w.items.splice(i, 1); rebuildCards(); onChange(); }} />
      ))}
      <div className="mt-1.5">
        <MiniBtn onClick={() => {
          const first = outPaths(metrics)[0];
          const keys = new Set(w.items.map(c => c.key));
          let n = 1;
          while (keys.has(`card${n}`)) n += 1;
          w.items.push({ key: `card${n}`, label: "新卡片", bar: first,
            value: { metrics: [first] }, sub: { sep: " · ", metrics: [] } });
          rebuildCards(); onChange();
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
      <p className="hint">
        叠加层底部那一行小指标。勾谁谁出现，顺序跟着勾的先后走；放不下会自动缩小一号。
      </p>
      <div className="my-2 flex items-center gap-2">
        <span className="text-xs text-default-500">字号</span>
        <input
          type="number" defaultValue={w.font ?? 15} min={8} max={40}
          className="w-16 rounded-lg border border-transparent bg-content2 px-2.5 py-1.5 text-xs
            hover:bg-[#2a2a2f] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          onChange={e => { w.font = +e.target.value; onChange(); }}
        />
      </div>
      {[...byPrefix].map(([prefix, paths]) => {
        const checkedCount = paths.filter(p => inChips.has(p)).length;
        return (
          <details key={prefix} className="my-2 rounded-xl border border-divider bg-content1" open={checkedCount > 0}>
            <summary className="cursor-pointer select-none px-3 py-1.5 text-[13px] text-default-400 marker:text-primary">
              <b className="mr-2 font-bold">{GROUP_TITLES[prefix] || prefix.toUpperCase()}</b>
              <span className="text-xs text-default-500">{checkedCount} 项</span>
            </summary>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-y-1 gap-x-4 border-t border-divider p-3">
              {paths.map(p => {
                const m = metrics.find(x => x.out === p);
                return (
                  <label key={p} className="flex cursor-pointer items-baseline gap-1.5 text-[13px]">
                    <input
                      type="checkbox" checked={inChips.has(p)} className="accent-primary"
                      onChange={e => {
                        w.items = (w.items || []).filter(x => x !== p);
                        if (e.target.checked) w.items.push(p);
                        onChange();
                      }}
                    />
                    <span>{m?.name ?? p}</span>
                    <span className="text-[11px] text-default-500">{p}</span>
                  </label>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

const QUICK = ["cpu.usage", "cpu.temp", "gpu.usage", "gpu.temp", "ram.used", "ram.total", "net.up_mbps", "net.down_mbps"];

export function TextEditor({ w, metrics, onChange }: { w: TextWidget; metrics: Metric[]; onChange: () => void }) {
  return (
    <div>
      <p className="hint">
        想写什么就写什么，指标值用花括号插进去：正文里放 {"{cpu.usage}"}，
        直播时它就变成 CPU 使用率的实时数字，没有数据时显示 --。
      </p>
      <div className="my-2 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-default-500">正文</span>
          <input
            type="text" defaultValue={w.text ?? ""} size={60}
            className="w-[420px] rounded-lg border border-transparent bg-content2 px-2.5 py-1.5 text-xs
              hover:bg-[#2a2a2f] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            onChange={e => { w.text = e.target.value; onChange(); }}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-default-500">字号</span>
          <input
            type="number" defaultValue={w.size ?? 19} min={8} max={60}
            className="w-16 rounded-lg border border-transparent bg-content2 px-2.5 py-1.5 text-xs
              hover:bg-[#2a2a2f] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            onChange={e => { w.size = +e.target.value; onChange(); }}
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs text-default-500">点击插入指标：</span>
        {QUICK.map(p => {
          const name = metrics.find(m => m.out === p)?.name || p;
          return (
            <MiniBtn key={p} onClick={() => {
              w.text = `${w.text || ""}{${p}}`;
              onChange();
            }}>{name}</MiniBtn>
          );
        })}
      </div>
    </div>
  );
}

/** 极简强制重渲染钩子（卡片增删时重建列表） */
import { useState } from "react";
function useReducerTick(): [number, () => void] {
  const [n, setN] = useState(0);
  return [n, () => setN(n + 1)];
}
