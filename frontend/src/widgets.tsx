import { Button, Modal, TextField, Input, Label, toast } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { Layers, Plus, X } from "lucide-react";
import { api } from "./api";
import type { AidaStatus, Profile } from "./types";

/** 从 AIDA64 状态算出「哪里不对 + 怎么修」。文案接向导页的排障知识，分步列给用户。 */
export function troubleshoot(st: AidaStatus | null): { title: string; steps: string[] }[] {
  if (!st) return [];
  const out: { title: string; steps: string[] }[] = [];
  if (st.error) {
    out.push({ title: "读取状态出错", steps: [st.error, "点侧栏「刷新数据」重试；持续失败看 HWOverlay.exe 控制台窗口"] });
    return out;
  }
  if (!st.running) {
    out.push({ title: "AIDA64 没在运行", steps: ["启动 AIDA64（HWOverlay 只读它的共享内存，不代它启动）", "启动后回到本页，点「刷新数据」"] });
  }
  if (st.running && !st.shm_readable) {
    out.push({
      title: "AIDA64 在跑，但共享内存读不到",
      steps: [
        "AIDA64 菜单：文件 → 偏好设置 → 硬件监视工具 → 外部程序",
        "勾选「启用 AIDA64 传感器支持」与「共享内存」",
        "确定后无需重启，回到本页点「刷新数据」",
      ],
    });
  }
  if (st.running && !st.ini) {
    out.push({ title: "没找到 AIDA64 配置文件", steps: ["绿色版请先完整启动一次 AIDA64（生成 ini）", "确认安装目录：现在识别为 " + (st.install || "未找到")] });
  }
  if (st.running && st.shm_readable && st.exported_ids.length === 0) {
    out.push({ title: "AIDA64 没有导出任何传感器", steps: ["AIDA64 菜单：工具 → 传感器窗口 → 在 SensorData 页勾选要导出的传感器", "勾选即写入共享内存，回到本页点「刷新数据」"] });
  }
  const net = st.windows_net_sampler;
  if (net && !net.sampling) {
    out.push({ title: "网卡实时采样未启动", steps: ["这不影响 AIDA64 已导出的网络传感器", `采样器状态：${net.error || "未运行"}`] });
  }
  return out;
}

/** AIDA64 本身是否健康（不含网卡采样这类旁路问题）——决定状态点的颜色。 */
export function aidaIssue(st: AidaStatus | null): "ok" | "warn" | "bad" {
  if (!st) return "ok";
  if (!st.running || st.error) return "bad";
  if (!st.shm_readable || !st.ini || st.exported_ids.length === 0) return "warn";
  return "ok";
}

/** 连接排障弹窗：状态点的 warning/danger 可点开，分步 list-disc 引导（NP 平台连通性同款）。 */
export function TroubleshootModal({ status, isOpen, onClose }: {
  status: AidaStatus | null; isOpen: boolean; onClose: () => void;
}) {
  const problems = troubleshoot(status);
  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
        <Modal.Container size="md">
          <Modal.Dialog className="sm:max-w-[560px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>连接排障</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {problems.length === 0 ? (
                <p className="text-sm leading-6 text-color-desc">一切正常 —— 没检测到连接问题。</p>
              ) : (
                <div className="flex flex-col gap-5">
                  {problems.map((p, i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-warning shadow-[0_0_8px_var(--warning)]" />
                        <b className="text-sm font-bold text-foreground">{p.title}</b>
                      </div>
                      <ol className="ml-5 flex list-decimal flex-col gap-1.5 text-sm text-color-desc marker:text-muted">
                        {p.steps.map((s, j) => <li key={j} className="leading-6">{s}</li>)}
                      </ol>
                    </div>
                  ))}
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" className="bg-[#27272a]" onPress={onClose}>知道了</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

const PREV_POS = "hwobs.preview.pos";
const PREV_OPEN = "hwobs.preview.open";

/** 悬浮实时预览窗：非编辑器页右下角常驻 iframe，按画布尺寸自动缩放、可拖动、可开关。
 * 读的是已发布版式（/），不是草稿 —— 保存后这里会跟着变。iframe 不吃点击，只作展示。 */
export function LivePreview({ url, canvasW, canvasH }: {
  url: string; canvasW: number; canvasH: number;
}) {
  const [open, setOpen] = useState(() => localStorage.getItem(PREV_OPEN) !== "0");
  const [pos, setPos] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PREV_POS) || "null") as { x: number; y: number } | null; }
    catch { return null; }
  });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { localStorage.setItem(PREV_OPEN, open ? "1" : "0"); }, [open]);
  useEffect(() => { if (pos) localStorage.setItem(PREV_POS, JSON.stringify(pos)); }, [pos]);

  // 宽度固定 380，按画布真实比例缩放高度
  const W = 380;
  const scale = canvasW > 0 ? Math.min(1, W / canvasW) : 1;
  const boxW = canvasW * scale;
  const boxH = canvasH * scale;

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const x = Math.max(0, Math.min(window.innerWidth - boxW - 8, d.ox + e.clientX - d.sx));
    const y = Math.max(0, Math.min(window.innerHeight - 40, d.oy + e.clientY - d.sy));
    setPos({ x, y });
  };
  const onPointerUp = () => { dragRef.current = null; };

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
    : { right: 24, bottom: 24 };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title="打开实时预览"
        className="fixed bottom-6 right-6 z-30 cursor-pointer rounded-full border border-white/10 bg-[#1a1a1d] px-4 py-2 text-sm font-medium text-muted shadow-lg transition-colors hover:border-accent/60 hover:text-foreground">
        预览叠加层
      </button>
    );
  }
  return (
    <div ref={boxRef} style={style}
      className="fixed z-30 w-[380px] overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1d] shadow-2xl"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="flex h-9 cursor-move items-center justify-between border-b border-white/[0.06] px-3 select-none">
        <span className="flex items-center gap-2 text-xs font-medium text-muted">
          <span className="size-1.5 rounded-full bg-success shadow-[0_0_6px_var(--success)]" />
          实时预览 · {canvasW}×{canvasH}
        </span>
        <button type="button" onClick={() => setOpen(false)} title="关闭预览"
          className="grid size-5 place-items-center rounded text-muted transition-colors hover:bg-white/10 hover:text-foreground">
          <X size={13} />
        </button>
      </div>
      <div className="overflow-hidden bg-[#0e0f12]" style={{ height: boxH }}>
        <iframe title="叠加层实时预览" src={url} scrolling="no"
          className="pointer-events-none border-0"
          style={{ width: canvasW, height: canvasH, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
      </div>
    </div>
  );
}

/** 侧栏版式档位切换器：药丸列表，点非生效档即切换发布（OBS 实时变），
 * 「存为档位」快照当前已发布版式，hover 出 ✕ 删除。 */
export function ProfileSwitcher({ onPublished }: { onPublished?: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.profiles().then(d => { setProfiles(d.profiles); setActive(d.active); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const activate = async (n: string) => {
    if (n === active) return;
    setBusy(true);
    try {
      const rep = await api.activateProfile(n);
      if (rep.activated) {
        toast.success(`已切到档位：${n}`, { description: "OBS 叠加层已更新，没变就点刷新缓存", timeout: 2500 });
        load(); onPublished?.();
      } else {
        toast.danger("切换失败", { description: rep.error, timeout: 6000 });
      }
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const rep = await api.saveProfile(name.trim());
      if (rep.saved) {
        toast.success(`已存为档位：${name.trim()}`, { timeout: 2200 });
        setSaveOpen(false); setName(""); load();
      } else {
        toast.danger("存档位失败", { description: rep.error, timeout: 6000 });
      }
    } finally { setBusy(false); }
  };

  const del = async (n: string) => {
    const rep = await api.removeProfile(n);
    if (rep.removed) { toast(`已删除档位：${n}`); load(); }
    else toast.danger("删除失败", { description: rep.error, timeout: 6000 });
  };

  return (
    <div className="flex flex-col gap-2 px-3 pb-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-bold text-accent">
          <Layers size={13} /> 版式档位
        </span>
        <button type="button" onClick={() => setSaveOpen(true)} title="把当前已发布版式存成一个新档位"
          className="inline-flex cursor-pointer items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground">
          <Plus size={12} /> 存为
        </button>
      </div>
      {profiles.length === 0 ? (
        <span className="text-xs text-color-desc">还没有档位 —— 调好版式后点「存为」</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {profiles.map(p => (
            <span key={p.name} className="group relative">
              <button type="button" disabled={busy} onClick={() => activate(p.name)}
                title={p.active ? "当前生效档位" : `切换到「${p.name}」并发布到 OBS`}
                className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-150 ${
                  p.active
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-white/10 text-muted hover:border-accent/50 hover:text-foreground"
                }`}>
                {p.name}{p.modified ? " ·已改" : ""}
              </button>
              <button type="button" onClick={() => del(p.name)} title={`删除档位「${p.name}」`}
                className="absolute -right-1 -top-1 hidden size-3.5 place-items-center rounded-full bg-[#3a3a40] text-[9px] text-muted hover:bg-danger hover:text-white group-hover:grid">
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      <Modal>
        <Modal.Backdrop isOpen={saveOpen} onOpenChange={o => { if (!o) setSaveOpen(false); }}>
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>存为档位</Modal.Heading></Modal.Header>
              <Modal.Body>
                <p className="mb-3 text-sm leading-6 text-color-desc">
                  把当前已发布的版式快照成一个档位，之后可一键切回。
                </p>
                <TextField value={name} onChange={setName}
                  onKeyDown={e => { if (e.key === "Enter" && !busy && name.trim()) save(); }}>
                  <Label>档位名</Label>
                  <Input placeholder="例如：全屏直播 / 角落小窗" />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" className="bg-[#27272a]" onPress={() => setSaveOpen(false)}>取消</Button>
                <Button isDisabled={!name.trim() || busy} onPress={save}>保存</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
