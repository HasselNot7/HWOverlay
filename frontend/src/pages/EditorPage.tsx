import { addToast, Button, Input, Switch, Tab, Tabs } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, clone, outPaths } from "../api";
import type {
  CardsWidget, ChipsWidget, FreePos, HtmlWidget, OverlayConfig,
  ProgressWidget, StatWidget, TextWidget, Widget,
} from "../types";
import type { Shared } from "../App";
import { CARD_CLS, FieldLabel, Hint, Page, Section, SubTitle } from "../ui";
import { CardsEditor, ChipsEditor, HtmlEditor, ProgressEditor, StatEditor, TextEditor } from "./editors";
import FreeCanvas, { estHeight } from "./FreeCanvas";

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
  const [selected, setSelected] = useState<number | null>(null);
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

  /** 自由画布：按预设类型在空位落一个新部件并选中它 */
  const addFree = (type: string) => {
    if (!draft || !metrics) return;
    const first = outPaths(metrics)[0];
    const n = draft.widgets.length;
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
    draft.widgets.push(base as unknown as Widget);
    setDraft({ ...draft });
    setSelected(n);
    onChange();
  };

  const removeWidget = (i: number) => {
    if (!draft) return;
    draft.widgets.splice(i, 1);
    setDraft({ ...draft });
    onChange();
  };

  const msgColor = msg.kind === "ok" ? "text-primary"
    : msg.kind === "bad" ? "text-danger"
      : msg.kind === "warn" ? "text-warning" : "text-color-desc";

  if (!draft || !metrics) {
    return (
      <Page title="版式编辑">
        <Section title="编辑器" divider={false}><Hint>载入中…</Hint></Section>
      </Page>
    );
  }

  const scalePct = Math.round(pvScale * 100);

  /** 一键上手：注册内置指标集 + 把预设版式原地装进草稿（脏状态，看过满意再点保存）。
   * 注意走项目惯例的原地修改：直接 setDraft(新对象) 会让 onChange 的闭包比不出 dirty。 */
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
    <Page title="版式编辑">
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
        <div className="flex flex-wrap items-center gap-4">
          <Tabs size="sm" radius="lg"
            selectedKey={draft.canvas.mode === "free" ? "free" : "flow"}
            onSelectionChange={k => {
              if (k === "free") {
                draft.canvas.mode = "free";
                // 流式转自由：按真实高度在原内边距处竖排一遍（和流式观感一致），
                // 用户再拖走；margin_top 已折算进 y。
                const pad = draft.canvas.padding || [12, 24];
                let y = pad[0];
                if (draft.prompt) y += Math.round((draft.prompt.size ?? 19) * 1.2) + 10;
                const x0 = pad[1];
                draft.widgets.forEach(w => {
                  const p = w as FreePos;
                  if (p.x === undefined || p.y === undefined) {
                    p.x = x0;
                    p.y = y;
                    y += estHeight(w) + 8;
                  }
                });
              } else {
                delete draft.canvas.mode;
              }
              setSelected(null);
              setDraft({ ...draft });
              onChange();
            }}>
            <Tab key="flow" title="流式" />
            <Tab key="free" title="自由画布" />
          </Tabs>
          <Hint>
            {draft.canvas.mode === "free"
              ? "拖部件摆位置，右下角改大小；选中后在下方改参数。"
              : "部件从上往下排；保存后在 OBS 浏览器源里点“刷新缓存”生效。"}
          </Hint>
        </div>

        <div className="mt-2 flex flex-wrap items-end gap-5">
          <div className="flex flex-col gap-2">
            <FieldLabel>叠加层宽</FieldLabel>
            <Input
              aria-label="叠加层宽" type="number" size="lg" variant="flat"
              classNames={{ inputWrapper: "px-4" }}
              defaultValue={String(draft.canvas.w)} className="w-36 font-poppins"
              onValueChange={v => { draft.canvas.w = +v || draft.canvas.w; setDraft({ ...draft }); onChange(); }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <FieldLabel>叠加层高</FieldLabel>
            <Input
              aria-label="叠加层高" type="number" size="lg" variant="flat"
              classNames={{ inputWrapper: "px-4" }}
              defaultValue={String(draft.canvas.h)} className="w-36 font-poppins"
              onValueChange={v => { draft.canvas.h = +v || draft.canvas.h; setDraft({ ...draft }); onChange(); }}
            />
          </div>
          <Hint className="pb-3">与 OBS 浏览器源里的宽高保持一致。</Hint>
        </div>

        {/* 顶部装饰命令行：整行可开关，内容/字号/光标可改 */}
        <div className="mt-2 flex flex-wrap items-end gap-5">
          <div className="flex flex-col gap-2">
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
                  setDraft({ ...draft });
                  onChange();
                }} />
            </div>
          </div>
          {draft.prompt && (
            <>
              <div className="flex flex-col gap-2">
                <FieldLabel>用户@主机</FieldLabel>
                <Input aria-label="命令行用户" size="lg" variant="flat" className="w-56 font-poppins"
                  value={draft.prompt.user ?? ""}
                  onValueChange={v => { draft.prompt!.user = v; setDraft({ ...draft }); onChange(); }} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <FieldLabel>命令行文本</FieldLabel>
                <Input aria-label="命令行文本" size="lg" variant="flat" className="min-w-[280px] font-poppins"
                  value={draft.prompt.cmd ?? ""}
                  onValueChange={v => { draft.prompt!.cmd = v; setDraft({ ...draft }); onChange(); }} />
              </div>
              <div className="flex flex-col gap-2">
                <FieldLabel>命令行字号</FieldLabel>
                <Input aria-label="命令行字号" type="number" size="lg" variant="flat" className="w-24 font-poppins"
                  value={String(draft.prompt.size ?? 19)}
                  onValueChange={v => { draft.prompt!.size = +v || 19; setDraft({ ...draft }); onChange(); }} />
              </div>
              <div className="flex flex-col gap-2 pb-3">
                <FieldLabel>闪烁光标</FieldLabel>
                <div className="flex h-12 items-center">
                  <Switch size="sm" aria-label="闪烁光标"
                    isSelected={draft.prompt.cursor ?? true}
                    onValueChange={b => { draft.prompt!.cursor = b; setDraft({ ...draft }); onChange(); }} />
                </div>
              </div>
            </>
          )}
        </div>

        {draft.canvas.mode === "free" ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {([["stat", "大数字"], ["progress", "进度条"], ["html", "自定义 HTML"],
                 ["cards", "指标卡"], ["chips", "小指标行"], ["text", "文本"]] as const).map(([t, label]) => (
                <Button key={t} size="sm" variant="flat" className="bg-[#27272a]"
                  onPress={() => addFree(t)}>+ {label}</Button>
              ))}
            </div>
            <div className="mt-3">
              <FreeCanvas draft={draft} selected={selected} onSelect={setSelected} onChange={onChange} />
            </div>
            {selected != null && draft.widgets[selected] && (() => {
              const w = draft.widgets[selected]!;
              const pos = w as FreePos;
              const numInput = (label: string, key: "x" | "y" | "w" | "h", val?: number) => (
                <div className="flex flex-col gap-2">
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
              return (
                <div className={`${CARD_CLS} mt-3 p-4`}>
                  <div className="flex flex-wrap items-center gap-4">
                    <SubTitle>{WIDGET_LABEL[w.type] ?? w.type} 参数</SubTitle>
                    {numInput("X", "x", pos.x)}
                    {numInput("Y", "y", pos.y)}
                    {(w.type === "html" || w.type === "progress" || w.type === "stat") && numInput("宽", "w", pos.w)}
                    {w.type === "html" && numInput("高", "h", pos.h)}
                    <span className="flex-1" />
                    <Button size="sm" variant="light" className="h-7 min-w-0 px-2 text-xs text-default-400"
                      title="后加的部件盖在前面之上" onPress={() => {
                        const [m] = draft.widgets.splice(selected, 1);
                        draft.widgets.push(m);
                        setSelected(draft.widgets.length - 1);
                        onChange();
                      }}>置顶</Button>
                    <Button size="sm" variant="light" className="h-7 min-w-0 px-2 text-xs text-default-400"
                      title="与上面一个部件交换层级" onPress={() => {
                        if (selected > 0) {
                          [draft.widgets[selected - 1], draft.widgets[selected]] =
                            [draft.widgets[selected], draft.widgets[selected - 1]];
                          setSelected(selected - 1);
                          onChange();
                        }
                      }}>上移一层</Button>
                    <Button size="sm" variant="light" className="h-7 min-w-0 px-2 text-xs text-default-400"
                      title="与下面一个部件交换层级" onPress={() => {
                        if (selected < draft.widgets.length - 1) {
                          [draft.widgets[selected + 1], draft.widgets[selected]] =
                            [draft.widgets[selected], draft.widgets[selected + 1]];
                          setSelected(selected + 1);
                          onChange();
                        }
                      }}>下移一层</Button>
                    <Button size="sm" variant="light" className="h-7 min-w-0 px-2 text-xs text-danger-400"
                      onPress={() => { draft.widgets.splice(selected, 1); setSelected(null); onChange(); }}>
                      删除这个部件
                    </Button>
                  </div>
                  <div className="mt-3">
                    {w.type === "stat" && <StatEditor w={w as StatWidget} metrics={metrics} onChange={onChange} />}
                    {w.type === "progress" && <ProgressEditor w={w as ProgressWidget} metrics={metrics} onChange={onChange} />}
                    {w.type === "html" && <HtmlEditor w={w as HtmlWidget} onChange={onChange} />}
                    {w.type === "cards" && <CardsEditor w={w as CardsWidget} metrics={metrics} onChange={onChange} />}
                    {w.type === "chips" && <ChipsEditor w={w as ChipsWidget} metrics={metrics} onChange={onChange} />}
                    {w.type === "text" && <TextEditor w={w as TextWidget} metrics={metrics} onChange={onChange} />}
                  </div>
                </div>
              );
            })()}
          </>
        ) : (
          <>
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
          </>
        )}
      </Section>

      <Section title="预览" divider={false}>
        <div ref={wrapRef} className={`w-full overflow-hidden ${CARD_CLS}`}
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
        <Hint className="mt-2">
          预览按 {scalePct}% 缩放，真实尺寸 {draft.canvas.w}×{draft.canvas.h}。
        </Hint>
      </Section>

      {/* 吸底保存条：Now Playing 卡片同款底色，按钮用主色大号 */}
      <div className={`sticky bottom-4 z-10 flex items-center gap-3 ${CARD_CLS} px-4 py-3 shadow-lg`}>
        <SubTitle>版式</SubTitle>
        <Button color="primary" size="lg" className="px-7" isDisabled={!dirty} onPress={save}>保存</Button>
        <Button size="lg" variant="flat" className="bg-[#27272a]" onPress={undo}>还原上一版</Button>
        {dirty && <span className="text-sm text-warning">● 有未保存的改动</span>}
        <span className="flex-1" />
        <span className={`text-sm ${msgColor}`}>{msg.text}</span>
      </div>
    </Page>
  );
}
