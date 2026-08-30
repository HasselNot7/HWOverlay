import { addToast, Button, Input } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, clone, outPaths } from "../api";
import type { CardsWidget, ChipsWidget, OverlayConfig, TextWidget } from "../types";
import type { Shared } from "../App";
import { CardsEditor, ChipsEditor, TextEditor } from "./editors";

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConfig = useCallback(async () => {
    const c = await api.overlay();
    setCfg(c);
    setDraft(clone(c));
    setDirty(false);
    setMsg({ text: "", kind: "" });
    try { setCheck(await api.layoutCheck()); } catch { /* 校验面板留空 */ }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const onChange = useCallback(() => {
    if (!draft || !cfg) return;
    const isDirty = JSON.stringify(draft) !== JSON.stringify(cfg);
    setDirty(isDirty);
    setMsg(isDirty ? { text: "校验中…", kind: "" } : { text: "", kind: "" });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const rep = await api.layoutCheckDraft(draft);
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
  }, [draft, cfg]);

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
    setPvKey(k => k + 1);
    setMsg({ text: "✓ 已保存。OBS 里若没变化，点浏览器源的“刷新缓存”。", kind: "ok" });
    addToast({ title: "已保存", description: "OBS 里若没变化，点浏览器源的“刷新缓存”。", color: "success" });
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
    await loadConfig();
    setPvKey(k => k + 1);
    setMsg({ text: "✓ 已还原到上一版", kind: "ok" });
    addToast({ title: "已还原到上一版", color: "success" });
  };

  // 预览缩放：跟随容器实际宽度，窗口变化时重算
  useEffect(() => {
    const cw = draft?.canvas.w, ch = draft?.canvas.h;
    if (!cw || !ch) return;
    const fit = () => {
      const w = wrapRef.current?.clientWidth;
      if (!w) return;
      setPvScale(Math.min(1, (w - 2) / cw));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [draft?.canvas.w, draft?.canvas.h]);

  const addWidget = (w: OverlayConfig["widgets"][number]) => {
    if (!draft) return;
    draft.widgets.push(w);
    setDraft({ ...draft });
    onChange();
  };

  const removeWidget = (i: number) => {
    if (!draft) return;
    draft.widgets.splice(i, 1);
    setDraft({ ...draft });
    onChange();
  };

  const msgColor = msg.kind === "ok" ? "text-primary"
    : msg.kind === "bad" ? "text-[#d0777f]"
      : msg.kind === "warn" ? "text-warning" : "";

  if (!draft || !metrics) {
    return (
      <>
        <h1 className="mb-5 text-[21px] font-bold">版式编辑</h1>
        <div className="rounded-2xl border border-divider bg-content1 p-6 text-sm text-default-500">载入中…</div>
      </>
    );
  }

  const scalePct = Math.round(pvScale * 100);

  return (
    <>
      <h1 className="mb-5 text-[21px] font-bold">版式编辑</h1>

      {/* 版式校验 */}
      <div className="mb-4 rounded-2xl border border-divider bg-content1 p-5 shadow-lg">
        <h2 className="mb-3 text-sm font-bold before:mr-1.5 before:text-primary before:content-['▍']">版式校验</h2>
        {check && !check.errors.length && !check.warnings.length && (
          <div className="text-[13px] text-primary">✓ 版式无错误、无提醒</div>
        )}
        {check?.errors.map((e, i) => (
          <div key={i} className="text-[13px] text-[#d0777f]">✗ {e}</div>
        ))}
        {check?.warnings.map((w, i) => (
          <div key={i} className="text-[13px] text-warning">▲ {w}</div>
        ))}
      </div>

      {/* 编辑器 */}
      <div className="mb-4 rounded-2xl border border-divider bg-content1 p-5 shadow-lg">
        <h2 className="mb-3 text-sm font-bold before:mr-1.5 before:text-primary before:content-['▍']">编辑器</h2>
        <p className="hint rounded-lg border border-divider bg-[#17171a] p-2 text-xs text-default-500">
          <b className="font-normal text-primary">怎么玩</b>：部件从上往下排，就是叠加层从上到下的样子。
          点 <b className="font-normal text-primary">保存</b> 后下面的预览会刷新；
          确认效果后，再到 OBS 浏览器源里点一次“刷新缓存”即可生效。
        </p>

        <div className="my-3 flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-default-500">叠加层宽</span>
            <Input
              aria-label="叠加层宽" type="number" size="sm" variant="flat"
              defaultValue={String(draft.canvas.w)} className="w-32"
              onValueChange={v => { draft.canvas.w = +v || draft.canvas.w; setDraft({ ...draft }); onChange(); }}
            />
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-default-500">叠加层高</span>
            <Input
              aria-label="叠加层高" type="number" size="sm" variant="flat"
              defaultValue={String(draft.canvas.h)} className="w-32"
              onValueChange={v => { draft.canvas.h = +v || draft.canvas.h; setDraft({ ...draft }); onChange(); }}
            />
          </div>
          <span className="text-xs text-default-500">这两个数要和 OBS 浏览器源里填的宽高一致。</span>
        </div>

        <div className="flex flex-col gap-3">
          {draft.widgets.map((w, i) => {
            const meta = WIDGET_LABEL[w.type] ?? w.type;
            return (
              <div key={i} className="overflow-hidden rounded-2xl border border-divider bg-content2">
                <div className="flex items-center justify-between border-b border-divider bg-[#17171a] px-4 py-2.5">
                  <b className="text-[13px] font-bold text-primary">部件 {i + 1} · {meta}</b>
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

        <div className="mb-12 mt-3.5 flex gap-2.5">
          <Button size="sm" variant="flat" onPress={() => {
            const first = outPaths(metrics)[0];
            addWidget({
              type: "cards", items: [{
                key: `card${Date.now() % 10000}`, label: "新卡片", bar: first,
                value: { metrics: [first] }, sub: { sep: " · ", metrics: [] },
              }],
            });
          }}>+ 加一行指标卡片</Button>
          <Button size="sm" variant="flat" onPress={() => {
            addWidget({ type: "text", text: "CPU {cpu.usage}% · {cpu.temp}°C", size: 19, margin_top: 6 });
          }}>+ 加一行自定义文字</Button>
        </div>

        <div
          className="sticky bottom-0 z-[5] flex items-center gap-3 rounded-xl border border-divider bg-content2 px-3.5 py-2.5"
        >
          <Button color="primary" size="sm" isDisabled={!dirty} onPress={save} className="font-bold">保存</Button>
          <Button size="sm" variant="flat" onPress={undo}>还原上一版</Button>
          {dirty && <span className="text-xs text-warning">● 有未保存的改动</span>}
          <span className="flex-1" />
          <span className={`text-[13px] ${msgColor}`}>{msg.text}</span>
        </div>
      </div>

      {/* 预览 */}
      <div className="rounded-2xl border border-divider bg-content1 p-5 shadow-lg">
        <h2 className="mb-3 text-sm font-bold before:mr-1.5 before:text-primary before:content-['▍']">预览</h2>
        <div ref={wrapRef} className="w-full overflow-hidden rounded-lg border border-divider bg-[#17171a]"
          style={{ height: Math.ceil((draft.canvas.h || 200) * pvScale) }}>
          <iframe
            key={pvKey}
            title="叠加层预览" scrolling="no"
            src={`/?t=${pvKey}`}
            className="border-0"
            style={{
              width: draft.canvas.w, height: draft.canvas.h,
              transform: `scale(${pvScale})`, transformOrigin: "0 0",
            }}
          />
        </div>
        <div className="mt-1.5 text-xs text-default-500">
          预览按 {scalePct}% 缩放，真实尺寸 {draft.canvas.w}×{draft.canvas.h}。
        </div>
      </div>
    </>
  );
}
