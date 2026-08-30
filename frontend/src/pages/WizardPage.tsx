import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox } from "@heroui/react";
import { api } from "../api";
import type { AidaPlan, ApplyResult } from "../types";
import type { Shared } from "../App";

function Step({ kind, title, children }: {
  kind: "done" | "todo" | "bad";
  title: string;
  children?: React.ReactNode;
}) {
  const dot = kind === "done" ? "bg-primary border-primary"
    : kind === "bad" ? "bg-[#d0777f] border-[#d0777f]"
      : "bg-background border-warning";
  const titleColor = kind === "done" ? "text-primary" : kind === "bad" ? "text-[#d0777f]" : "text-warning";
  return (
    <li className="relative pb-4 pl-8 before:absolute before:left-2 before:top-1 before:h-3 before:w-3 before:rounded-full before:border-2 before:bg-inherit after:absolute after:left-[15px] after:top-6 after:bottom-1 after:w-px after:bg-divider last:after:hidden"
      style={{ ["--tw-before-bg" as string]: "transparent" }}>
      <span className={`absolute left-2 top-1 h-3 w-3 rounded-full border-2 ${dot}`} />
      <div className={`font-bold ${titleColor}`}>{title}</div>
      <div className="mt-1 text-[13px] text-default-400">{children}</div>
    </li>
  );
}

const DiffChips = ({ ids, kind }: { ids: string[]; kind: "add" | "del" }) => (
  <div className="mt-1.5 flex flex-wrap gap-1.5">
    {ids.map(id => (
      <span key={id}
        className={`rounded border bg-background px-1.5 py-0.5 text-xs ${
          kind === "add" ? "border-[#3f5d43] text-primary" : "border-divider text-default-500 line-through"
        }`}>
        {id}
      </span>
    ))}
  </div>
);

export default function WizardPage({ shared }: { shared: Shared }) {
  const [plan, setPlan] = useState<AidaPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "bad" | "warn" } | null>(null);
  const [busy, setBusy] = useState(false);
  const { status } = shared;

  const loadPlan = useCallback(async () => {
    try { setPlan(await api.aidaPlan()); } catch { setPlan(null); }
  }, []);

  useEffect(() => { loadPlan(); }, [loadPlan, shared.check]);

  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setMsg({ text: "应用中：关闭 AIDA64 → 写 ini → 重启 → 回读校验…", kind: "warn" });
    try {
      const rep: ApplyResult = await api.aidaApply(plan.needed_count);
      if (!rep.applied) {
        setMsg({ text: `✗ ${rep.reason || "未应用"}`, kind: "bad" });
      } else {
        setMsg({
          text: rep.rolled_back ? "✗ 已应用，但回读发现截断，已自动回滚——请减少指标"
            : "✓ 已应用，共享内存已更新",
          kind: rep.rolled_back ? "bad" : "ok",
        });
        await shared.refreshAll();
        await loadPlan();
      }
    } catch (e) {
      setMsg({ text: `✗ 请求失败：${e}`, kind: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const step2 = () => {
    if (!plan) return <Step kind="todo" title="② 读取导出清单…"><span /></Step>;
    if (plan.unchanged) {
      return <Step kind="done" title="② 导出清单与版式一致"><span /></Step>;
    }
    if (!plan.fits) {
      return (
        <Step kind="bad" title="② 版式需要的传感器超出 4096 预算">
          最坏 {plan.budget_new.worst_bytes} 字节 &gt; 可用 {plan.budget_new.usable}，
          从第 {(plan.budget_new.truncated_at ?? 0) + 1} 个起会被截断。回编辑器去掉几个小指标。
        </Step>
      );
    }
    return (
      <Step kind="todo" title={`② 导出清单需要调整（加 ${plan.to_add.length} / 减 ${plan.to_remove.length}）`}>
        {plan.to_add.length > 0 && <div>需增加 {plan.to_add.length} 个<DiffChips ids={plan.to_add} kind="add" /></div>}
        {plan.to_remove.length > 0 && <div className="mt-2">可移除 {plan.to_remove.length} 个<DiffChips ids={plan.to_remove} kind="del" /></div>}
        <div className="mt-2">预算 {plan.budget_now.worst_bytes} → {plan.budget_new.worst_bytes} / {plan.budget_new.usable} 字节</div>
        <div className="mt-3 flex items-center gap-3">
          <Checkbox isSelected={confirmed} onValueChange={setConfirmed} size="sm">
            <span className="text-[13px] text-default-400">
              我确认：这会关闭并重启 AIDA64，期间 OSD / 信息板会断流
            </span>
          </Checkbox>
          <Button
            color="primary" size="sm" isDisabled={!confirmed || busy} isLoading={busy}
            onPress={apply} className="font-bold"
          >
            应用并重启 AIDA64
          </Button>
        </div>
        <div className="mt-2">原理：AIDA64 只把 HWMonExtAppItems 列出的传感器写进共享内存，且退出时才回写 ini。</div>
      </Step>
    );
  };

  const step1 = !status ? (
    <Step kind="todo" title="① 连接 AIDA64"><span>检测中…</span></Step>
  ) : !status.running || !status.ini ? (
    <Step kind="bad" title="① 连接 AIDA64">
      <div>{status.running ? "AIDA64 在跑，但共享内存读不到" : "AIDA64 没在运行"}</div>
      <div className="mt-1">{status.install || "没找到安装目录（绿色版请先启动一次 AIDA64）"}</div>
    </Step>
  ) : (
    <Step kind="done" title="① AIDA64 已连接">
      导出 {status.exported_ids.length} 个传感器 · 共享内存 {status.shm_bytes}/{status.shm_limit} 字节 = {status.shm_pct}%
    </Step>
  );

  const msgColor = msg?.kind === "ok" ? "text-primary" : msg?.kind === "bad" ? "text-[#d0777f]" : "text-warning";

  return (
    <>
      <h1 className="mb-5 text-[21px] font-bold">开始使用</h1>
      <div className="rounded-2xl border border-divider bg-content1 p-6 shadow-lg">
        <ol className="m-0 list-none p-0">
          {step1}
          {step2()}
          <Step kind="done" title="③ 在 OBS 里添加“浏览器”源">
            <div>URL {location.origin}/　宽 {shared.check?.canvas_w ?? "—"}　高 {shared.check?.canvas_h ?? "—"}</div>
            <div className="mt-1">改过版式后要在浏览器源属性里点“刷新缓存”，否则 OBS 还是旧页面。</div>
          </Step>
        </ol>
        {msg && <div className={`mt-2 text-[13px] ${msgColor}`}>{msg.text}</div>}
      </div>
    </>
  );
}
