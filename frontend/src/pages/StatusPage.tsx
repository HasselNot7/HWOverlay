import type { Shared } from "../App";

const Pill = ({ text, kind }: { text: string; kind: "ok" | "warn" | "bad" | "" }) => {
  const color = kind === "ok" ? "text-primary border-[#3f5d43] bg-[#1d2620]"
    : kind === "warn" ? "text-warning border-[#6a5a33] bg-[#262219]"
      : kind === "bad" ? "text-[#d0777f] border-[#6a4048] bg-[#261c1e]"
        : "text-default-400";
  return <span className={`inline-block rounded-full border px-2.5 text-xs leading-5 ${color}`}>{text}</span>;
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-divider bg-content1 p-5 shadow-lg">
      <h2 className="mb-3.5 text-sm font-bold before:mr-1.5 before:text-primary before:content-['▍']">{title}</h2>
      {children}
    </div>
  );
}

const Kv = ({ k, v, cls }: { k: string; v: React.ReactNode; cls?: string }) => (
  <>
    <dt className="whitespace-nowrap text-default-500">{k}</dt>
    <dd className={`m-0 break-all ${cls ?? ""}`}>{v}</dd>
  </>
);

export default function StatusPage({ shared }: { shared: Shared }) {
  const { status: st, hw, check } = shared;
  if (!st) {
    return (
      <>
        <h1 className="mb-5 text-[21px] font-bold">状态总览</h1>
        <Panel title="数据源"><span className="text-xs text-default-500">读取中…</span></Panel>
      </>
    );
  }
  const shmColor = st.shm_pct > 90 ? "text-[#d0777f]" : st.shm_pct > 75 ? "text-warning" : "text-primary";
  const s = st.windows_net_sampler;

  return (
    <>
      <h1 className="mb-5 text-[21px] font-bold">状态总览</h1>
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="数据源">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-[13px]">
            <Kv k="AIDA64" v={st.running ? <Pill text="运行中" kind="ok" /> : <Pill text="未运行" kind="bad" />} />
            <Kv k="安装目录" v={st.install || <Pill text="未找到" kind="bad" />} />
            <Kv k="ini" v={st.ini || <Pill text="未找到" kind="bad" />} />
            <Kv k="已导出传感器" v={`${st.exported_ids.length} 个`} />
            <Kv k="共享内存" cls={shmColor}
              v={`${st.shm_bytes} / ${st.shm_limit} 字节 = ${st.shm_pct}%`} />
            <Kv k="安全预算" v={`${st.usable_bytes} 字节（留 15% 余量）`} />
            <Kv k="网卡采样" v={s?.sampling
              ? <Pill text="运行中" kind="warn" />
              : <span className="text-xs text-default-500">未启动（AIDA64 在位时不需要）</span>} />
            {hw?.degraded && <Kv k="降级原因" v={hw.degraded} cls="text-warning" />}
            {hw?.missing?.length ? (
              <Kv k="AIDA64 缺这些" v={hw.missing.join(", ")} cls="text-[#d0777f]" />
            ) : null}
          </dl>
          <div className="mt-2.5 h-2 overflow-hidden rounded bg-[#17171a]">
            <div
              className={`h-full rounded transition-all ${st.shm_pct > 90 ? "bg-[#d0777f]" : st.shm_pct > 75 ? "bg-warning" : "bg-primary"}`}
              style={{ width: `${Math.min(100, st.shm_pct)}%` }}
            />
          </div>
        </Panel>

        <Panel title="导出预算">
          {check?.budget ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-[13px]">
                <Kv k="版式需要" v={`${check.budget.count} 个传感器`} />
                <Kv k="最坏占用"
                  cls={check.budget.worst_bytes > check.budget.usable ? "text-[#d0777f]" : "text-primary"}
                  v={`${check.budget.worst_bytes} / ${check.budget.usable} 字节 = ${Math.round(check.budget.worst_bytes / check.budget.usable * 100)}%`} />
                <Kv k="典型占用" v={`${check.budget.typical_bytes} 字节（按真实 label 长度算）`} />
                <Kv k="截断风险" v={check.budget.fits ? "无" :
                  `从第 ${(check.budget.truncated_at ?? 0) + 1} 个起会被 AIDA64 静默截断`} />
              </dl>
              <div className="mt-2.5 h-2 overflow-hidden rounded bg-[#17171a]">
                <div
                  className={`h-full rounded transition-all ${check.budget.worst_bytes > check.budget.usable ? "bg-[#d0777f]" : "bg-primary"}`}
                  style={{ width: `${Math.min(100, check.budget.worst_bytes / check.budget.usable * 100)}%` }}
                />
              </div>
            </>
          ) : <span className="text-xs text-default-500">载入中…</span>}
        </Panel>
      </div>

      <Panel title="OBS 里怎么填">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-[13px]">
          <Kv k="URL" v={<code className="rounded bg-[#17171a] px-1.5 py-0.5 text-xs">{location.origin}/</code>} />
          <Kv k="宽 × 高" v={`${check?.canvas_w ?? "—"} × ${check?.canvas_h ?? "—"}`} />
          <Kv k="内容预估高" v={`${check?.est_height ?? "—"} px`} />
        </dl>
        <div className="mt-2 text-[13px] text-default-400">
          OBS → 添加“浏览器”源 → 取消勾选“本地文件” → 填上面的 URL 和尺寸。
        </div>
      </Panel>
    </>
  );
}
