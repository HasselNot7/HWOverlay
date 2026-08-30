import { useEffect, useReducer, useRef } from "react";
import type { FreePos, OverlayConfig, Widget } from "../types";

/** 自由画布：叠加层等比缩放的摆放区。盒子拖动改 x/y、右下角手柄改 w/h，
 * 数据直接原地写进 draft.widgets[i]，拖动中用本地计数强制重渲染。 */

const TYPE_LABEL: Record<string, string> = {
  cards: "指标卡片", chips: "小指标行", text: "文本",
  stat: "大数字", progress: "进度条", html: "自定义 HTML",
};

/** 盒子默认宽高（配置没写 w/h 的类型给个可抓取的面积） */
function boxSize(w: Widget): { w: number; h: number } {
  if (w.type === "html") return { w: w.w ?? 320, h: w.h ?? 60 };
  if (w.type === "progress") return { w: w.w ?? 260, h: Math.max((w.height ?? 10) + 8, 26) };
  if (w.type === "stat") return { w: w.w ?? 300, h: Math.max((w.size ?? 26) * 1.5, 34) };
  if (w.type === "cards") return { w: (w as { cols?: number }).cols ? 720 : 480, h: 150 };
  if (w.type === "chips") return { w: 560, h: 40 };
  return { w: 420, h: 34 };
}

function boxSummary(w: Widget): string {
  if (w.type === "stat" || w.type === "progress") return w.metric;
  if (w.type === "html") return (w.html || "").replace(/\{[a-zA-Z0-9_.]+\}/g, "…").slice(0, 40);
  if (w.type === "cards") return `${(w as { items?: unknown[] }).items?.length ?? 0} 张卡`;
  if (w.type === "chips") return `${(w as { items?: unknown[] }).items?.length ?? 0} 项`;
  if (w.type === "text") return (w as { text?: string }).text || "";
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
  const drag = useRef<null | {
    i: number; mode: "move" | "resize";
    sx: number; sy: number; ox: number; oy: number; ow: number; oh: number;
  }>(null);

  const canvas = draft.canvas;
  const fit = () => {
    const cw = wrapRef.current?.clientWidth;
    if (cw && canvas.w) {
      scaleRef.current = Math.min(1, (cw - 2) / canvas.w);
      force();
    }
  };
  useEffect(() => {
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.w]);
  const scale = scaleRef.current;

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const w = draft.widgets[d.i] as FreePos;
      if (!w) return;
      const dx = Math.round((e.clientX - d.sx) / scale);
      const dy = Math.round((e.clientY - d.sy) / scale);
      if (d.mode === "move") {
        w.x = Math.max(0, d.ox + dx);
        w.y = Math.max(0, d.oy + dy);
      } else {
        if (d.ow) w.w = Math.max(40, d.ow + dx);
        if (d.oh) w.h = Math.max(16, d.oh + dy);
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
  }, [scale, draft, onChange]);

  return (
    <div ref={wrapRef}
      className="relative w-full select-none overflow-hidden rounded-xl border border-white/[0.04] bg-[#1b1d24]"
      style={{ height: Math.ceil((canvas.h || 200) * scale) }}
      onMouseDown={() => onSelect(null)}>
      {/* 背景网格给拖拽一点空间感 */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: "linear-gradient(#26262b 1px, transparent 1px), linear-gradient(90deg, #26262b 1px, transparent 1px)",
          backgroundSize: `${40 * scale}px ${40 * scale}px`,
        }} />
      {draft.widgets.map((w, i) => {
        const pos = w as FreePos;
        const size = boxSize(w);
        const bw = pos.w ?? size.w;
        const bh = pos.h ?? size.h;
        const isSel = selected === i;
        return (
          <div key={i}
            className={`absolute cursor-move rounded-lg border ${isSel ? "border-primary bg-primary/10" : "border-default-500 bg-black/40 hover:border-default-300"}`}
            style={{ left: (pos.x ?? 0) * scale, top: (pos.y ?? 0) * scale, width: bw * scale, height: bh * scale }}
            onMouseDown={e => { e.stopPropagation(); onDown(e, i, "move"); }}>
            <div className="pointer-events-none flex h-full flex-col justify-between p-1.5">
              <span className={`w-fit rounded px-1.5 py-0.5 text-[11px] leading-4 ${isSel ? "bg-primary text-white" : "bg-default-100 text-default-500"}`}>
                {TYPE_LABEL[w.type] ?? w.type}
              </span>
              <span className="truncate font-poppins text-[11px] text-default-400">{boxSummary(w)}</span>
            </div>
            {/* 右下角缩放：有 w/h 概念的类型才有 */}
            {["html", "progress", "stat", "cards", "chips", "text"].includes(w.type) && (
              <div
                className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize rounded-tl bg-default-500/60 hover:bg-primary"
                title="拖拽调整大小"
                onMouseDown={e => { e.stopPropagation(); onDown(e, i, "resize"); }} />
            )}
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
