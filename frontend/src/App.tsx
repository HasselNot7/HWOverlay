import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AidaStatus, HW, LayoutCheck, Metric } from "./types";
import WizardPage from "./pages/WizardPage";
import StatusPage from "./pages/StatusPage";
import EditorPage from "./pages/EditorPage";
import CustomMetricsPage from "./pages/CustomMetricsPage";
import MetricsTablePage from "./pages/MetricsTablePage";

const NAV = [
  { id: "start", label: "开始使用", icon: <circle cx="8" cy="8" r="6.5" /> },
  { id: "status", label: "状态总览", icon: <path d="M1 8.5h3l2-5 3.5 9 2-4H15" /> },
  {
    id: "editor",
    label: "版式编辑",
    icon: (
      <>
        <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
        <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
        <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
        <path d="M9 11.5h5.5M11.75 9v5.5" />
      </>
    ),
  },
  { id: "custom", label: "自定义指标", icon: <path d="M8 1.5v13M1.5 8h13" /> },
  { id: "metrics", label: "指标总表", icon: <path d="M2 4h12M2 8h12M2 12h8" /> },
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
      <aside className="fixed inset-y-0 left-0 z-10 flex w-56 flex-col border-r border-divider bg-[#151517] px-3 py-5">
        <div className="px-2.5 pb-5">
          <div className="text-base font-bold before:text-primary before:content-['▍']">
            HWOverlay
          </div>
          <div className="mt-0.5 text-[11.5px] text-default-500">直播硬件叠加层</div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(item => (
            <button
              key={item.id}
              onClick={() => switchView(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors ${
                view === item.id
                  ? "bg-[#26262b] text-foreground"
                  : "text-default-500 hover:bg-[#1e1e22] hover:text-foreground"
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                className={`h-4 w-4 flex-none ${view === item.id ? "stroke-primary" : ""}`}
                fill="none" stroke="currentColor" strokeWidth="1.4"
                strokeLinejoin="round" strokeLinecap="round"
              >
                {item.icon}
              </svg>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2.5 px-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-default-500">
            <input
              type="checkbox"
              checked={auto}
              onChange={e => setAuto(e.target.checked)}
              className="accent-primary"
            />
            自动刷新
          </label>
          <Button_like onClick={() => refreshAll()}>刷新数据</Button_like>
          <a
            href="/" target="_blank" rel="noreferrer"
            className="rounded-lg border border-transparent bg-content2 px-3 py-1.5 text-center text-xs text-default-500 transition-colors hover:text-foreground"
          >
            打开叠加层 ↗
          </a>
        </div>
      </aside>

      <main className="ml-56 flex-1 px-11 py-8">
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

/** 侧栏底部的小按钮（HeroUI Button 在这里太重，一个轻量替身） */
function Button_like({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-transparent bg-content2 px-3 py-1.5 text-center text-xs text-default-500 transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}
