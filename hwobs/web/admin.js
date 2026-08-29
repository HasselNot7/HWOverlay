/* 管理页 v1：只读展示。
 * 数据来源与叠加层完全一致，避免"管理页说一套、叠加层显示另一套"。
 * /api/aida/status 会起 PowerShell，约 2 秒，所以只在进页面和点刷新时调，自动刷新只拉 /hw.json。
 */

const $ = sel => document.querySelector(sel);
const el = (tag, cls, kids) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const k of [].concat(kids ?? [])) n.append(k?.nodeType ? k : document.createTextNode(k));
  return n;
};
const dig = (obj, path) => path.split('.').reduce((n, k) => (n == null ? null : n[k]), obj);

let METRICS = null;
let state = { hw: null, check: null, status: null };

function fmt(v, m) {
  if (v == null) return '—';
  const d = m.digits ?? 0;
  const div = m.divide ?? 1;
  const s = (v / div).toFixed(d);
  return m.unit == null ? s : (m.unit === '%' ? `${s}%` : `${s} ${m.unit}`);
}

function bar(pct, cls) {
  const b = el('div', 'bar');
  const i = el('i', cls);
  i.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  b.append(i);
  return b;
}

function renderSources() {
  const { hw, status: st } = state;
  const body = $('#sources .body');
  body.replaceChildren();
  if (!st) return body.append('读取中…');

  const dl = el('dl', 'kv');
  const add = (k, v, cls) => {
    dl.append(el('dt', null, k));
    dl.append(el('dd', cls, v));
  };

  add('AIDA64', st.running ? '运行中' : '未运行', st.running ? 'ok' : 'bad');
  add('安装目录', st.install || '未找到', st.install ? null : 'bad');
  add('ini', st.ini || '未找到', st.ini ? null : 'bad');
  add('已导出传感器', `${st.exported_ids?.length ?? 0} 个`);
  add('共享内存占用', `${st.shm_bytes} / ${st.shm_limit} 字节 = ${st.shm_pct}%`,
      st.shm_pct > 90 ? 'bad' : st.shm_pct > 75 ? 'warn' : 'ok');
  add('安全预算', `${st.usable_bytes} 字节（留 15% 余量）`);
  const s = st.windows_net_sampler || {};
  add('Windows 网卡采样', s.sampling ? `运行中，上行 ${s.up_mbps ?? '—'} Mbps` : '未启动（AIDA64 在位时不需要）',
      s.sampling ? 'warn' : null);
  if (s.error) add('采样错误', s.error, 'bad');
  if (hw?.degraded) add('降级原因', hw.degraded, 'warn');
  if (hw?.missing?.length) add('AIDA64 缺这些', hw.missing.join(', '), 'bad');

  body.append(dl, bar(st.shm_pct || 0, st.shm_pct > 90 ? 'over' : st.shm_pct > 75 ? 'hi' : null));
}

function renderBudget() {
  const c = state.check;
  const body = $('#budget .body');
  body.replaceChildren();
  if (!c) return;
  const b = c.budget;
  const pct = b.worst_bytes / b.usable * 100;
  const dl = el('dl', 'kv');
  dl.append(el('dt', null, '版式需要'));
  dl.append(el('dd', null, `${b.count} 个传感器`));
  dl.append(el('dt', null, '最坏占用'));
  dl.append(el('dd', pct > 100 ? 'bad' : pct > 80 ? 'warn' : 'ok',
                         `${b.worst_bytes} / ${b.usable} 字节 = ${pct.toFixed(0)}%`));
  dl.append(el('dt', null, '典型占用'));
  dl.append(el('dd', null, `${b.typical_bytes} 字节（按真实 label 长度算）`));
  dl.append(el('dt', null, '截断风险'));
  dl.append(el('dd', b.fits ? 'ok' : 'bad',
    b.fits ? '无' : `从第 ${b.truncated_at + 1} 个起会被 AIDA64 静默截断`));
  body.append(dl, bar(pct, pct > 100 ? 'over' : pct > 80 ? 'hi' : null));
}

function renderObs() {
  const c = state.check;
  const body = $('#obs .body');
  body.replaceChildren();
  if (!c) return;
  const url = `${location.origin}/`;
  const dl = el('dl', 'kv');
  dl.append(el('dt', null, 'URL'));
  dl.append(el('dd', null, el('code', null, url)));
  dl.append(el('dt', null, '宽 × 高'));
  dl.append(el('dd', null, `${c.canvas_w} × ${c.canvas_h}`));
  dl.append(el('dt', null, '内容预估高'));
  dl.append(el('dd', c.est_height > c.canvas_h ? 'bad' : 'ok', `${c.est_height} px`));
  body.append(dl, el('div', 'dim', 'OBS → 添加"浏览器"源 → 取消勾选"本地文件" → 填上面的 URL 和尺寸。'));
}

function renderCheck() {
  const c = state.check;
  const body = $('#check .body');
  body.replaceChildren();
  if (!c) return;
  if (!c.errors.length && !c.warnings.length) {
    return body.append(el('div', 'ok', '✓ 版式无错误、无提醒'));
  }
  const frag = document.createDocumentFragment();
  if (c.errors.length) {
    const ul = el('ul', 'msgs');
    c.errors.forEach(e => ul.append(el('li', 'bad', `错误：${e}`)));
    frag.append(ul);
  }
  if (c.warnings.length) {
    const ul = el('ul', 'msgs');
    c.warnings.forEach(w => ul.append(el('li', 'warn', `提醒：${w}`)));
    frag.append(ul);
  }
  body.append(frag);
}

function renderMetrics() {
  const { hw, check } = state;
  const body = $('#metrics .body');
  body.replaceChildren();
  if (!METRICS || !hw) return;
  const used = new Set(check?.referenced || []);
  const table = el('table');
  const head = el('tr');
  ['指标', '当前值', '来源', '用于版式', '候选传感器 ID'].forEach(h => head.append(el('th', null, h)));
  table.append(head);

  for (const m of METRICS.metrics) {
    const out = m.out || m.id;
    const v = m.out ? dig(hw, m.out) : null;
    const src = hw.sources?.[m.id];
    const tr = el('tr', used.has(out) ? (src ? null : 'missing') : 'unused');
    tr.append(el('td', null, `${m.name}${m.rate_untrusted ? ' ⚠' : ''}`));
    tr.append(el('td', 'num', fmt(v, m)));
    tr.append(el('td', 'src', src || '无数据'));
    tr.append(el('td', null, used.has(out) ? '是' : '—'));
    tr.append(el('td', 'src', (m.sources?.aida64 || []).join(' ') || `${m.agg || 'winapi'}`));
    table.append(tr);
  }
  body.append(table,
    el('div', 'src', '⚠ = 速率类，单位由 AIDA64 自动换算且不带字段，已按实测标定；灰色行是版式没用到的指标。'));
}

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  return r.json();
}

async function refreshFast() {
  try { state.hw = await getJSON('/hw.json'); } catch (e) { state.hw = null; }
  renderSources();
  renderMetrics();
}

async function refreshAll() {
  METRICS = METRICS || await getJSON('/metrics.json');
  const [check, status] = await Promise.all([getJSON('/api/layout-check'), getJSON('/api/aida/status')]);
  state.check = check;
  state.status = status;
  await refreshFast();
  renderBudget();
  renderObs();
  renderCheck();
}

let timer = null;
function setAuto(on) {
  if (timer) clearInterval(timer);
  timer = on ? setInterval(refreshFast, 2000) : null;
}

$('#refresh').addEventListener('click', refreshAll);
$('#auto').addEventListener('change', e => setAuto(e.target.checked));
refreshAll().then(() => setAuto($('#auto').checked));
