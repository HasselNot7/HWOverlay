import { Chip, Progress } from "@heroui/react";
import type { Shared } from "../App";
import { Hint, Page, Section } from "../ui";

const StateChip = ({ text, kind }: { text: string; kind: "ok" | "warn" | "bad" }) => (
  <Chip size="sm" variant="dot"
    color={kind === "ok" ? "success" : kind === "warn" ? "warning" : "danger"}>
    {text}
  </Chip>
);

/** 单行信息：左边名称，右边数值（Now Playing 开关行的那套左右结构）。 */
const Row = ({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) => (
  <div className="flex w-full items-center justify-between gap-4 py-1.5">
    <div className="flex flex-col gap-[2px]">
      <span className="text-base">{k}</span>
      {sub && <span className="text-sm text-color-desc">{sub}</span>}
    </div>
    <span className="text-right text-base font-poppins">{v}</span>
  </div>
);

export default function StatusPage({ shared }: { shared: Shared }) {
  const { status: st, hw, check } = shared;
  if (!st) {
    return (
      <Page title="状态总览">
        <Section title="数据源" divider={false}>
          <Hint>读取中…</Hint>
        </Section>
      </Page>
    );
  }
  const shmColor = st.shm_pct > 90 ? "text-danger" : st.shm_pct > 75 ? "text-warning" : "text-primary";
  const s = st.windows_net_sampler;

  return (
    <Page title="状态总览">
      <Section title="数据源">
        <div className="flex flex-col">
          <Row k="AIDA64" v={st.running
            ? <StateChip text="运行中" kind="ok" />
            : <StateChip text="未运行" kind="bad" />} />
          <Row k="安装目录" v={<span className="text-sm text-color-desc">{st.install || "未找到"}</span>} />
          <Row k="ini" v={<span className="break-all text-sm font-poppins text-color-desc">{st.ini || "未找到"}</span>} />
          <Row k="已导出传感器" v={`${st.exported_ids.length} 个`} />
          <Row k="共享内存" sub={`安全预算 ${st.usable_bytes} 字节（留 15% 余量）`}
            v={<span className={shmColor}>{st.shm_bytes} / {st.shm_limit} 字节 = {st.shm_pct}%</span>} />
          <Row k="网卡采样" v={s?.sampling
            ? <StateChip text="运行中" kind="warn" />
            : <span className="text-sm text-color-desc">未启动（AIDA64 在位时不需要）</span>} />
          {hw?.degraded && <Row k="降级原因" v={<span className="text-sm text-warning">{hw.degraded}</span>} />}
          {hw?.missing?.length ? (
            <Row k="AIDA64 缺这些" v={<span className="text-sm font-poppins text-danger">{hw.missing.join(", ")}</span>} />
          ) : null}
        </div>
        <Progress
          aria-label="共享内存占用" size="sm" className="mt-3"
          value={Math.min(100, st.shm_pct)}
          color={st.shm_pct > 90 ? "danger" : st.shm_pct > 75 ? "warning" : "primary"}
        />
      </Section>

      <Section title="导出预算">
        {check?.budget ? (
          <>
            <div className="flex flex-col">
              <Row k="版式需要" v={`${check.budget.count} 个传感器`} />
              <Row k="最坏占用" sub="按 label 最长的情况估算"
                v={<span className={check.budget.worst_bytes > check.budget.usable ? "text-danger" : "text-primary"}>
                  {check.budget.worst_bytes} / {check.budget.usable} 字节 = {Math.round(check.budget.worst_bytes / check.budget.usable * 100)}%
                </span>} />
              <Row k="典型占用" sub="按真实 label 长度算" v={`${check.budget.typical_bytes} 字节`} />
              <Row k="截断风险" v={check.budget.fits ? <StateChip text="无" kind="ok" />
                : <span className="text-sm text-warning">从第 {(check.budget.truncated_at ?? 0) + 1} 个起会被 AIDA64 静默截断</span>} />
            </div>
            <Progress
              aria-label="预算占用" size="sm" className="mt-3"
              value={Math.min(100, check.budget.worst_bytes / check.budget.usable * 100)}
              color={check.budget.worst_bytes > check.budget.usable ? "danger" : "primary"}
            />
          </>
        ) : <Hint>载入中…</Hint>}
      </Section>

      <Section title="OBS 里怎么填" divider={false}>
        <div className="flex flex-col">
          <Row k="URL" v={<code className="rounded-md bg-default-100 px-2 py-1 text-sm font-poppins">{location.origin}/</code>} />
          <Row k="宽 × 高" v={`${check?.canvas_w ?? "—"} × ${check?.canvas_h ?? "—"}`} />
          <Row k="内容预估高" v={`${check?.est_height ?? "—"} px`} />
        </div>
        <Hint className="mt-2">
          OBS → 添加“浏览器”源 → 取消勾选“本地文件” → 填上面的 URL 和尺寸。
        </Hint>
      </Section>
    </Page>
  );
}
