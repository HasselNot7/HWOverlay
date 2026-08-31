/** fetch 封装：全部端点与 FastAPI 一一对应；非 2xx 时尽量把后端的 JSON 错误形状透出来。 */

import type {
  AidaPlan,
  AidaStatus,
  HW,
  LayoutCheck,
  LayoutPreset,
  Metric,
  OverlayConfig,
  UnknownSensor,
} from "./types";

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function sendJSON<T>(url: string, method: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { status: r.status, ...(data as object) } as T;
}

export const api = {
  hw: () => getJSON<HW>("/hw.json"),
  overlay: () => getJSON<OverlayConfig>("/overlay.json"),
  metrics: () => getJSON<{ metrics: Metric[] }>("/metrics.json"),
  layoutCheck: () => getJSON<LayoutCheck>("/api/layout-check"),
  layoutCheckDraft: (cfg: unknown) =>
    sendJSON<LayoutCheck & { errors?: string[] }>("/api/layout-check", "POST", cfg),
  aidaStatus: () => getJSON<AidaStatus>("/api/aida/status"),
  aidaPlan: () => getJSON<AidaPlan>("/api/aida/plan"),
  saveConfig: (cfg: OverlayConfig) =>
    sendJSON<{ saved: boolean; errors?: string[]; warnings?: string[] }>(
      "/api/config", "PUT", cfg),
  rollback: () =>
    sendJSON<{ restored: boolean; errors?: string[] }>("/api/config/rollback", "POST", {}),
  unknownSensors: () =>
    getJSON<{ ok: boolean; error?: string; unknown: UnknownSensor[] }>("/api/sensors/unknown"),
  seedPresetMetrics: () =>
    sendJSON<{ added: number; ids: string[]; error?: string }>("/api/metrics/preset", "POST", {}),
  layoutPresets: () => getJSON<{ presets: LayoutPreset[] }>("/api/layout/presets"),
  addCustomMetric: (spec: { sensor_id: string; name: string; unit: string; digits: number; na_zero: boolean }) =>
    sendJSON<{ saved: boolean; error?: string }>("/api/metrics/custom", "POST", spec),
  removeCustomMetric: async (id: string) => {
    const r = await fetch(`/api/metrics/custom?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.json() as Promise<{ removed: boolean; error?: string }>;
  },
  shutdownApp: () =>
    sendJSON<{ quitting: boolean; reason?: string }>("/api/app/shutdown", "POST", { confirm: true }),
};

export const outPaths = (metrics: Metric[]): string[] =>
  metrics.filter(m => m.out).map(m => m.out!);

export const metricName = (metrics: Metric[], path: string): string =>
  metrics.find(m => m.out === path)?.name || path;

export const fmt = (v: unknown, m: Metric): string => {
  if (v == null) return "—";
  const num = typeof v === "number" ? v : parseFloat(String(v));
  if (Number.isNaN(num)) return String(v);
  const s = (num / (m.divide ?? 1)).toFixed(m.digits ?? 0);
  if (m.unit == null) return s;
  return m.unit === "%" ? `${s}%` : `${s} ${m.unit}`;
};

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
