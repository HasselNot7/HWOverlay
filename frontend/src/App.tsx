import { addToast, Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Switch } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  House, Activity, LayoutGrid, FlaskConical, Table2, RefreshCw,
  ExternalLink, AudioLines, Power,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "./api";
import type { AidaStatus, HW, LayoutCheck, Metric } from "./types";
import WizardPage from "./pages/WizardPage";
import StatusPage from "./pages/StatusPage";
import EditorPage from "./pages/EditorPage";
import CustomMetricsPage from "./pages/CustomMetricsPage";
import MetricsTablePage from "./pages/MetricsTablePage";

const NAV = [
  { id: "start", label: "开始使用", Icon: House },
  { id: "status", label: "状态总览", Icon: Activity },
  { id: "editor", label: "版式编辑", Icon: LayoutGrid },
  { id: "custom", label: "自定义指标", Icon: FlaskConical },
  { id: "metrics", label: "指标总表", Icon: Table2 },
];

export interface Shared {
  metrics: Metric[] | null;
  hw: HW | null;
  check: LayoutCheck | null;
  status: AidaStatus | null;
  reloadMetrics: () => Promise<Metric[]>;
  refreshAll: () => Promise<void>;
  /** 向导等页面的"去 XX"按钮切视图用 */
  goto: (view: string) => void;
}

/** 导航项：Now Playing 同款 —— min-h-12 圆角药丸，激活 bg-default-100，图标 24px。 */
function NavBtn({ active, label, Icon, onClick, danger = false }: {
  active: boolean;
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full min-h-12 cursor-pointer items-center gap-[0.55rem] rounded-xl px-3 py-1.5 text-left text-base font-medium transition-all duration-150 ${
        active
          ? "bg-default-100 text-foreground"
          : danger
            ? "text-default-500 hover:bg-danger/15 hover:text-danger"
            : "text-default-500 hover:bg-default/40 hover:text-default-foreground"
      }`}
    >
      <span className="shrink-0"><Icon size={24} strokeWidth={1.75} /></span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

export default function App() {
  const [view, setView] = useState(
    () => localStorage.getItem("hwoverlay.view") || "start");
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [hw, setHw] = useState<HW | null>(null);
  const [check, setCheck] = useState<LayoutCheck | null>(null);
  const [status, setStatus] = useState<AidaStatus | null>(null);
  const [auto, setAuto] = useState(true);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [quitDone, setQuitDone] = useState(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const reloadMetrics = useCallback(async () => {
    const m = await api.metrics();
    setMetrics(m.metrics);
    return m.metrics;
  }, []);

  const refreshAll = useCallback(async () => {
    const [m, c, s] = await Promise.all([
      api.metrics().catch(() => null),
      api.layoutCheck().catch(() => null),
      api.aidaStatus().catch(() => null),
    ]);
    if (m) setMetrics(m.metrics);
    setCheck(c);
    setStatus(s);
    try { setHw(await api.hw()); } catch { setHw(null); }
  }, []);

  useEffect(() => {
    refreshAll();
    const timer = setInterval(async () => {
      if (!autoRef.current) return;
      try { setHw(await api.hw()); } catch { setHw(null); }
    }, 2000);
    return () => clearInterval(timer);
  }, [refreshAll]);

  const switchView = (v: string) => {
    setView(v);
    localStorage.setItem("hwoverlay.view", v);
  };

  /** 退出：服务停掉后本页面还在浏览器里活着，切到告别页。请求失败多半是
   * 服务正在关闭、连接先断了 —— 也按退出成功处理。 */
  const doQuit = async () => {
    try {
      const rep = await api.shutdownApp();
      if (!rep.quitting) {
        addToast({ title: "没能退出", description: rep.reason, color: "danger" });
        return;
      }
    } catch { /* 连接断了 = 正在关 */ }
    setQuitDone(true);
  };

  if (quitDone) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="max-w-md px-6 text-center">
          <Power size={40} strokeWidth={1.5} className="mx-auto mb-4 text-default-400" />
          <h1 className="text-3xl font-bold leading-9 text-white">HWOverlay 已退出</h1>
          <p className="mt-3 text-sm leading-6 text-color-desc">
            OBS 叠加层已停止。要再启动，双击 HWOverlay.exe；本页面可以关掉了。
          </p>
        </div>
      </div>
    );
  }

  const shared: Shared = { metrics, hw, check, status, reloadMetrics, refreshAll, goto: switchView };

  return (
    <div className="dark bg-background font-sans text-foreground antialiased">
      {/* 侧栏：w-72 + 分隔线 + p-6，与 Now Playing 逐像素同款 */}
      <aside className="fixed inset-y-0 left-0 z-20 h-screen w-72 border-r border-divider bg-background">
        <div className="flex h-full flex-col p-6">
          <div className="mb-14 mt-4 flex items-center gap-2 px-3">
            <AudioLines size={24} strokeWidth={2.25} className="shrink-0 text-primary" />
            <span className="text-[19px] font-bold tracking-tight">HWOverlay</span>
          </div>

          <nav className="flex flex-col gap-0.5">
            {NAV.map(item => (
              <NavBtn key={item.id} label={item.label} Icon={item.Icon}
                active={view === item.id} onClick={() => switchView(item.id)} />
            ))}
          </nav>

          <div className="flex-grow" />

          <nav className="flex flex-col gap-0.5">
            <div className="flex min-h-12 items-center justify-between px-3 py-1.5">
              <span className="text-base font-medium text-default-500">自动刷新</span>
              <Switch size="sm" isSelected={auto} onValueChange={setAuto} aria-label="自动刷新" />
            </div>
            <NavBtn label="刷新数据" Icon={RefreshCw} active={false} onClick={() => refreshAll()} />
            <NavBtn label="打开叠加层" Icon={ExternalLink} active={false}
              onClick={() => window.open("/", "_blank")} />
            <NavBtn label="退出程序" Icon={Power} active={false} danger
              onClick={() => setConfirmQuit(true)} />
          </nav>
        </div>
      </aside>

      {/* 退出确认：停服务会连累 OBS 叠加层，让用户带着预期点下去 */}
      <Modal isOpen={confirmQuit} onOpenChange={setConfirmQuit} size="sm">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex-col gap-1">退出 HWOverlay？</ModalHeader>
              <ModalBody>
                <p className="text-sm leading-6 text-color-desc">
                  OBS 里的叠加层会变空白。要再启动，双击 HWOverlay.exe。
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" className="bg-[#27272a]" onPress={onClose}>取消</Button>
                <Button color="danger" onPress={() => { onClose(); doQuit(); }}>退出</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* 主体：居中列。表单类页保持 NP 的 800px；表格/编辑器这类数据密集页放宽到 1200px */}
      <main className="relative ml-72 min-h-screen">
        <div className="flex justify-center">
          <div className={`flex w-full flex-col gap-6 px-10 py-6 ${
            view === "editor" || view === "metrics" || view === "custom"
              ? "max-w-[1200px]" : "max-w-[800px]"
          }`}>
            {view === "start" && <WizardPage shared={shared} />}
            {view === "status" && <StatusPage shared={shared} />}
            {view === "editor" && <EditorPage shared={shared} />}
            {view === "custom" && <CustomMetricsPage shared={shared} />}
            {view === "metrics" && <MetricsTablePage shared={shared} />}
          </div>
        </div>
      </main>
    </div>
  );
}
