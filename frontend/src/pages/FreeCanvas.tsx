import { useEffect, useReducer, useRef } from "react";
import type { FreePos, OverlayConfig, Widget } from "../types";

/** 自由画布：叠加层等比缩放的摆放区。盒子拖动改 x/y、右下角手柄改 w/h，
 * 数据直接原地写进 draft.widgets[i]；拖动过程中同步直改 DOM，不依赖重渲染。
 * 盒子几何尽量贴近真实渲染：cards/chips/text 未写 w 时视为"从 x 拉到右缘"，
 * 高度用与 widgets.py 同口径的估算（estHeight）。 */

const TYPE_LABEL: Record<string, string> = {
  cards: "指标卡片", chips: "小指标行", text: "文本",
  stat: "大数字", progress: "进度条", html: "自定义 HTML",
};

/** 与 hwobs/widgets.py 的 height() 同口径的部件高度估算。 */
export function estHeight(w: Widget): number {
  const line = (px: number) => Math.round(px * 1.2);
  switch (w.type) {
    case "cards": {
      const cols = Math.max(1, w.cols ?? 4);
      const items = w.items?.length ?? 0;
      const rows = Math.ceil(items / cols);
      return rows * (w.item_height ?? 66) + Math.max(0, rows - 1) * (w.gap ?? 32);
    }
    case "chips":
      return line(w.font ?? 15) + (w.margin_top ?? 10);
    case "text":
      return line(w.size ?? 19) + (w.margin_top ?? 0);
    case "stat":
      return line(w.size ?? 26);
    case "progress":
      return w.height ?? 10;
    case "html":
      return w.h ?? 60;
  }
}

/** cards/chips/text 没写 w 时 = 从 x 拉到画布右缘（渲染端 right:0 同款语义） */
function boxGeom(w: Widget, canvasW: number): { w: number; h: number; stretch: boolean } {
  const x = (w as FreePos).x ?? 0;
  const own = (w as FreePos).w;
  if ((w.type === "cards" || w.type === "chips" || w.type === "text") && !own) {
    return { w: Math.max(80, canvasW - x), h: estHeight(w), stretch: true };
  }
  if (w.type === "html") return { w: w.w ?? 320, h: w.h ?? 60, stretch: false };
  if (w.type === "progress") return { w: w.w ?? 260, h: Math.max(estHeight(w), 18), stretch: false };
  return { w: own ?? 300, h: Math.max(estHeight(w), 24), stretch: false };
}

function boxSummary(w: Widget): string {
  if (w.type === "stat" || w.type === "progress") return w.metric;
  if (w.type === "html") return (w.html || "").replace(/\{[a-zA-Z0-9_.]+\}/g, "…").slice(0, 40);
  if (w.type === "cards") return `${w.items?.length ?? 0} 张卡`;
  if (w.type === "chips") return `${w.items?.length ?? 0} 项`;
  if (w.type === "text") return w.text || "";
  return "";
}

export default function FreeCanvas({ draft, selected, onSelect, onChange }: {
  draft: OverlayConfig;
  selected: number | null;
  onSelect: (i: number | null) => void;
  onChange: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [, force] = useReducer(x => x + 1, 0);
  const scaleRef = useRef(0.5);
  const boxRefs = useRef(new Map<number, HTMLDivElement>());
  const drag = useRef<null | {
    i: number; mode: "move" | "resize";
    sx: number; sy: number; ox: number; oy: number; ow: number; oh: number;
  }>(null);

  const canvas = draft.canvas;
  const fit = () => {
    const cw = wrapRef.current?.clientWidth;
    if (cw && canvas.w) {
      const s = Math.min(1, (cw - 2) / canvas.w);
      // 拖动进行中不换比例：盒子位置是按旧 scale 直改的 DOM，突然换算会跳变
      if (Math.abs(s - scaleRef.current) > 0.001 && !drag.current) {
        scaleRef.current = s;
        force();
      }
    }
  };
  // 面板挂载时布局还没展开，clientWidth 会先给一个错误的小值；
  // window resize 捕捉不到"面板展开"，必须用 ResizeObserver 盯容器本身
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    fit();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.w]);
  const scale = scaleRef.current;

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const w = draft.widgets[d.i] as FreePos | undefined;
      if (!w) return;
      const dx = Math.round((e.clientX - d.sx) / scale);
      const dy = Math.round((e.clientY - d.sy) / scale);
      // 全程钳在画布内，盒子拖不出可视区（以前 overflow 一藏就"消失"）
      const nx = Math.max(0, Math.min(d.ox + dx, canvas.w - 24));
      const ny = Math.max(0, Math.min(d.oy + dy, canvas.h - 8));
      const nw = d.ow ? Math.max(40, Math.min(d.ow + dx, canvas.w - nx)) : d.ow;
      const nh = d.oh ? Math.max(16, Math.min(d.oh + dy, canvas.h - ny)) : d.oh;
      if (d.mode === "move") {
        w.x = nx;
        w.y = ny;
      } else {
        if (d.ow) w.w = nw;
        if (d.oh) w.h = nh;
      }
      // 拖动中直改 DOM，等宽等距跟手；React 稍后确认同一份状态
      const node = boxRefs.current.get(d.i);
      if (node) {
        node.style.left = nx * scale + "px";
        node.style.top = ny * scale + "px";
        if (d.mode === "resize") {
          if (d.ow) node.style.width = nw * scale + "px";
          if (d.oh) node.style.height = nh * scale + "px";
        }
      }
      force();
      onChange();
    };
    const up = () => { drag.current = null; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, draft, onChange, canvas.w, canvas.h]);

  return (
    <div ref={wrapRef}
      className="relative w-full select-none overflow-hidden rounded-xl border border-white/[0.04] bg-[#1b1d24]"
      style={{ height: Math.ceil((canvas.h || 200) * scale) }}
      onMouseDown={() => onSelect(null)}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: "linear-gradient(#26262b 1px, transparent 1px), linear-gradient(90deg, #26262b 1px, transparent 1px)",
          backgroundSize: `${40 * scale}px ${40 * scale}px`,
        }} />
      {draft.widgets.map((w, i) => {
        const pos = w as FreePos;
        const geom = boxGeom(w, canvas.w || 2000);
        const isSel = selected === i;
        return (
          <div key={i}
            ref={node => {
              if (node) boxRefs.current.set(i, node);
              else boxRefs.current.delete(i);
            }}
            className={`absolute cursor-move rounded-lg border ${isSel ? "border-primary bg-primary/10 shadow-lg" : "border-default-500 bg-black/40 hover:border-default-300"}`}
            style={{
              left: (pos.x ?? 0) * scale, top: (pos.y ?? 0) * scale,
              width: geom.w * scale, height: geom.h * scale,
              zIndex: isSel ? 30 : i,
            }}
            onMouseDown={e => { e.stopPropagation(); onDown(e, i, "move"); }}>
            <div className="pointer-events-none flex h-full flex-col justify-between p-1.5">
              <span className={`flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-4 ${isSel ? "bg-primary text-white" : "bg-default-100 text-default-500"}`}>
                {TYPE_LABEL[w.type] ?? w.type}
                {geom.stretch && <span className="opacity-60">· 通栏</span>}
              </span>
              <span className="truncate font-poppins text-[11px] text-default-400">{boxSummary(w)}</span>
            </div>
            <div
              className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize rounded-tl bg-default-500/60 hover:bg-primary"
              title="拖拽调整大小"
              onMouseDown={e => { e.stopPropagation(); onDown(e, i, "resize"); }} />
          </div>
        );
      })}
    </div>
  );

  function onDown(e: React.MouseEvent, i: number, mode: "move" | "resize") {
    onSelect(i);
    const w = draft.widgets[i] as FreePos;
    drag.current = {
      i, mode,
      sx: e.clientX, sy: e.clientY,
      ox: w?.x ?? 0, oy: w?.y ?? 0, ow: w?.w ?? 0, oh: w?.h ?? 0,
    };
  }
}
