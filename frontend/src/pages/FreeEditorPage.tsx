import { addToast, Button, Input } from "@heroui/react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, clone, outPaths } from "../api";
import type {
  CardsWidget, ChipsWidget, FreePos, HtmlWidget, OverlayConfig,
  ProgressWidget, StatWidget, TextWidget, Widget,
} from "../types";
import type { Shared } from "../App";
import { CARD_CLS, FieldLabel, Hint, SubTitle } from "../ui";
import {
  CanvasFields, CardsEditor, ChipsEditor, HtmlEditor, PromptBar,
  ProgressEditor, StatEditor, TextEditor,
} from "./editors";

/** 全屏自由排版工作台：画布（真实渲染的 monitor.html 预览 iframe）铺满主体，
 * 工具栏吸顶、参数面板浮动右侧、保存条吸底。
 * 手柄盒叠在 iframe 上方，几何由 monitor 每次 build 后 postMessage 回报
 * （hwobs-rects）—— 所见即所得。拖动过程直改宿主节点 style 跟手，松手才进草稿。
 * 快捷键：Ctrl+Z 撤销（结构操作）· Ctrl+D 复制 · 方向键微调(Shift=10px) ·
 * Ctrl+S 保存 · Delete 删除。 */

const WIDGET_LABEL: Record<string, string> = {
  cards: "指标卡片", chips: "小指标行", text: "自定义文字",
  stat: "大数字", progress: "进度条", html: "自定义 HTML",
};

/** 开发态预览 iframe 指向 python 后端（跨源也能收发 postMessage）；构建产物里留空 = 同源。 */
const BACKEND = (import.meta.env.VITE_BACKEND as string | undefined) || "";

interface Rect { x: number; y: number; w: number; h: number; }

/** 流式版式转来自由画布时，没坐标的部件按估算高度在原内边距处竖排一遍 */
function estHeight(w: Widget): number {
  const line = (px: number) => Math.round(px * 1.2);
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
  }
}

const stretchable = (t: string) => t === "cards" || t === "chips" || t === "text";
const heightEditable = (t: string) => t === "html" || t === "progress";
/** 吸附判定距离（画布像素）：拖动时边缘靠得比这近就吸上去 */
const SNAP_PX = 8;
/** 网格尺寸（画布像素）：网格开时位置就近吸附到网格线 */
const GRID_PX = 40;
/** 右侧浮动面板宽度（px）：适配缩放时给画布留出的空间 */
const PANEL_W = 440;
/** 面板收起记忆的 localStorage 键 */
const PANEL_KEY = "hwobs.freePanel";

/** 草稿转自由画布：mode=free + 给缺坐标的部件排初始位置（margin_top 折算进 y） */
function toFree(d: OverlayConfig) {
  d.canvas.mode = "free";
  const pad = d.canvas.padding || [12, 24];
  let y = pad[0];
  if (d.prompt) y += Math.round((d.prompt.size ?? 19) * 1.2) + 10;
  for (const w of d.widgets) {
    const p = w as FreePos;
    if (p.x === undefined || p.y === undefined) {
      p.x = pad[1];
      p.y = y;
      y += estHeight(w) + 8;
    }
  }
}

interface DragState {
  i: number;
  mode: "move" | "resize";
  sx: number; sy: number;
  ox: number; oy: number; ow: number; oh: number;
  stretch: boolean;
  nx?: number; ny?: number; nw?: number; nh?: number;
}

export default function FreeEditorPage({ shared }: { shared: Shared }) {
  const { metrics } = shared;
  const [cfg, setCfg] = useState<OverlayConfig | null>(null);
  const [draft, setDraft] = useState<OverlayConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "" | "ok" | "bad" | "warn" }>({ text: "", kind: "" });
  const [check, setCheck] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [pvKey, setPvKey] = useState(0);
  const [pvScale, setPvScale] = useState(0.45);
  /** null = 适应（整幅画布都在视口里）；数字 = 用户点 +/- 定下的固定倍率 */
  const [zoom, setZoom] = useState<number | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [gridOn, setGridOn] = useState(true);
  /** 右侧参数面板：收起后画布吃满整行（记住上次的选择） */
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem(PANEL_KEY) !== "0");
  const [selected, setSelected] = useState<number | null>(null);
  const [rects, setRects] = useState<(Rect | null)[]>([]);
  /** 顶部装饰命令行的真实几何：作为吸附目标，部件好对齐它的首部 */
  const [promptRect, setPromptRect] = useState<Rect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRefs = useRef(new Map<number, HTMLDivElement>());
  const dragRef = useRef<DragState | null>(null);
  const scaleRef = useRef(pvScale);
  const draftRef = useRef<OverlayConfig | null>(null);
  const rectsRef = useRef<(Rect | null)[]>([]);
  const promptRef = useRef<Rect | null>(null);
  const snapRef = useRef(true);
  const gridRef = useRef(false);
  const vgRef = useRef<HTMLDivElement>(null);
  const hgRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const histRef = useRef<string[]>([]);
  const lastPushRef = useRef(0);
  scaleRef.current = pvScale;
  draftRef.current = draft;
  rectsRef.current = rects;
  promptRef.current = promptRect;
  snapRef.current = snapOn;
  gridRef.current = gridOn;

  const loadConfig = useCallback(async () => {
    const c = await api.overlay();
    const d = clone(c);
    const wasFlow = d.canvas.mode !== "free";
    toFree(d);
    setCfg(c);
    setDraft(d);
    setSelected(null);
    setRects([]);
    setPromptRect(null);
    histRef.current = [];
    const isDirty = JSON.stringify(d) !== JSON.stringify(c);
    setDirty(isDirty);
    setMsg(isDirty
      ? { text: wasFlow ? "已把版式切到自由画布（还没保存）" : "有未保存的改动", kind: "warn" }
      : { text: "", kind: "" });
    try { setCheck(await api.layoutCheck()); } catch { /* 校验面板留空 */ }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  /** 结构操作的历史快照（拖动/增删/复制/层级/微调），Ctrl+Z 逐层回退 */
  const pushHistory = () => {
    const d = draftRef.current;
    if (!d) return;
    const s = JSON.stringify(d);
    const h = histRef.current;
    if (h[h.length - 1] === s) return;
    h.push(s);
    if (h.length > 60) h.shift();
    lastPushRef.current = Date.now();
  };

  /** 编辑器子组件都是原地改草稿再调 onChange()：这里换一个新对象身份，
   * 让预览 effect 感知到变化重推草稿。 */
  const onChange = useCallback(() => {
    const d = draftRef.current;
    const c = cfg;
    if (!d || !c) return;
    setDraft({ ...d });
    const isDirty = JSON.stringify(d) !== JSON.stringify(c);
    setDirty(isDirty);
    setMsg(isDirty ? { text: "校验中…", kind: "" } : { text: "", kind: "" });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const rep = await api.layoutCheckDraft(d);
        setCheck(rep);
        if (rep.errors?.length) {
          setMsg({ text: `✗ ${rep.errors.join("；")}`, kind: "bad" });
        } else {
          setMsg(isDirty
            ? { text: rep.warnings?.length ? `可保存（${rep.warnings.length} 条提醒）` : "可保存", kind: "warn" }
            : { text: "没有改动", kind: "" });
        }
      } catch { /* 校验失败不打断编辑 */ }
    }, 350);
  }, [cfg]);

  const undoEdit = useCallback(() => {
    const snap = histRef.current.pop();
    const cur = draftRef.current;
    if (!snap || !cur) {
      addToast({ title: "没有可撤销的操作", color: "default" });
      return;
    }
    const d = JSON.parse(snap) as OverlayConfig;
    draftRef.current = d;
    setSelected(null);
    onChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  // 画布 iframe：/?preview=1，等它 postMessage 回报各部件的真实几何
  const pushPreview = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "hwobs-preview", layout: draft }, "*");
  }, [draft]);
  useEffect(() => { pushPreview(); }, [pushPreview]);

  // monitor 就绪后会回报 hwobs-ready（iframe 的 load 事件被在线字体拖住时
  // onLoad 补推来不及，必须等这个握手再推，草稿才不会丢在 about:blank 里）
  const pushRef = useRef(pushPreview);
  pushRef.current = pushPreview;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { type?: string; rects?: (Rect | null)[]; prompt?: Rect | null };
      if (d?.type === "hwobs-ready") { pushRef.current(); return; }
      if (d?.type === "hwobs-rects" && Array.isArray(d.rects)) {
        setRects(d.rects);
        setPromptRect(d.prompt ?? null);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // 缩放：默认"适应"= 整幅画布都在视口里（避开右侧浮动面板）；点过 +/- 固定倍率可滚动。
  // 盯容器本身（面板展开/收起时 window resize 捕捉不到）；拖动中不换比例。
  useEffect(() => {
    if (zoom !== null) return;
    const fit = () => {
      const el = wrapRef.current;
      const cwid = draftRef.current?.canvas.w, chid = draftRef.current?.canvas.h;
      if (!el || !cwid || !chid || dragRef.current) return;
      const cw = el.clientWidth - (panelOpen ? PANEL_W : 0) - 48;
      const ch = el.clientHeight - 48;
      if (cw > 0 && ch > 0) {
        setPvScale(Math.max(0.05, Math.min(1, Math.min(cw / cwid, ch / chid))));
      }
    };
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [draft?.canvas.w, draft?.canvas.h, zoom, panelOpen]);

  useEffect(() => {
    if (zoom !== null) setPvScale(Math.max(0.15, Math.min(2, zoom)));
  }, [zoom]);

  const save = useCallback(async () => {
    const d = draftRef.current;
    if (!d) return;
    const rep = await api.saveConfig(d);
    if (!rep.saved) {
      setMsg({ text: `✗ 保存失败：${(rep.errors || []).join("；")}`, kind: "bad" });
      addToast({ title: "保存失败", description: (rep.errors || []).join("；"), color: "danger" });
      return;
    }
    setCfg(clone(d));
    setDirty(false);
    setPvKey(k => k + 1);
    setMsg({ text: "✓ 已保存", kind: "ok" });
    addToast({ title: "已保存", description: "OBS 里没变化就点「刷新缓存」", color: "success" });
    try {
      setCheck(await api.layoutCheck());
      shared.refreshAll();
    } catch { /* 静默 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  const undoSaved = async () => {
    const rep = await api.rollback();
    if (!rep.restored) {
      setMsg({ text: `✗ ${(rep.errors || []).join("；")}`, kind: "bad" });
      return;
    }
    await loadConfig();
    setPvKey(k => k + 1);
    setMsg({ text: "✓ 已还原到上一版", kind: "ok" });
    addToast({ title: "已还原到上一版", color: "success" });
  };

  /** 在空位落一个新部件并选中它 */
  const addFree = (type: string) => {
    const d = draftRef.current;
    if (!d || !metrics) return;
    pushHistory();
    const first = outPaths(metrics)[0];
    const n = d.widgets.length;
    const base: Record<string, unknown> = { x: 48 + (n % 4) * 32, y: 40 + (n % 4) * 28 };
    if (type === "stat") Object.assign(base, { type: "stat", metric: first, size: 26, w: 300 });
    if (type === "progress") Object.assign(base, { type: "progress", metric: first, w: 260, height: 10 });
    if (type === "html") Object.assign(base, {
      type: "html",
      html: '<div style="font-size:22px;font-weight:700">CPU {cpu.usage} · {cpu.temp}</div>',
      w: 340, h: 64,
    });
    if (type === "cards") Object.assign(base, {
      type: "cards", cols: 2, gap: 24,
      items: [{ key: `card${Date.now() % 10000}`, label: "卡片", bar: first,
        value: { metrics: [first] }, sub: { sep: " · ", metrics: [] } }],
    });
    if (type === "chips") Object.assign(base, { type: "chips", items: [] });
    if (type === "text") Object.assign(base, { type: "text", text: "{cpu.usage}%", size: 19 });
    d.widgets.push(base as unknown as Widget);
    setDraft({ ...d });
    setSelected(n);
    onChange();
  };

  const removeWidget = (i: number) => {
    const d = draftRef.current;
    if (!d) return;
    pushHistory();
    d.widgets.splice(i, 1);
    setDraft({ ...d });
    setSelected(null);
    onChange();
  };

  /** 复制部件（连带内部 items 的 key 换新），错位落下并选中 */
  const duplicateWidget = (i: number) => {
    const d = draftRef.current;
    if (!d || !d.widgets[i]) return;
    pushHistory();
    const copy = JSON.parse(JSON.stringify(d.widgets[i])) as Widget & FreePos;
    copy.x = (copy.x ?? 0) + 24;
    copy.y = (copy.y ?? 0) + 16;
    if (copy.type === "cards") {
      const stamp = Date.now() % 10000;
      copy.items = copy.items.map((c, k) => ({ ...c, key: `${c.key || "card"}_${stamp}_${k}` }));
    }
    d.widgets.push(copy);
    setDraft({ ...d });
    setSelected(d.widgets.length - 1);
    onChange();
  };

  const nudge = (i: number, dx: number, dy: number) => {
    const d = draftRef.current;
    const w = d?.widgets[i] as FreePos | undefined;
    if (!d || !w) return;
    // 连按方向键只记一次历史（半秒内的连续微调合成一步撤销）
    if (Date.now() - lastPushRef.current > 500) pushHistory();
    w.x = Math.max(0, Math.min((w.x ?? 0) + dx, d.canvas.w - 24));
    w.y = Math.max(0, Math.min((w.y ?? 0) + dy, d.canvas.h - 8));
    setDraft({ ...d });
    onChange();
  };

  // 快捷键：Ctrl+S 保存 · Ctrl+Z 撤销 · Ctrl+D 复制 · Delete 删除 · 方向键微调
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "s") { e.preventDefault(); save(); return; }
      if (ctrl && k === "z" && !typing) { e.preventDefault(); undoEdit(); return; }
      if (e.key === "Escape" && !typing) { setSelected(null); return; }
      if (selected == null) return;
      if (ctrl && k === "d" && !typing) { e.preventDefault(); duplicateWidget(selected); return; }
      if (e.key === "Delete" && !typing) { removeWidget(selected); return; }
      if (!typing && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudge(selected,
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
          e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, save, undoEdit]);

  const onDown = (e: React.MouseEvent, i: number, mode: "move" | "resize") => {
    e.stopPropagation();
    if (!draft) return;
    setSelected(i);
    const w = draft.widgets[i] as FreePos;
    const r = rects[i];
    dragRef.current = {
      i, mode,
      sx: e.clientX, sy: e.clientY,
      ox: w.x ?? r?.x ?? 0, oy: w.y ?? r?.y ?? 0,
      ow: w.w ?? r?.w ?? 300, oh: r?.h ?? 24,
      stretch: stretchable(draft.widgets[i].type) && w.w === undefined,
    };
  };

  // 拖动：iframe 宿主节点 + 手柄盒都直改 DOM（不重渲染），松手才进草稿。
  // 拖近画布边缘或其他部件的左/右/中（上/下/中）时自动吸附，参考线直改 DOM。
  useEffect(() => {
    const snapAxis = (cands: number[], targets: number[]) => {
      let best: { dd: number; t: number; adj: number } | null = null;
      for (const c of cands) for (const t of targets) {
        const dd = Math.abs(c - t);
        if (dd <= SNAP_PX && (!best || dd < best.dd)) best = { dd, t, adj: t - c };
      }
      return best;
    };
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      const cur = draftRef.current;
      if (!d || !cur) return;
      const scale = scaleRef.current;
      const dx = Math.round((e.clientX - d.sx) / scale);
      const dy = Math.round((e.clientY - d.sy) / scale);
      const W = cur.canvas.w, H = cur.canvas.h;
      const t = cur.widgets[d.i]?.type;
      let nx = Math.max(0, Math.min(d.ox + dx, W - 24));
      let ny = Math.max(0, Math.min(d.oy + dy, H - 8));
      const nw = Math.max(40, Math.min(d.ow + dx, W - nx));
      const nh = Math.max(12, Math.min(d.oh + dy, H - ny));
      let snX: number | null = null;
      let snY: number | null = null;
      if (snapRef.current) {
        const xs = [0, W], ys = [0, H];
        const rs = rectsRef.current;
        for (let j = 0; j < cur.widgets.length; j++) {
          if (j === d.i) continue;
          const r = rs[j];
          if (!r) continue;
          xs.push(r.x, r.x + r.w, Math.round(r.x + r.w / 2));
          ys.push(r.y, r.y + r.h, Math.round(r.y + r.h / 2));
        }
        // 顶部装饰命令行也是磁铁：部件好对齐它的首部（左缘）和基线
        const pr = promptRef.current;
        if (pr) {
          xs.push(pr.x, pr.x + pr.w, Math.round(pr.x + pr.w / 2));
          ys.push(pr.y, pr.y + pr.h, Math.round(pr.y + pr.h / 2));
        }
        const bw = d.mode === "move" ? (d.stretch ? W - nx : d.ow) : nw;
        const bh = d.mode === "move" ? d.oh : (t && heightEditable(t) ? nh : d.oh);
        // 通栏部件右边缘恒等于画布右缘，当吸附候选会永远零差值匹配（参考线常驻噪音）
        const xCands = d.mode === "move" && d.stretch
          ? [nx, Math.round(nx + bw / 2)]
          : [nx, nx + bw, Math.round(nx + bw / 2)];
        const bx = snapAxis(xCands, xs);
        if (bx) { nx = Math.max(0, Math.min(nx + bx.adj, W - 24)); snX = bx.t; }
        const by = snapAxis([ny, ny + bh, Math.round(ny + bh / 2)], ys);
        if (by) { ny = Math.max(0, Math.min(ny + by.adj, H - 8)); snY = by.t; }
      }
      // 网格兜底：部件对齐没命中时，位置就近吸附到网格线（网格开且吸附开才生效）
      if (gridRef.current && snapRef.current) {
        const gx = Math.round(nx / GRID_PX) * GRID_PX;
        const gy = Math.round(ny / GRID_PX) * GRID_PX;
        if (snX == null && gx !== nx) { nx = Math.max(0, Math.min(gx, W - 24)); }
        if (snY == null && gy !== ny) { ny = Math.max(0, Math.min(gy, H - 8)); }
      }
      d.nx = nx; d.ny = ny; d.nw = nw; d.nh = nh;
      const host = frameRef.current?.contentDocument?.querySelector(`[data-wi="${d.i}"]`) as HTMLElement | null;
      if (host) {
        host.style.left = nx + "px";
        host.style.top = ny + "px";
        if (d.mode === "resize") {
          host.style.right = "";
          host.style.width = nw + "px";
          if (t && heightEditable(t)) host.style.height = nh + "px";
        }
      }
      const node = boxRefs.current.get(d.i);
      if (node) {
        node.style.left = nx * scale + "px";
        node.style.top = ny * scale + "px";
        node.style.width = (d.mode === "resize" || d.stretch ? (d.mode === "resize" ? nw : W - nx) : d.ow) * scale + "px";
        if (d.mode === "resize" && t && heightEditable(t)) node.style.height = nh * scale + "px";
      }
      const vg = vgRef.current, hg = hgRef.current;
      if (vg) {
        if (snX != null) { vg.style.display = "block"; vg.style.left = snX * scale + "px"; }
        else vg.style.display = "none";
      }
      if (hg) {
        if (snY != null) { hg.style.display = "block"; hg.style.top = snY * scale + "px"; }
        else hg.style.display = "none";
      }
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (vgRef.current) vgRef.current.style.display = "none";
      if (hgRef.current) hgRef.current.style.display = "none";
      const cur = draftRef.current;
      if (!d || !cur || d.nx === undefined) return;
      pushHistory();
      const w = cur.widgets[d.i] as FreePos | undefined;
      if (!w) return;
      if (d.mode === "move") {
        w.x = d.nx;
        w.y = d.ny;
      } else {
        w.w = d.nw;
        if (cur.widgets[d.i].type === "html") (w as HtmlWidget).h = d.nh;
        if (cur.widgets[d.i].type === "progress") (w as ProgressWidget).height = d.nh;
      }
      setDraft({ ...cur });
      onChange();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  const msgColor = msg.kind === "ok" ? "text-primary"
    : msg.kind === "bad" ? "text-danger"
      : msg.kind === "warn" ? "text-warning" : "text-color-desc";

  if (!draft || !metrics) {
    return (
      <main className="fixed inset-y-0 right-0 left-72 z-10 flex items-center justify-center bg-background">
        <span className="text-sm text-default-500">载入中…</span>
      </main>
    );
  }

  const scalePct = Math.round(pvScale * 100);
  const sel = selected != null && draft.widgets[selected] ? draft.widgets[selected] : null;

  return (
    <main className="fixed inset-y-0 right-0 left-72 z-10 flex flex-col bg-background">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-divider px-5 py-2.5">
        <h1 className="mr-2 text-lg font-bold text-white">自由排版</h1>
        {([["stat", "大数字"], ["progress", "进度条"], ["html", "自定义 HTML"],
           ["cards", "指标卡"], ["chips", "小指标行"], ["text", "文本"]] as const).map(([t, label]) => (
          <Button key={t} size="sm" variant="flat" className="bg-[#27272a]"
            onPress={() => addFree(t)}>+ {label}</Button>
        ))}
        <span className="flex-1" />
        <Button size="sm" variant="flat" className="h-8 w-8 min-w-0 bg-[#27272a] px-0"
          title="缩小" onPress={() => setZoom(Math.max(0.15, Math.round((pvScale - 0.1) * 100) / 100))}>−</Button>
        <span className="min-w-12 text-center font-poppins text-sm">{scalePct}%</span>
        <Button size="sm" variant="flat" className="h-8 w-8 min-w-0 bg-[#27272a] px-0"
          title="放大" onPress={() => setZoom(Math.min(2, Math.round((pvScale + 0.1) * 100) / 100))}>＋</Button>
        <Button size="sm" variant="flat" className="bg-[#27272a]"
          title="整幅画布缩放进视口" onPress={() => setZoom(null)}>适应</Button>
        <Button size="sm" variant="flat" color={snapOn ? "primary" : "default"}
          title="拖近画布边缘或其他部件的边缘/中线时自动对齐"
          onPress={() => setSnapOn(s => !s)}>吸附{snapOn ? "开" : "关"}</Button>
        <Button size="sm" variant="flat" color={gridOn ? "primary" : "default"}
          title={`显示 ${GRID_PX}px 网格，拖动就近对齐到网格线`}
          onPress={() => setGridOn(g => !g)}>网格{gridOn ? "开" : "关"}</Button>
        <Button size="sm" variant="flat" className="h-8 w-8 min-w-0 bg-[#27272a] px-0"
          title={panelOpen ? "收起右侧参数面板，画布占满整行" : "展开右侧参数面板"}
          onPress={() => setPanelOpen(o => {
            localStorage.setItem(PANEL_KEY, o ? "0" : "1");
            return !o;
          })}>
          {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </Button>
      </div>

      {/* 画布工作区 */}
      <div className="relative flex-1 overflow-hidden bg-[#0e0f12]">
        <div ref={wrapRef}
          className="absolute inset-0 select-none overflow-auto p-6"
          style={{ paddingRight: panelOpen ? PANEL_W + 24 : 24 }}
          onMouseDown={() => setSelected(null)}>
          <div className="flex min-h-full min-w-full items-center justify-center">
            <div className="relative"
              style={{ width: Math.ceil(draft.canvas.w * pvScale), height: Math.ceil(draft.canvas.h * pvScale) }}>
              {gridOn && (
                <div className="pointer-events-none absolute inset-0 opacity-40"
                  style={{
                    backgroundImage:
                      "linear-gradient(#26262b 1px, transparent 1px), linear-gradient(90deg, #26262b 1px, transparent 1px)",
                    backgroundSize: `${GRID_PX * pvScale}px ${GRID_PX * pvScale}px`,
                  }} />
              )}
              <iframe
                key={pvKey}
                ref={frameRef}
                title="叠加层画布" scrolling="no"
                src={`${BACKEND}/?preview=1&t=${pvKey}`}
                onLoad={pushPreview}
                className="pointer-events-none absolute left-0 top-0 border-0"
                style={{
                  width: draft.canvas.w, height: draft.canvas.h,
                  transform: `scale(${pvScale})`, transformOrigin: "0 0",
                }}
              />
              {/* 对齐参考线：拖动吸附时显示，直改 DOM 不走 React */}
              <div ref={vgRef} className="pointer-events-none absolute inset-y-0 z-40 hidden w-px bg-primary" />
              <div ref={hgRef} className="pointer-events-none absolute inset-x-0 z-40 hidden h-px bg-primary" />
              {draft.widgets.map((w, i) => {
                const r = rects[i];
                if (!r) return null;
                const isSel = selected === i;
                const stretch = stretchable(w.type) && (w as FreePos).w === undefined;
                return (
                  <div key={i}
                    ref={node => {
                      if (node) boxRefs.current.set(i, node);
                      else boxRefs.current.delete(i);
                    }}
                    className={`absolute cursor-move border transition-colors ${
                      isSel
                        ? "border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(56,132,255,0.5)]"
                        : "border-white/25 hover:border-white/60"}`}
                    style={{
                      left: r.x * pvScale, top: r.y * pvScale,
                      width: Math.max(r.w * pvScale, 48),
                      height: Math.max(r.h * pvScale, 22),
                      zIndex: isSel ? 30 : i + 1,
                    }}
                    onMouseDown={e => onDown(e, i, "move")}>
                    {isSel && (
                      <span className="pointer-events-none absolute left-0 top-0 -translate-y-full truncate bg-primary px-1.5 py-0.5 text-[11px] leading-4 text-white">
                        {WIDGET_LABEL[w.type] ?? w.type}{stretch && " · 通栏"}
                      </span>
                    )}
                    <div
                      className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize border-b-2 border-r-2 border-current opacity-60 hover:opacity-100"
                      style={{ borderColor: isSel ? "#3884ff" : "#a0a0a8" }}
                      title="拖拽调整大小"
                      onMouseDown={e => onDown(e, i, "resize")} />
                  </div>
                );
              })}
              {draft.widgets.length > 0 && !rects.some(Boolean) && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm text-default-500">正在连接画布…</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧浮动面板：选中部件 → 参数；没选中 → 画布设置。可整体收起给画布让位 */}
        {panelOpen && (
        <div className="absolute right-4 top-4 bottom-4 w-[420px] overflow-y-auto rounded-xl border border-white/[0.06] bg-[#1a1a1d]/95 p-4 shadow-xl backdrop-blur">
          {!metrics.length && (
            <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              还没有注册任何指标 —— 去「自定义指标」注册。
            </div>
          )}
          {sel && selected != null ? (() => {
            const w = draft.widgets[selected]!;
            const pos = w as FreePos;
            const numInput = (label: string, key: "x" | "y" | "w" | "h", val?: number) => (
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{label}</FieldLabel>
                <Input type="number" size="sm" variant="flat" className="w-20 font-poppins"
                  value={String(val ?? 0)}
                  onValueChange={v => {
                    (pos as unknown as Record<string, number>)[key] = +v || 0;
                    setDraft({ ...draft });
                    onChange();
                  }} />
              </div>
            );
            const showW = pos.w !== undefined || w.type === "html" || w.type === "progress" || w.type === "stat";
            return (
              <div className="flex flex-col gap-3">
                <SubTitle>{WIDGET_LABEL[w.type] ?? w.type}</SubTitle>
                <div className="flex flex-wrap items-end gap-3">
                  {numInput("X", "x", pos.x)}
                  {numInput("Y", "y", pos.y)}
                  {showW && numInput("宽", "w", pos.w)}
                  {w.type === "html" && numInput("高", "h", pos.h)}
                </div>
                {stretchable(w.type) && pos.w !== undefined && (
                  <Button size="sm" variant="flat" className="bg-[#27272a]"
                    title="清掉固定宽度，从 X 拉到画布右缘"
                    onPress={() => {
                      delete pos.w;
                      setDraft({ ...draft });
                      onChange();
                    }}>拉通到右缘</Button>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="flat" className="bg-[#27272a]"
                    title="Ctrl+D：复制这个部件并错位落下"
                    onPress={() => duplicateWidget(selected)}>复制</Button>
                  <Button size="sm" variant="flat" className="bg-[#27272a]" title="后加的部件盖在前面之上"
                    onPress={() => {
                      pushHistory();
                      const [m] = draft.widgets.splice(selected, 1);
                      draft.widgets.push(m);
                      setSelected(draft.widgets.length - 1);
                      setDraft({ ...draft });
                      onChange();
                    }}>置顶</Button>
                  <Button size="sm" variant="flat" className="bg-[#27272a]" title="与上面一个部件交换层级"
                    onPress={() => {
                      if (selected > 0) {
                        pushHistory();
                        [draft.widgets[selected - 1], draft.widgets[selected]] =
                          [draft.widgets[selected], draft.widgets[selected - 1]];
                        setSelected(selected - 1);
                        setDraft({ ...draft });
                        onChange();
                      }
                    }}>上移一层</Button>
                  <Button size="sm" variant="flat" className="bg-[#27272a]" title="与下面一个部件交换层级"
                    onPress={() => {
                      if (selected < draft.widgets.length - 1) {
                        pushHistory();
                        [draft.widgets[selected + 1], draft.widgets[selected]] =
                          [draft.widgets[selected], draft.widgets[selected + 1]];
                        setSelected(selected + 1);
                        setDraft({ ...draft });
                        onChange();
                      }
                    }}>下移一层</Button>
                  <Button size="sm" variant="flat" className="bg-danger/20 text-danger-400"
                    title="Delete" onPress={() => removeWidget(selected)}>删除</Button>
                </div>
                <div className="border-t border-white/[0.06] pt-3">
                  {w.type === "stat" && <StatEditor w={w as StatWidget} metrics={metrics} onChange={onChange} compact />}
                  {w.type === "progress" && <ProgressEditor w={w as ProgressWidget} metrics={metrics} onChange={onChange} compact />}
                  {w.type === "html" && <HtmlEditor w={w as HtmlWidget} onChange={onChange} />}
                  {w.type === "cards" && <CardsEditor w={w as CardsWidget} metrics={metrics} onChange={onChange} compact />}
                  {w.type === "chips" && <ChipsEditor w={w as ChipsWidget} metrics={metrics} onChange={onChange} />}
                  {w.type === "text" && <TextEditor w={w as TextWidget} metrics={metrics} onChange={onChange} compact />}
                </div>
              </div>
            );
          })() : (
            <div className="flex flex-col gap-3">
              <SubTitle>画布设置</SubTitle>
              <Hint className="text-xs">没选中部件时这里是画布设置；点画布上的部件改它的参数。</Hint>
              <CanvasFields draft={draft} onChange={onChange} />
              <div className="border-t border-white/[0.06] pt-3">
                <PromptBar draft={draft} onChange={onChange} compact />
              </div>
              <div className="border-t border-white/[0.06] pt-3">
                <SubTitle>校验</SubTitle>
                {check && !check.errors.length && !check.warnings.length && (
                  <Hint className="text-xs"><span className="text-success">✓ 版式无错误、无提醒</span></Hint>
                )}
                {check?.errors.map((e, i) => (
                  <div key={i} className="text-xs text-danger">✗ {e}</div>
                ))}
                {check?.warnings.map((w, i) => (
                  <div key={i} className="text-xs text-warning">▲ {w}</div>
                ))}
              </div>
              <div className="border-t border-white/[0.06] pt-3">
                <SubTitle>快捷键</SubTitle>
                <Hint className="text-xs">
                  拖动挪位置 · 右下角改大小<br />
                  方向键微调（Shift = 10px）<br />
                  Ctrl+Z 撤销 · Ctrl+D 复制部件<br />
                  Delete 删除 · Esc 取消选中 · Ctrl+S 保存
                </Hint>
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* 吸底保存条 */}
      <div className="flex items-center gap-3 border-t border-divider px-5 py-2.5">
        <Button color="primary" size="lg" className="px-7" isDisabled={!dirty} onPress={save}>保存</Button>
        <Button size="lg" variant="flat" className="bg-[#27272a]" onPress={undoEdit}
          title="Ctrl+Z：回退上一步拖动/增删">撤销</Button>
        <Button size="lg" variant="flat" className="bg-[#27272a]" onPress={undoSaved}>还原上一版</Button>
        {dirty && <span className="text-sm text-warning">● 有未保存的改动</span>}
        <span className="flex-1" />
        <span className={`text-sm ${msgColor}`}>{msg.text}</span>
      </div>
    </main>
  );
}
