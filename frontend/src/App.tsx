import { Button, Switch } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { House, Activity, LayoutGrid, FlaskConical, Table2, RefreshCw, ExternalLink } from "lucide-react";
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
}

export default function App() {
  const [view, setView] = useState(
    () => localStorage.getItem("hwoverlay.view") || "start");
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [hw, setHw] = useState<HW | null>(null);
  const [check, setCheck] = useState<LayoutCheck | null>(null);
  const [status, setStatus] = useState<AidaStatus | null>(null);
  const [auto, setAuto] = useState(true);
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

  const shared: Shared = { metrics, hw, check, status, reloadMetrics, refreshAll };

  return (
    <div className="flex h-full">
      <aside className="fixed inset-y-0 left-0 z-10 flex w-60 flex-col border-r border-divider bg-[#151516] px-3.5 py-6">
        <div className="px-2.5 pb-6">
          <div className="text-lg font-bold before:mr-1 before:text-primary before:content-['▍']">
            HWOverlay
          </div>
          <div className="mt-0.5 text-xs text-default-500">直播硬件叠加层</div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(item => (
            <button
              key={item.id}
              onClick={() => switchView(item.id)}
              className={`flex h-11 w-full items-center gap-3 rounded-xl px-3.5 text-left text-sm transition-colors ${
                view === item.id
                  ? "bg-content3 text-foreground"
                  : "text-default-400 hover:bg-content2 hover:text-foreground"
              }`}
            >
              <item.Icon
                className={`h-[18px] w-[18px] flex-none ${view === item.id ? "text-primary" : ""}`}
                size={18}
              />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 px-1.5">
          <Switch size="sm" isSelected={auto} onValueChange={setAuto}>
            <span className="text-xs text-default-500">自动刷新</span>
          </Switch>
          <Button size="sm" variant="flat" startContent={<RefreshCw size={14} />}
            onPress={() => refreshAll()}>刷新数据</Button>
          <Button size="sm" variant="flat"
            startContent={<ExternalLink size={14} />}
            onPress={() => window.open("/", "_blank")}
          >打开叠加层</Button>
        </div>
      </aside>

      <main className="ml-60 flex-1 px-11 py-9">
        <div className="mx-auto max-w-[960px]">
          {view === "start" && <WizardPage shared={shared} />}
          {view === "status" && <StatusPage shared={shared} />}
          {view === "editor" && <EditorPage shared={shared} />}
          {view === "custom" && <CustomMetricsPage shared={shared} />}
          {view === "metrics" && <MetricsTablePage shared={shared} />}
        </div>
      </main>
    </div>
  );
}
