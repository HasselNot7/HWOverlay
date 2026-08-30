import { Button, Checkbox, Chip, Input } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Metric, UnknownSensor } from "../types";
import type { Shared } from "../App";
import { CARD_CLS, Hint, Page, Section } from "../ui";

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
    <Page title="自定义指标">
      <Section title="未知传感器">
        <Hint>
          AIDA64 在导出、但还没注册成指标的传感器。注册后编辑器的下拉和
          勾选列表里就能选它，叠加层才能显示 —— 这一步不用改任何文件。
        </Hint>

        {customs.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-color-desc">已注册的自定义指标：</span>
            {customs.map((m: Metric) => (
              <Chip key={m.id} size="sm" variant="bordered"
                endContent={
                  <button
                    className="text-xs text-default-400 transition-colors hover:text-danger"
                    title="删除这个自定义指标" onClick={() => remove(m.id)}
                  >删</button>
                }
              >
                <span className="text-sm">{m.name}
                  <span className="ml-1.5 font-poppins text-[11px] text-default-500">{m.out}</span>
                </span>
              </Chip>
            ))}
          </div>
        )}

        <div className={`mt-3 ${CARD_CLS} px-4 py-2`}>
          {!unknown ? (
            <Hint>载入中…</Hint>
          ) : !unknown.ok ? (
            <div className="py-1 text-sm text-danger">{unknown.error}</div>
          ) : unknown.unknown.length === 0 ? (
            <div className="py-1 text-sm text-success">✓ 没有未知传感器 —— AIDA64 导出的都有归属。</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["传感器", "AIDA64 名称", "当前值", ""].map(h => (
                    <th key={h}
                      className="border-b border-white/[0.04] px-2 py-2 text-left text-xs font-normal text-default-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unknown.unknown.map(s => (
                  <tr key={s.id} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-2 py-2">
                      <code className="rounded-md bg-default-100 px-1.5 py-0.5 font-poppins text-xs">{s.id}</code>
                    </td>
                    <td className="px-2 py-2">{s.label}</td>
                    <td className="px-2 py-2 text-right font-poppins tabular-nums">{s.value}</td>
                    <td className="px-2 py-2">
                      {openForm === s.id
                        ? <UnknownForm sensor={s} onDone={() => { setOpenForm(null); setErr(""); afterChange(); }} />
                        : (
                          <Button size="sm" variant="flat" title="起个名字、填个单位，注册成可以在版式里用的指标"
                            onPress={() => { setOpenForm(s.id); setErr(""); }}>做成指标</Button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {err && <div className="mt-2 text-sm text-danger">{err}</div>}
      </Section>
    </Page>
  );
}

function UnknownForm({ sensor, onDone }: { sensor: UnknownSensor; onDone: () => void }) {
  const [name, setName] = useState(sensor.label);
  const [unit, setUnit] = useState("");
  const [digits, setDigits] = useState("0");
  const [naZero, setNaZero] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const rep = await api.addCustomMetric({
        sensor_id: sensor.id, name, unit, digits: +digits || 0, na_zero: naZero,
      });
      if (!rep.saved) setError(rep.error || "加入失败");
      else onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input size="sm" variant="flat" className="w-40 font-poppins" placeholder="名字"
        value={name} onValueChange={setName} />
      <Input size="sm" variant="flat" className="w-28 font-poppins" placeholder="单位，如 °C"
        value={unit} onValueChange={setUnit} />
      <Input size="sm" variant="flat" type="number" className="w-20 font-poppins" placeholder="小数位"
        value={digits} onValueChange={setDigits} />
      <Checkbox size="sm" isSelected={naZero} onValueChange={setNaZero}>
        <span className="text-xs text-color-desc">0 当无数据</span>
      </Checkbox>
      <Button size="sm" color="primary" isDisabled={busy} onPress={submit}>加入</Button>
      <Button size="sm" variant="light" onPress={onDone}>取消</Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
