import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Metric, UnknownSensor } from "../types";
import type { Shared } from "../App";

/** "未知传感器"一键做成指标 + 自定义指标管理。 */
export default function CustomMetricsPage({ shared }: { shared: Shared }) {
  const [unknown, setUnknown] = useState<{ ok: boolean; error?: string; unknown: UnknownSensor[] } | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const reload = useCallback(async () => {
    try { setUnknown(await api.unknownSensors()); } catch { setUnknown(null); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const afterChange = async () => {
    await shared.reloadMetrics();   // 编辑器下拉/总表立即可见
    await reload();
  };

  const remove = async (id: string) => {
    await api.removeCustomMetric(id);
    await afterChange();
  };

  const customs = (shared.metrics || []).filter(m => m.custom);

  return (
    <>
      <h1 className="mb-5 text-[21px] font-bold">自定义指标</h1>
      <div className="rounded-2xl border border-divider bg-content1 p-5 shadow-lg">
        <h2 className="mb-3 text-sm font-bold before:mr-1.5 before:text-primary before:content-['▍']">未知传感器</h2>
        <p className="mb-3 rounded-lg border border-divider bg-[#17171a] p-2 text-xs text-default-500">
          AIDA64 在导出、但还没注册成指标的传感器。注册后编辑器的下拉和
          勾选列表里就能选它，叠加层才能显示 —— 这一步不用改任何文件。
        </p>

        {customs.length > 0 && (
          <div className="mb-3">
            <div className="mb-1.5 text-xs text-default-500">已注册的自定义指标：</div>
            <div className="flex flex-wrap gap-2">
              {customs.map((m: Metric) => (
                <span key={m.id}
                  className="flex items-center gap-2 rounded-lg border border-divider bg-content2 px-2.5 py-1 text-xs">
                  {m.name}
                  <span className="text-[11px] text-default-500">{m.out}</span>
                  <button
                    className="text-default-500 hover:text-[#d0777f]"
                    title="删除这个自定义指标"
                    onClick={() => remove(m.id)}
                  >删</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {!unknown ? (
          <span className="text-xs text-default-500">载入中…</span>
        ) : !unknown.ok ? (
          <div className="text-[13px] text-[#d0777f]">{unknown.error}</div>
        ) : unknown.unknown.length === 0 ? (
          <div className="text-[13px] text-primary">✓ 没有未知传感器 —— AIDA64 导出的都有归属。</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                {["传感器", "AIDA64 名称", "当前值", ""].map(h => (
                  <th key={h} className="border-b border-divider px-2 py-1.5 text-left text-xs font-normal text-default-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unknown.unknown.map(s => (
                <tr key={s.id} className="border-b border-divider">
                  <td className="px-2 py-1.5"><code className="rounded bg-[#17171a] px-1.5 py-0.5 text-xs">{s.id}</code></td>
                  <td className="px-2 py-1.5">{s.label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.value}</td>
                  <td className="px-2 py-1.5">
                    {openForm === s.id
                      ? <UnknownForm sensor={s} onDone={() => { setOpenForm(null); setErr(""); afterChange(); }} />
                      : (
                        <button
                          className="rounded-md bg-content2 px-2 py-0.5 text-xs text-default-400 hover:text-foreground"
                          title="起个名字、填个单位，注册成可以在版式里用的指标"
                          onClick={() => { setOpenForm(s.id); setErr(""); }}
                        >做成指标</button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {err && <div className="mt-2 text-[13px] text-[#d0777f]">{err}</div>}
      </div>
    </>
  );
}

function UnknownForm({ sensor, onDone }: { sensor: UnknownSensor; onDone: () => void }) {
  const [name, setName] = useState(sensor.label);
  const [unit, setUnit] = useState("");
  const [digits, setDigits] = useState(0);
  const [naZero, setNaZero] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const rep = await api.addCustomMetric({
        sensor_id: sensor.id, name, unit, digits, na_zero: naZero,
      });
      if (!rep.saved) setError(rep.error || "加入失败");
      else onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "rounded-lg border border-transparent bg-content2 px-2.5 py-1 text-xs text-foreground " +
    "transition-colors hover:bg-[#2a2a2f] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input type="text" value={name} size={14} onChange={e => setName(e.target.value)}
        className={inputCls} title="显示在叠加层上的名字" />
      <input type="text" value={unit} size={7} placeholder="单位，如 °C"
        onChange={e => setUnit(e.target.value)} className={inputCls} />
      <input type="number" value={digits} min={0} max={2}
        onChange={e => setDigits(+e.target.value)} className={`${inputCls} w-14`} title="小数位数" />
      <label className="inline-flex items-center gap-1 text-xs text-default-500">
        <input type="checkbox" checked={naZero} onChange={e => setNaZero(e.target.checked)} className="accent-primary" />
        0 当无数据
      </label>
      <button
        disabled={busy}
        onClick={submit}
        className="rounded-md bg-content2 px-2 py-0.5 text-xs text-primary hover:text-foreground disabled:opacity-40"
      >加入</button>
      <button onClick={onDone}
        className="rounded-md bg-content2 px-2 py-0.5 text-xs text-default-400 hover:text-foreground">取消</button>
      {error && <span className="text-xs text-[#d0777f]">{error}</span>}
    </span>
  );
}
