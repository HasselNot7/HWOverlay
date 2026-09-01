import { Input, TextField, toast } from "@heroui/react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, clone, outPaths } from "../api";
import type {
  CardsWidget, ChipsWidget, FreePos, GaugeWidget, HtmlWidget, LayoutPreset, OverlayConfig,
  ProgressWidget, StatWidget, TextWidget, Widget,
} from "../types";
import type { Shared } from "../App";
import { Btn, CARD_CLS, FieldLabel, Hint, SubTitle} from "../ui";
import { clearDraft, loadDraft, saveDraft } from "../draftStore";
import {
  CanvasFields, CardsEditor, ChipsEditor, GaugeEditor, HtmlEditor, PromptBar,
  ProgressEditor, StatEditor, TemplatePicker, TextEditor,
} from "./editors";

/** 全屏自由排版工作台：画布（真实渲染的 monitor.html 预览 iframe）铺满主体，
 * 工具栏吸顶、参数面板浮动右侧、保存条吸底。
 * 手柄盒叠在 iframe 上方，几何由 monitor 每次 build 后 postMessage 回报
 * （hwobs-rects）—— 所见即所得。拖动过程直改宿主节点 style 跟手，松手才进草稿。
 * 快捷键：Ctrl+Z 撤销（结构操作）· Ctrl+D 复制 · 方向键微调(Shift=10px) ·
 * Ctrl+S 保存 · Delete 删除。 */

const WIDGET_LABEL: Record<string, string> = {
  cards: "指标卡片", chips: "小指标行", text: "自定义文字",
  stat: "大数字", progress: "进度条", html: "自定义 HTML", gauge: "圆环仪表",
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
    case "gauge": return (w.size ?? 120) + (w.label ? 20 : 0);
  }
  return 40;
}

const stretchable = (t: string) => t === "cards" || t === "chips" || t === "text";
const heightEditable = (t: string) => t === "html" || t === "progress";
/** 吸附判定距离（画布像素）：拖动时边缘靠得比这近就吸上去 */
const SNAP_PX = 8;
/** 自适应网格：基准步长 = 画布宽按约 50 格取整到 1/2/4/5 系列；
 * 再按缩放沿该系列换档，屏幕上每格始终落在 16~96 像素的舒适区。 */
const GRID_TARGET_COLS = 50;
const GRID_MIN_CANVAS = 4;   // 画布像素下限（极小画布也别切太碎）
const GRID_MAX_CANVAS = 400; // 画布像素上限（超大画布也别懒到只剩几根线）
const GRID_MIN_SCREEN = 16;  // 屏幕像素下限：比这密就换更大档位
const GRID_MAX_SCREEN = 96;  // 屏幕像素上限：比这疏就换更小档位

function niceStep(x: number): number {
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  // 档位 1/2/4/5：按对数中点就近取整（sqrt 边界），40 这类常用间距能原样保留
  const n = f < 1.42 ? 1 : f < 2.83 ? 2 : f < 4.48 ? 4 : f < 7.08 ? 5 : 10;
  return n * 10 ** exp;
}
const NICE_DIGITS = [1, 2, 4, 5] as const;
const NICE_DIGITS_UP = [...NICE_DIGITS].reverse();

function niceAbove(s: number): number {
  const e0 = Math.floor(Math.log10(s));
  for (let e = e0; e <= e0 + 2; e++)
    for (const d of NICE_DIGITS) {
      const v = d * 10 ** e;
      if (v > s * 1.001) return v;
    }
  return s * 10;
}

function niceBelow(s: number): number {
  const e0 = Math.ceil(Math.log10(s));
  for (let e = e0; e >= e0 - 2; e--)
    for (const d of NICE_DIGITS_UP) {
      const v = d * 10 ** e;
      if (v < s * 0.999) return v;
    }
  return s / 10;
}

/** 画布像素步长：先按宽度取基准档，再按当前缩放换档 */
function gridStepFor(canvasW: number, scale: number): number {
  let s = niceStep(Math.min(GRID_MAX_CANVAS, Math.max(GRID_MIN_CANVAS, canvasW / GRID_TARGET_COLS)));
  for (let g = 0; g < 8; g++) {
    if (s * scale < GRID_MIN_SCREEN && s < canvasW) s = niceAbove(s);
    else if (s * scale > GRID_MAX_SCREEN && s > 1) s = niceBelow(s);
    else break;
  }
  return s;
}
/** 右侧浮动面板宽度（px）：适配缩放时给画布留出的空间 */
const PANEL_W = 440;
/** 面板收起记忆的 localStorage 键 */
const PANEL_KEY = "hwobs.freePanel";

/** 草稿转自由画布：mode=free + 给缺坐标的部件排初始位置（margin_top 折算进 y）。
 * 装饰命令行也落成显式 x/y（默认落在内边距处），从此和部件一样可拖。 */
function toFree(d: OverlayConfig) {
  d.canvas.mode = "free";
  const pad = d.canvas.padding || [12, 24];
  let y = pad[0];
  if (d.prompt) {
    y += Math.round((d.prompt.size ?? 19) * 1.2) + 10;
    if (d.prompt.x === undefined) d.prompt.x = pad[1];
    if (d.prompt.y === undefined) d.prompt.y = pad[0];
  }
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
  target: "widget" | "prompt";
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
  /** 自适应网格的当前步长（画布像素），随画布尺寸与缩放重算 */
  const [gridStep, setGridStep] = useState(50);
  /** 右侧参数面板：收起后画布吃满整行（记住上次的选择） */
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem(PANEL_KEY) !== "0");
  const [selected, setSelected] = useState<number | null>(null);
  /** 装饰命令行的选中态（与部件选中互斥，它不在 widgets 里） */
  const [selPrompt, setSelPrompt] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [rects, setRects] = useState<(Rect | null)[]>([]);
  /** 顶部装饰命令行的真实几何：可拖可吸，和部件互相当磁铁 */
  const [promptRect, setPromptRect] = useState<Rect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRefs = useRef(new Map<number, HTMLDivElement>());
  const promptBoxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  /** 拖动期间收到的几何补报：先存着，松手后补应用 */
  const pendingRectsRef = useRef<{ rects: (Rect | null)[]; prompt: Rect | null } | null>(null);
  const scaleRef = useRef(pvScale);
  const draftRef = useRef<OverlayConfig | null>(null);
  const rectsRef = useRef<(Rect | null)[]>([]);
  const promptRef = useRef<Rect | null>(null);
  const snapRef = useRef(true);
  const gridRef = useRef(false);
  const gridStepRef = useRef(50);
  const vgRef = useRef<HTMLDivElement>(null);
  const hgRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const histRef = useRef<string[]>([]);
  const lastPushRef = useRef(0);
  /** 中键拖拽平移画布（抓手）：记录起点与初始 scroll */
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  scaleRef.current = pvScale;
  draftRef.current = draft;
  rectsRef.current = rects;
  promptRef.current = promptRect;
  snapRef.current = snapOn;
  gridRef.current = gridOn;
  gridStepRef.current = gridStep;

  const loadConfig = useCallback(async () => {
    const c = await api.overlay();
    // 上次没保存的草稿还在（切过页面/刷新过浏览器）就接着用
    const stored = loadDraft("free");
    let d = clone(c);
    let restored = false;
    if (stored) {
      try {
        const s = JSON.parse(stored) as OverlayConfig;
        if (JSON.stringify(s) !== JSON.stringify(c)) { d = s; restored = true; }
        else clearDraft("free");
      } catch { clearDraft("free"); }
    }
    const wasFlow = d.canvas.mode !== "free";
    toFree(d);
    setCfg(c);
    setDraft(d);
    setSelected(null);
    setSelPrompt(false);
    setRects([]);
    setPromptRect(null);
    histRef.current = [];
    const isDirty = JSON.stringify(d) !== JSON.stringify(c);
    setDirty(isDirty);
    setMsg(restored
      ? { text: "已恢复上次没保存的排版（不要就点「放弃改动」）", kind: "warn" }
      : isDirty
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
    // 有改动就暂存：切页面、刷新浏览器都还在；回到和已保存一致就清掉
    if (isDirty) saveDraft("free", d);
    else clearDraft("free");
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
      toast("没有可撤销的操作", { timeout: 2000 });
      return;
    }
    const d = JSON.parse(snap) as OverlayConfig;
    draftRef.current = d;
    setSelected(null);
    setSelPrompt(false);
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
        // 拖动中途来的补报（别处实时数据变了）先挂起：直接 setRects 会让
        // React 把手柄盒拽回旧位置，盖掉正在跟手的吸附位。松手后补应用。
        if (dragRef.current) { pendingRectsRef.current = { rects: d.rects, prompt: d.prompt ?? null }; return; }
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

  // 网格步长：画布尺寸定基准档（约 50 列），缩放再换档，屏幕上永远看得清、吸得准
  useEffect(() => {
    const W = draft?.canvas.w, H = draft?.canvas.h;
    if (!W || !H) return;
    setGridStep(gridStepFor(W, pvScale));
  }, [draft?.canvas.w, draft?.canvas.h, pvScale]);

  const save = useCallback(async () => {
    const d = draftRef.current;
    if (!d) return;
    const rep = await api.saveConfig(d);
    if (!rep.saved) {
      setMsg({ text: `✗ 保存失败：${(rep.errors || []).join("；")}`, kind: "bad" });
      toast.danger("保存失败", { description: (rep.errors || []).join("；"), timeout: 6000 });
      return;
    }
    setCfg(clone(d));
    setDirty(false);
    clearDraft("free");
    setPvKey(k => k + 1);
    setMsg({ text: "✓ 已保存", kind: "ok" });
    toast.success("已保存", { description: "OBS 里没变化就点「刷新缓存」", timeout: 2000 });
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
    clearDraft("free");
    await loadConfig();
    setPvKey(k => k + 1);
    setMsg({ text: "✓ 已还原到上一版", kind: "ok" });
    toast.success("已还原到上一版", { timeout: 2000 });
  };

  /** 丢掉没保存的草稿，回到已保存的版式 */
  const discardDraft = useCallback(async () => {
    clearDraft("free");
    await loadConfig();
    toast("已放弃未保存的改动", { timeout: 2000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConfig]);

  /** 用一套模板覆盖草稿（流式模板自动换算成自由坐标），顺带注册默认指标集 */
  const applyPreset = async (p: LayoutPreset) => {
    const d = draftRef.current;
    if (!d) return;
    try {
      const seeded = await api.seedPresetMetrics();
      const nd = clone(p.config);
      toFree(nd);
      pushHistory();
      // onChange 从 draftRef.current 取草稿做保存/校验 —— 换新对象必须先同步 ref，
      // 否则它会把旧草稿又写回去（同帧的 setDraft 还没重渲染）
      draftRef.current = nd;
      setDraft(nd);
      setSelected(null);
      setSelPrompt(false);
      onChange();
      toast.success(`已载入模板：${p.name}`, {
        description: seeded.added ? `已顺带注册 ${seeded.added} 个默认指标` : undefined,
        timeout: 2000,
      });
    } catch (e) {
      toast.danger("加载模板失败", { description: String(e), timeout: 6000 });
    }
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
    if (type === "gauge") Object.assign(base, { type: "gauge", metric: first, size: 120, ring: 10 });
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

  /** 方向键微调装饰命令行（和部件同一套边界口径） */
  const nudgePrompt = (dx: number, dy: number) => {
    const d = draftRef.current;
    const p = d?.prompt;
    if (!d || !p) return;
    if (Date.now() - lastPushRef.current > 500) pushHistory();
    const pad = d.canvas.padding || [12, 24];
    p.x = Math.max(0, Math.min((p.x ?? pad[1]) + dx, d.canvas.w - 24));
    p.y = Math.max(0, Math.min((p.y ?? pad[0]) + dy, d.canvas.h - 8));
    setDraft({ ...d });
    onChange();
  };

  /** 删除装饰命令行（Delete 键也走这里） */
  const removePrompt = () => {
    const d = draftRef.current;
    if (!d || !d.prompt) return;
    pushHistory();
    delete d.prompt;
    setSelPrompt(false);
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
      if (e.key === "Escape" && !typing) { setSelected(null); setSelPrompt(false); return; }
      if (selected == null && !selPrompt) return;
      if (ctrl && k === "d" && !typing) {
        e.preventDefault();
        if (selected != null) duplicateWidget(selected);
        else toast("命令行装饰只有一个，不支持复制", { timeout: 2000 });
        return;
      }
      if (e.key === "Delete" && !typing) {
        if (selected != null) removeWidget(selected);
        else removePrompt();
        return;
      }
      if (!typing && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (selected != null) nudge(selected, dx, dy);
        else nudgePrompt(dx, dy);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selPrompt, save, undoEdit]);

  const onDown = (e: React.MouseEvent, i: number, mode: "move" | "resize") => {
    e.stopPropagation();
    if (!draft) return;
    setSelected(i);
    setSelPrompt(false);
    const w = draft.widgets[i] as FreePos;
    const r = rects[i];
    dragRef.current = {
      target: "widget", i, mode,
      sx: e.clientX, sy: e.clientY,
      ox: w.x ?? r?.x ?? 0, oy: w.y ?? r?.y ?? 0,
      ow: w.w ?? r?.w ?? 300, oh: r?.h ?? 24,
      stretch: stretchable(draft.widgets[i].type) && w.w === undefined,
    };
  };

  /** 装饰命令行：只能整体挪动（宽度由文字内容决定），吸附与部件同等待遇 */
  const onPromptDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const d = draft;
    if (!d?.prompt || !promptRect) return;
    setSelected(null);
    setSelPrompt(true);
    const pad = d.canvas.padding || [12, 24];
    dragRef.current = {
      target: "prompt", i: -1, mode: "move",
      sx: e.clientX, sy: e.clientY,
      ox: d.prompt.x ?? pad[1], oy: d.prompt.y ?? pad[0],
      ow: promptRect.w, oh: promptRect.h,
      stretch: false,
    };
  };

  // 中键平移：按住鼠标中键拖动画布（zoom 固定、画布溢出出滚动条时最有用）。
  const startPan = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    e.preventDefault();      // 压掉浏览器中键自动滚动
    e.stopPropagation();     // 别触发取消选中
    panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    el.style.cursor = "grabbing";
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const p = panRef.current, el = wrapRef.current;
      if (!p || !el) return;
      el.scrollLeft = p.sl - (e.clientX - p.x);
      el.scrollTop = p.st - (e.clientY - p.y);
    };
    const up = () => {
      if (!panRef.current) return;
      panRef.current = null;
      if (wrapRef.current) wrapRef.current.style.cursor = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  // 拖动：iframe 宿主节点 + 手柄盒都直改 DOM（不重渲染），松手才进草稿。
  // 拖近画布边缘或其他部件的左/右/中（上/下/中）时自动吸附，参考线直改 DOM。
  useEffect(() => {
    const snapAxis = (cands: number[], targets: number[]) => {
      let best: { dd: number; t: number; adj: number } | null = null;
      // 吸附半径按屏幕像素算（约 8 屏幕像素）：缩得很小时画布 8px 只有几屏幕
      // 像素，人手根本压不到；换算成屏幕像素后无论缩放多大都好吸。
      const radius = Math.max(SNAP_PX, Math.round(8 / (scaleRef.current || 1)));
      for (const c of cands) for (const t of targets) {
        const dd = Math.abs(c - t);
        if (dd <= radius && (!best || dd < best.dd)) best = { dd, t, adj: t - c };
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
      // 左上角：只有拖动才动；改大小把它钉死，不然组件会跟着手一起跑
      const fx = d.mode === "move" ? Math.max(0, Math.min(d.ox + dx, W - 24)) : d.ox;
      const fy = d.mode === "move" ? Math.max(0, Math.min(d.oy + dy, H - 8)) : d.oy;
      let nx = fx, ny = fy;
      let nw = Math.max(40, Math.min(d.ow + dx, W - fx));
      let nh = Math.max(12, Math.min(d.oh + dy, H - fy));
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
        // （拖它本人的时候它不能当磁铁，不然永远零差值把自己钉死）
        const pr = d.target === "widget" ? promptRef.current : null;
        if (pr) {
          xs.push(pr.x, pr.x + pr.w, Math.round(pr.x + pr.w / 2));
          ys.push(pr.y, pr.y + pr.h, Math.round(pr.y + pr.h / 2));
        }
        const bw = d.mode === "move" ? (d.stretch ? W - nx : d.ow) : nw;
        const bh = d.mode === "move" ? d.oh : (t && heightEditable(t) ? nh : d.oh);
        if (d.mode === "move") {
          // 通栏部件右边缘恒等于画布右缘，当吸附候选会永远零差值匹配（参考线常驻噪音）
          const xCands = d.stretch
            ? [nx, Math.round(nx + bw / 2)]
            : [nx, nx + bw, Math.round(nx + bw / 2)];
          const bx = snapAxis(xCands, xs);
          if (bx) { nx = Math.max(0, Math.min(nx + bx.adj, W - 24)); snX = bx.t; }
          const by = snapAxis([ny, ny + bh, Math.round(ny + bh / 2)], ys);
          if (by) { ny = Math.max(0, Math.min(ny + by.adj, H - 8)); snY = by.t; }
        } else {
          // 改大小：左上角不动，只让右缘/下缘去贴目标
          const bx = snapAxis([nx + bw], xs);
          if (bx) { nw = Math.max(40, Math.min(nw + bx.adj, W - fx)); snX = bx.t; }
          if (t && heightEditable(t)) {
            const by = snapAxis([ny + bh], ys);
            if (by) { nh = Math.max(12, Math.min(nh + by.adj, H - fy)); snY = by.t; }
          }
        }
      }
      // 网格兜底：位置就近吸附到网格线（步长是自适应的）。只认「网格」开关；若对象吸附已命中该轴则让位。
      if (gridRef.current && d.mode === "move") {
        const gs = gridStepRef.current;
        const gx = Math.round(nx / gs) * gs;
        const gy = Math.round(ny / gs) * gs;
        if (snX == null && gx !== nx) { nx = Math.max(0, Math.min(gx, W - 24)); }
        if (snY == null && gy !== ny) { ny = Math.max(0, Math.min(gy, H - 8)); }
      }
      d.nx = nx; d.ny = ny; d.nw = nw; d.nh = nh;
      const host = frameRef.current?.contentDocument?.querySelector(
        d.target === "prompt" ? "[data-prompt]" : `[data-wi="${d.i}"]`,
      ) as HTMLElement | null;
      if (host) {
        host.style.left = fx + "px";
        host.style.top = fy + "px";
        if (d.mode === "resize") {
          host.style.right = "";
          host.style.width = nw + "px";
          if (t && heightEditable(t)) host.style.height = nh + "px";
        }
      }
      const node = d.target === "prompt" ? promptBoxRef.current : boxRefs.current.get(d.i);
      if (node) {
        node.style.left = fx * scale + "px";
        node.style.top = fy * scale + "px";
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
      const flush = () => {
        const p = pendingRectsRef.current;
        if (p) {
          pendingRectsRef.current = null;
          setRects(p.rects);
          setPromptRect(p.prompt);
        }
      };
      // 没提交就走：重建不会发生，把拖动期间攒下的补报应用掉
      if (!d || !cur || d.nx === undefined) { flush(); return; }
      // 提交了就走：重建后必有新鲜补报，攒的旧数据直接作废
      pendingRectsRef.current = null;
      pushHistory();
      if (d.target === "prompt") {
        if (cur.prompt) { cur.prompt.x = d.nx; cur.prompt.y = d.ny; }
      } else {
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

  const msgColor = msg.kind === "ok" ? "text-accent"
    : msg.kind === "bad" ? "text-danger"
      : msg.kind === "warn" ? "text-warning" : "text-color-desc";

  if (!draft || !metrics) {
    return (
      <main className="fixed inset-y-0 right-0 left-72 z-10 flex items-center justify-center bg-background">
        <span className="text-sm text-muted">载入中…</span>
      </main>
    );
  }

  const scalePct = Math.round(pvScale * 100);
  const sel = selected != null && draft.widgets[selected] ? draft.widgets[selected] : null;

  return (
    <main className="fixed inset-y-0 right-0 left-72 z-10 flex flex-col bg-background">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
        <h1 className="mr-2 text-lg font-bold text-white">自由排版</h1>
        <Btn size="sm" variant="secondary" className="bg-[#27272a]" onPress={() => setTplOpen(true)}
          title="模板库：载入模板，或把当前草稿存为你的模板">模板</Btn>
        {([["stat", "大数字"], ["progress", "进度条"], ["gauge", "圆环仪表"], ["html", "自定义 HTML"],
           ["cards", "指标卡"], ["chips", "小指标行"], ["text", "文本"]] as const).map(([t, label]) => (
          <Btn key={t} size="sm" variant="secondary" className="bg-[#27272a]"
            onPress={() => addFree(t)}>+ {label}</Btn>
        ))}
        <span className="flex-1" />
        <Btn size="sm" variant="secondary" className="h-8 w-8 min-w-0 bg-[#27272a] px-0"
          title="缩小" onPress={() => setZoom(Math.max(0.15, Math.round((pvScale - 0.1) * 100) / 100))}>−</Btn>
        <span className="min-w-12 text-center font-poppins text-sm">{scalePct}%</span>
        <Btn size="sm" variant="secondary" className="h-8 w-8 min-w-0 bg-[#27272a] px-0"
          title="放大" onPress={() => setZoom(Math.min(2, Math.round((pvScale + 0.1) * 100) / 100))}>＋</Btn>
        <Btn size="sm" variant="secondary" className="bg-[#27272a]"
          title="整幅画布缩放进视口" onPress={() => setZoom(null)}>适应</Btn>
        <Btn size="sm" variant={snapOn ? "primary" : "secondary"} className={snapOn ? undefined : "bg-[#27272a]"}
          title="拖近画布边缘或其他部件的边缘/中线时自动对齐"
          onPress={() => setSnapOn(s => !s)}>吸附{snapOn ? "开" : "关"}</Btn>
        <Btn size="sm" variant={gridOn ? "primary" : "secondary"} className={gridOn ? undefined : "bg-[#27272a]"}
          title={`自适应网格：按画布宽度分档（当前 ${gridStep}px，屏幕约 ${Math.round(gridStep * pvScale)}px），拖动就近对齐到网格线`}
          onPress={() => setGridOn(g => !g)}>网格{gridOn ? "开" : "关"}</Btn>
        <Btn size="sm" variant="secondary" className="h-8 w-8 min-w-0 bg-[#27272a] px-0"
          title={panelOpen ? "收起右侧参数面板，画布占满整行" : "展开右侧参数面板"}
          onPress={() => setPanelOpen(o => {
            localStorage.setItem(PANEL_KEY, o ? "0" : "1");
            return !o;
          })}>
          {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </Btn>
      </div>

      {/* 画布工作区 */}
      <div className="relative flex-1 overflow-hidden bg-[#0e0f12]">
        <div ref={wrapRef}
          className="absolute inset-0 select-none overflow-auto p-6"
          style={{ paddingRight: panelOpen ? PANEL_W + 24 : 24 }}
          onMouseDown={e => {
            if (e.button === 1) startPan(e);
            else { setSelected(null); setSelPrompt(false); }
          }}>
          <div className="flex min-h-full min-w-full items-center justify-center">
            <div className="relative"
              style={{ width: Math.ceil(draft.canvas.w * pvScale), height: Math.ceil(draft.canvas.h * pvScale) }}>
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
              {/* 网格叠在预览之上、手柄盒之下（手柄盒有 z-index，自动浮在网格上） */}
              {gridOn && (
                <div className="pointer-events-none absolute inset-0 opacity-50"
                  style={{
                    backgroundImage:
                      "linear-gradient(#3a3f4a 1px, transparent 1px), linear-gradient(90deg, #3a3f4a 1px, transparent 1px)",
                    backgroundSize: `${gridStep * pvScale}px ${gridStep * pvScale}px`,
                  }} />
              )}
              {/* 对齐参考线：拖动吸附时显示，直改 DOM 不走 React */}
              <div ref={vgRef} className="pointer-events-none absolute inset-y-0 z-40 hidden w-px bg-accent" />
              <div ref={hgRef} className="pointer-events-none absolute inset-x-0 z-40 hidden h-px bg-accent" />
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
                        ? "border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(56,132,255,0.5)]"
                        : "border-white/25 hover:border-white/60"}`}
                    style={{
                      left: r.x * pvScale, top: r.y * pvScale,
                      width: r.w * pvScale, height: r.h * pvScale,
                      zIndex: isSel ? 30 : i + 1,
                    }}
                    onMouseDown={e => onDown(e, i, "move")}>
                    {isSel && (
                      <span className="pointer-events-none absolute left-0 top-0 -translate-y-full truncate bg-accent px-1.5 py-0.5 text-[11px] leading-4 text-white">
                        {WIDGET_LABEL[w.type] ?? w.type}{stretch && " · 通栏"}
                      </span>
                    )}
                    {w.type !== "gauge" && (
                      <div
                        className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize border-b-2 border-r-2 border-current opacity-60 hover:opacity-100"
                        style={{ borderColor: isSel ? "#3884ff" : "#a0a0a8" }}
                        title="拖拽调整大小"
                        onMouseDown={e => onDown(e, i, "resize")} />
                    )}
                  </div>
                );
              })}
              {/* 装饰命令行：和部件同款手柄盒，可拖可选中（只有整体挪动，没有改大小） */}
              {draft.prompt && promptRect && (
                <div ref={promptBoxRef}
                  className={`absolute cursor-move border transition-colors ${
                    selPrompt
                      ? "border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(56,132,255,0.5)]"
                      : "border-white/25 hover:border-white/60"}`}
                  style={{
                    left: promptRect.x * pvScale, top: promptRect.y * pvScale,
                    width: promptRect.w * pvScale, height: promptRect.h * pvScale,
                    zIndex: selPrompt ? 30 : 0,
                  }}
                  onMouseDown={e => onPromptDown(e)}>
                  {selPrompt && (
                    <span className="pointer-events-none absolute left-0 top-0 -translate-y-full truncate bg-accent px-1.5 py-0.5 text-[11px] leading-4 text-white">
                      命令行装饰
                    </span>
                  )}
                </div>
              )}
              {draft.widgets.length > 0 && !rects.some(Boolean) && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm text-muted">正在连接画布…</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧浮动面板：选中部件 → 参数；没选中 → 画布设置。可整体收起给画布让位 */}
        {panelOpen && (
        <div className="absolute right-4 top-4 bottom-4 z-50 w-[420px] overflow-y-auto rounded-xl border border-white/[0.06] bg-[#141416] p-4 shadow-xl">
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
                <TextField type="number" className="w-20 font-jetbrains tabular-nums"
                  value={String(val ?? 0)}
                  onChange={v => {
                    (pos as unknown as Record<string, number>)[key] = +v || 0;
                    setDraft({ ...draft });
                    onChange();
                  }}>
                  <Input variant="secondary" />
                </TextField>
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
                {promptRect && (
                  <div className="flex flex-wrap gap-2">
                    <span className="self-center text-xs text-color-desc">对齐命令行：</span>
                    <Btn size="sm" variant="secondary" className="bg-[#27272a]"
                      title="把这个部件的左缘贴到命令行第一个字符的位置"
                      onPress={() => {
                        pushHistory();
                        pos.x = promptRect.x;
                        setDraft({ ...draft });
                        onChange();
                      }}>左缘</Btn>
                    <Btn size="sm" variant="secondary" className="bg-[#27272a]"
                      title="把这个部件的顶边贴到命令行的顶边"
                      onPress={() => {
                        pushHistory();
                        pos.y = promptRect.y;
                        setDraft({ ...draft });
                        onChange();
                      }}>顶边</Btn>
                    <Btn size="sm" variant="secondary" className="bg-[#27272a]"
                      title="把部件底部挪到命令行下方一点，从顶部开始排"
                      onPress={() => {
                        pushHistory();
                        pos.y = promptRect.y + promptRect.h + 8;
                        setDraft({ ...draft });
                        onChange();
                      }}>移到命令行下方</Btn>
                  </div>
                )}
                {stretchable(w.type) && pos.w !== undefined && (
                  <Btn size="sm" variant="secondary" className="bg-[#27272a]"
                    title="清掉固定宽度，从 X 拉到画布右缘"
                    onPress={() => {
                      delete pos.w;
                      setDraft({ ...draft });
                      onChange();
                    }}>拉通到右缘</Btn>
                )}
                <div className="flex flex-wrap gap-2">
                  <Btn size="sm" variant="secondary" className="bg-[#27272a]"
                    title="Ctrl+D：复制这个部件并错位落下"
                    onPress={() => duplicateWidget(selected)}>复制</Btn>
                  <Btn size="sm" variant="secondary" className="bg-[#27272a]" title="后加的部件盖在前面之上"
                    onPress={() => {
                      pushHistory();
                      const [m] = draft.widgets.splice(selected, 1);
                      draft.widgets.push(m);
                      setSelected(draft.widgets.length - 1);
                      setDraft({ ...draft });
                      onChange();
                    }}>置顶</Btn>
                  <Btn size="sm" variant="secondary" className="bg-[#27272a]" title="与上面一个部件交换层级"
                    onPress={() => {
                      if (selected > 0) {
                        pushHistory();
                        [draft.widgets[selected - 1], draft.widgets[selected]] =
                          [draft.widgets[selected], draft.widgets[selected - 1]];
                        setSelected(selected - 1);
                        setDraft({ ...draft });
                        onChange();
                      }
                    }}>上移一层</Btn>
                  <Btn size="sm" variant="secondary" className="bg-[#27272a]" title="与下面一个部件交换层级"
                    onPress={() => {
                      if (selected < draft.widgets.length - 1) {
                        pushHistory();
                        [draft.widgets[selected + 1], draft.widgets[selected]] =
                          [draft.widgets[selected], draft.widgets[selected + 1]];
                        setSelected(selected + 1);
                        setDraft({ ...draft });
                        onChange();
                      }
                    }}>下移一层</Btn>
                  <Btn size="sm" variant="secondary" className="bg-danger/20 text-danger"
                    title="Delete" onPress={() => removeWidget(selected)}>删除</Btn>
                </div>
                <div className="border-t border-white/[0.06] pt-3">
                  {w.type === "stat" && <StatEditor w={w as StatWidget} metrics={metrics} onChange={onChange} compact />}
                  {w.type === "progress" && <ProgressEditor w={w as ProgressWidget} metrics={metrics} onChange={onChange} compact />}
                  {w.type === "gauge" && <GaugeEditor w={w as GaugeWidget} metrics={metrics} onChange={onChange} compact />}
                  {w.type === "html" && <HtmlEditor w={w as HtmlWidget} onChange={onChange} />}
                  {w.type === "cards" && <CardsEditor w={w as CardsWidget} metrics={metrics} onChange={onChange} compact />}
                  {w.type === "chips" && <ChipsEditor w={w as ChipsWidget} metrics={metrics} onChange={onChange} />}
                  {w.type === "text" && <TextEditor w={w as TextWidget} metrics={metrics} onChange={onChange} compact />}
                </div>
              </div>
            );
          })() : selPrompt && draft.prompt ? (() => {
            const p = draft.prompt;
            const pad = draft.canvas.padding || [12, 24];
            const pnum = (label: string, key: "x" | "y", val: number) => (
              <div className="flex flex-col gap-1.5">
                <FieldLabel>{label}</FieldLabel>
                <TextField type="number" className="w-20 font-jetbrains tabular-nums"
                  value={String(val)}
                  onChange={v => {
                    p[key] = Math.max(0, +v || 0);
                    setDraft({ ...draft });
                    onChange();
                  }}>
                  <Input variant="secondary" />
                </TextField>
              </div>
            );
            return (
              <div className="flex flex-col gap-3">
                <SubTitle>命令行装饰</SubTitle>
                <div className="flex flex-wrap items-end gap-3">
                  {pnum("X", "x", p.x ?? pad[1])}
                  {pnum("Y", "y", p.y ?? pad[0])}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn size="sm" variant="secondary" className="bg-[#27272a]"
                    title="回到画布内边距处"
                    onPress={() => {
                      pushHistory();
                      p.x = pad[1]; p.y = pad[0];
                      setDraft({ ...draft });
                      onChange();
                    }}>回到默认位置</Btn>
                  <Btn size="sm" variant="secondary" className="bg-danger/20 text-danger"
                    title="Delete" onPress={removePrompt}>删除</Btn>
                </div>
                <div className="border-t border-white/[0.06] pt-3">
                  <PromptBar draft={draft} onChange={onChange} compact />
                </div>
              </div>
            );
          })() : (
            <div className="flex flex-col gap-3">
              <SubTitle>画布设置</SubTitle>
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
                  拖动挪位置（部件和命令行装饰一样可拖） · 右下角改大小 · 中键拖动画布<br />
                  拖近边缘自动吸附 · 网格按画布尺寸与缩放自适应分档<br />
                  选中后可一键「对齐命令行」<br />
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-5 py-2.5">
        <Btn size="lg" className="px-7" isDisabled={!dirty} onPress={save}>保存</Btn>
        <Btn size="lg" variant="secondary" className="bg-[#27272a]" onPress={undoEdit}
          title="Ctrl+Z：回退上一步拖动/增删">撤销</Btn>
        <Btn size="lg" variant="secondary" className="bg-[#27272a]" onPress={undoSaved}>还原上一版</Btn>
        <Btn size="lg" variant="secondary" className="bg-[#27272a]" isDisabled={!dirty} onPress={discardDraft}
          title="丢掉没保存的改动，回到已保存的版式">放弃改动</Btn>
        {dirty && <span className="whitespace-nowrap text-sm text-warning">● 有未保存的改动</span>}
        <span className={`ml-auto whitespace-nowrap text-sm ${msgColor}`}>{msg.text}</span>
      </div>

      <TemplatePicker isOpen={tplOpen} onOpenChange={setTplOpen} onPick={applyPreset} current={draft} />
    </main>
  );
}
