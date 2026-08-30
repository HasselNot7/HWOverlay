import { addToast, Button, Input } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, clone, outPaths } from "../api";
import { clearDraft, loadDraft, saveDraft } from "../draftStore";
import type { CardsWidget, ChipsWidget, OverlayConfig, TextWidget } from "../types";
import type { Shared } from "../App";
import { CARD_CLS, FieldLabel, Hint, Page, Section, SubTitle } from "../ui";
import {
  CanvasFields, CardsEditor, ChipsEditor, PromptBar, TextEditor,
} from "./editors";

/** 流式排版：部件从上往下排。自由摆放（拖拽）在「自由排版」页。 */

const WIDGET_LABEL: Record<string, string> = {
  cards: "指标卡片", chips: "底部小指标行", text: "自定义文字",
};

export default function EditorPage({ shared }: { shared: Shared }) {
  const { metrics } = shared;
  const [cfg, setCfg] = useState<OverlayConfig | null>(null);
  const [draft, setDraft] = useState<OverlayConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "" | "ok" | "bad" | "warn" }>({ text: "", kind: "" });
  const [check, setCheck] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [pvKey, setPvKey] = useState(0);
  const [pvScale, setPvScale] = useState(0.45);
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<OverlayConfig | null>(null);
  draftRef.current = draft;

  const loadConfig = useCallback(async () => {
    const c = await api.overlay();
    // 上次没保存的草稿还在（切过页面/刷新过浏览器）就接着用
    const stored = loadDraft("flow");
    let d = clone(c);
    let restored = false;
    if (stored) {
      try {
        const s = JSON.parse(stored) as OverlayConfig;
        if (JSON.stringify(s) !== JSON.stringify(c)) { d = s; restored = true; }
        else clearDraft("flow");
      } catch { clearDraft("flow"); }
    }
    const wasFree = d.canvas.mode === "free";
    delete d.canvas.mode;   // 流式页一律按流式预览/保存
    setCfg(c);
    setDraft(d);
    const isDirty = JSON.stringify(d) !== JSON.stringify(c);
    setDirty(isDirty);
    setMsg(restored
      ? { text: "已恢复上次没保存的排版（不要就点「放弃改动」）", kind: "warn" }
      : isDirty
        ? { text: wasFree ? "已切回流式排版（还没保存）" : "有未保存的改动", kind: "warn" }
        : { text: "", kind: "" });
    try { setCheck(await api.layoutCheck()); } catch { /* 校验面板留空 */ }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  /** 子组件原地改草稿后调 onChange()：换新对象身份让预览 effect 感知变化。 */
  const onChange = useCallback(() => {
    const d = draftRef.current;
    const c = cfg;
    if (!d || !c) return;
    setDraft({ ...d });
    const isDirty = JSON.stringify(d) !== JSON.stringify(c);
    // 有改动就暂存：切页面、刷新浏览器都还在；回到和已保存一致就清掉
    if (isDirty) saveDraft("flow", d);
    else clearDraft("flow");
    setDirty(isDirty);
    setMsg(isDirty ? { text: "校验中…", kind: "" } : { text: "", kind: "" });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const rep = await api.layoutCheckDraft(d);
        setCheck(rep);
        shared.check && shared.refreshAll();
        if (rep.errors?.length) {
          setMsg({ text: `✗ ${rep.errors.join("；")}`, kind: "bad" });
        } else {
          setMsg(isDirty
            ? { text: rep.warnings?.length ? `可保存（${rep.warnings.length} 条提醒）` : "可保存", kind: "warn" }
            : { text: "没有改动", kind: "" });
        }
      } catch { /* 校验失败不打断编辑 */ }
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  // 预览实时跟随草稿：iframe 里是 /?preview=1 的 monitor.html，
  // 它不读 overlay.json，等这边 postMessage 推草稿，推一次重建一次。
  const pushPreview = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "hwobs-preview", layout: draft }, "*");
  }, [draft]);
  useEffect(() => { pushPreview(); }, [pushPreview]);

  // monitor 就绪后回报 hwobs-ready —— iframe 的 load 事件会被 @import 的
  // 在线字体拖住好几秒，只赌 onLoad 会在第一次推送丢进 about:blank 里。
  const pushRef = useRef(pushPreview);
  pushRef.current = pushPreview;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      if ((e.data as { type?: string })?.type === "hwobs-ready") pushRef.current();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const save = async () => {
    if (!draft) return;
    const rep = await api.saveConfig(draft);
    if (!rep.saved) {
      setMsg({ text: `✗ 保存失败：${(rep.errors || []).join("；")}`, kind: "bad" });
      addToast({ title: "保存失败", description: (rep.errors || []).join("；"), color: "danger" });
      return;
    }
    setCfg(clone(draft));
    setDirty(false);
    clearDraft("flow");
    setPvKey(k => k + 1);
    setMsg({ text: "✓ 已保存", kind: "ok" });
    addToast({ title: "已保存", description: "OBS 里没变化就点「刷新缓存」", color: "success" });
    try {
      const c = await api.layoutCheck();
      setCheck(c);
      shared.refreshAll();
    } catch { /* 静默 */ }
  };

  const undo = async () => {
    const rep = await api.rollback();
    if (!rep.restored) {
      setMsg({ text: `✗ ${(rep.errors || []).join("；")}`, kind: "bad" });
      return;
    }
    clearDraft("flow");
    await loadConfig();
    setPvKey(k => k + 1);
    setMsg({ text: "✓ 已还原到上一版", kind: "ok" });
  };

  /** 丢掉没保存的草稿，回到已保存的版式 */
  const discardDraft = useCallback(async () => {
    clearDraft("flow");
    await loadConfig();
    addToast({ title: "已放弃未保存的改动", color: "default" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConfig]);

  // 预览缩放：盯容器本身，窗口变化/面板展开都重算
  useEffect(() => {
    const cw = draft?.canvas.w, ch = draft?.canvas.h;
    if (!cw || !ch) return;
    const fit = () => {
      const w = wrapRef.current?.clientWidth;
      if (!w) return;
      setPvScale(Math.min(1, (w - 2) / cw));
    };
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [draft?.canvas.w, draft?.canvas.h]);

  const addWidget = (w: OverlayConfig["widgets"][number]) => {
    const d = draftRef.current;
    if (!d) return;
    d.widgets.push(w);
    setDraft({ ...d });
    onChange();
  };

  const removeWidget = (i: number) => {
    const d = draftRef.current;
    if (!d) return;
    d.widgets.splice(i, 1);
    setDraft({ ...d });
    onChange();
  };

  const msgColor = msg.kind === "ok" ? "text-primary"
    : msg.kind === "bad" ? "text-danger"
      : msg.kind === "warn" ? "text-warning" : "text-color-desc";

  if (!draft || !metrics) {
    return (
      <Page title="流式排版">
        <Section title="编辑器" divider={false}><Hint>载入中…</Hint></Section>
      </Page>
    );
  }

  const scalePct = Math.round(pvScale * 100);

  /** 一键上手：注册内置指标集 + 把预设版式原地装进草稿（脏状态，看过满意再点保存）。 */
  const loadPreset = async () => {
    try {
      const seeded = await api.seedPresetMetrics();
      const preset = await api.layoutPreset();
      Object.assign(draft, preset);
      setDraft({ ...draft });
      onChange();
      addToast({
        title: "默认样式已装进草稿",
        description: seeded.added ? `已顺带注册 ${seeded.added} 个默认指标` : undefined,
        color: "success",
      });
    } catch (e) {
      addToast({ title: "加载默认样式失败", description: String(e), color: "danger" });
    }
  };

  return (
    <Page title="流式排版">
      {!metrics.length && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          还没有注册任何指标 —— 去「自定义指标」注册，或点下面"加载默认样式"。
        </div>
      )}
      <Section title="版式校验">
        {draft.widgets.length === 0 && (
          <div className="flex flex-col gap-2">
            <Hint>画布是空的。</Hint>
            <Button variant="flat" size="lg" className="w-fit bg-[#27272a]" onPress={loadPreset}>
              加载默认样式
            </Button>
          </div>
        )}
        {check && !check.errors.length && !check.warnings.length && (
          <Hint><span className="text-success">✓ 版式无错误、无提醒</span></Hint>
        )}
        {check?.errors.map((e, i) => (
          <div key={i} className="text-sm text-danger">✗ {e}</div>
        ))}
        {check?.warnings.map((w, i) => (
          <div key={i} className="text-sm text-warning">▲ {w}</div>
        ))}
      </Section>

      <Section title="编辑器">
        <Hint>
          部件从上往下排，下方预览实时跟随；保存后在 OBS 里点“刷新缓存”生效。
          要拖拽自由摆放，去「自由排版」页。
        </Hint>

        <CanvasFields draft={draft} onChange={onChange} />
        <PromptBar draft={draft} onChange={onChange} />

        <div className="mt-4 flex flex-col gap-3">
          {draft.widgets.map((w, i) => {
            const meta = WIDGET_LABEL[w.type] ?? w.type;
            return (
              <div key={i} className={CARD_CLS}>
                <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-3">
                  <b className="text-sm font-bold text-default-800">部件 {i + 1} · {meta}</b>
                  <Button size="sm" variant="light" className="h-7 min-w-0 px-2 text-xs text-default-400"
                    onPress={() => removeWidget(i)}>删除这一部件</Button>
                </div>
                <div className="px-4 py-3">
                  {w.type === "cards" && <CardsEditor w={w as CardsWidget} metrics={metrics} onChange={onChange} />}
                  {w.type === "chips" && <ChipsEditor w={w as ChipsWidget} metrics={metrics} onChange={onChange} />}
                  {w.type === "text" && <TextEditor w={w as TextWidget} metrics={metrics} onChange={onChange} />}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mb-14 mt-3 grid grid-cols-2 gap-2">
          <Button variant="flat" size="lg" className="bg-[#27272a]" disableRipple onPress={() => {
            const first = outPaths(metrics)[0];
            addWidget({
              type: "cards", items: [{
                key: `card${Date.now() % 10000}`, label: "新卡片", bar: first,
                value: { metrics: [first] }, sub: { sep: " · ", metrics: [] },
              }],
            });
          }}>+ 加一行指标卡片</Button>
          <Button variant="flat" size="lg" className="bg-[#27272a]" disableRipple onPress={() => {
            addWidget({ type: "text", text: "CPU {cpu.usage}% · {cpu.temp}°C", size: 19, margin_top: 6 });
          }}>+ 加一行自定义文字</Button>
        </div>
      </Section>

      <Section title="预览" divider={false}>
        <div ref={wrapRef} className={`w-full overflow-hidden ${CARD_CLS}`}
          style={{ height: Math.ceil((draft.canvas.h || 200) * pvScale) }}>
          <iframe
            key={pvKey}
            ref={frameRef}
            title="叠加层预览" scrolling="no"
            src={`/?preview=1&t=${pvKey}`}
            onLoad={pushPreview}
            className="border-0"
            style={{
              width: draft.canvas.w, height: draft.canvas.h,
              transform: `scale(${pvScale})`, transformOrigin: "0 0",
            }}
          />
        </div>
        <Hint className="mt-2">
          预览实时跟随草稿，按 {scalePct}% 缩放，真实尺寸 {draft.canvas.w}×{draft.canvas.h}。
        </Hint>
      </Section>

      {/* 吸底保存条 */}
      <div className={`sticky bottom-4 z-10 flex items-center gap-3 ${CARD_CLS} px-4 py-3 shadow-lg`}>
        <SubTitle>流式版式</SubTitle>
        <Button color="primary" size="lg" className="px-7" isDisabled={!dirty} onPress={save}>保存</Button>
        <Button size="lg" variant="flat" className="bg-[#27272a]" onPress={undo}>还原上一版</Button>
        <Button size="lg" variant="flat" className="bg-[#27272a]" isDisabled={!dirty} onPress={discardDraft}
          title="丢掉没保存的改动，回到已保存的版式">放弃改动</Button>
        {dirty && <span className="text-sm text-warning">● 有未保存的改动</span>}
        <span className="flex-1" />
        <span className={`text-sm ${msgColor}`}>{msg.text}</span>
      </div>
    </Page>
  );
}
