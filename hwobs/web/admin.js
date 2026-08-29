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

/* ---------- 首启向导 ---------- */

let PLAN = null;

function diffList(ids, cls) {
  const d = el('div', 'diff ' + cls);
  ids.forEach(i => d.append(el('span', null, i)));
  return d;
}

function step(cls, title, kids) {
  return el('li', cls, [el('div', 'st', title)].concat(kids || []));
}

function setWmsg(text, cls) {
  const m = $('#w-msg');
  if (m) { m.textContent = text; m.className = cls || 'src'; }
}

function renderWizard() {
  const st = state.status, host = $('#w-steps');
  if (!st) return host.replaceChildren(el('li', 'todo', '检测中…'));
  const steps = [];

  if (!st.running || !st.ini) {
    steps.push(step('bad', '① 连接 AIDA64', [
      el('div', null, st.running ? 'AIDA64 在跑，但共享内存读不到' : 'AIDA64 没在运行'),
      el('div', 'src', st.install || '没找到安装目录（绿色版请先启动一次 AIDA64）')]));
  } else {
    steps.push(step('done', '① AIDA64 已连接', [
      el('div', 'src', `导出 ${st.current_count ?? st.exported_ids.length} 个传感器 · 共享内存 `
        + `${st.shm_bytes}/${st.shm_limit} 字节 = ${st.shm_pct}%`)]));
  }

  if (!PLAN) {
    steps.push(el('li', 'todo', '② 读取导出清单…'));
  } else if (PLAN.unchanged) {
    steps.push(step('done', '② 导出清单与版式一致', []));
  } else if (!PLAN.fits) {
    steps.push(step('bad', '② 版式需要的传感器超出 4096 预算', [
      el('div', 'warnbox', `最坏 ${PLAN.budget_new.worst_bytes} 字节 > 可用 ${PLAN.budget_new.usable}，`
        + `从第 ${PLAN.budget_new.truncated_at + 1} 个起会被截断。回编辑器去掉几个小指标。`)]));
  } else {
    const kids = [];
    if (PLAN.to_add.length) kids.push(el('div', 'src', `需增加 ${PLAN.to_add.length} 个`), diffList(PLAN.to_add, 'add'));
    if (PLAN.to_remove.length) kids.push(el('div', 'src', `可移除 ${PLAN.to_remove.length} 个`), diffList(PLAN.to_remove, 'del'));
    kids.push(el('div', 'src', `预算 ${PLAN.budget_now.worst_bytes} → ${PLAN.budget_new.worst_bytes} / `
      + `${PLAN.budget_new.usable} 字节`));
    const cb = el('input'); cb.type = 'checkbox'; cb.id = 'w-confirm';
    const btn = el('button'); btn.textContent = '应用并重启 AIDA64'; btn.disabled = true;
    btn.addEventListener('click', () => onApply(btn));
    cb.addEventListener('change', () => { btn.disabled = !cb.checked; });
    kids.push(el('div', 'confirm', [cb,
      el('label', null, '我确认：这会关闭并重启 AIDA64，期间 OSD / 信息板会断流'), btn]));
    kids.push(el('div', 'src', '原理：AIDA64 只把 HWMonExtAppItems 列出的传感器写进共享内存，且退出时才回写 ini。'));
    steps.push(step('todo', `② 导出清单需要调整（加 ${PLAN.to_add.length} / 减 ${PLAN.to_remove.length}）`, kids));
  }

  steps.push(step('done', '③ 在 OBS 里添加"浏览器"源', [
    el('div', 'src', `URL ${location.origin}/　宽 ${state.check?.canvas_w ?? '—'}　高 ${state.check?.canvas_h ?? '—'}`),
    el('div', 'src', '改过版式后要在浏览器源属性里点"刷新缓存"，否则 OBS 还是旧页面。')]));

  host.replaceChildren(...steps);
  const msg = el('div', 'src');
  msg.id = 'w-msg';
  host.append(msg);
}

async function onApply(btn) {
  btn.disabled = true;
  setWmsg('应用中：关闭 AIDA64 → 写 ini → 重启 → 回读校验…', 'warnbox');
  let rep;
  try {
    const r = await fetch('/api/aida/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ confirm: true, expect_count: PLAN.needed_count }),
    });
    rep = await r.json();
  } catch (e) {
    setWmsg('✗ 请求失败：' + e, 'bad');
    btn.disabled = false;
    return;
  }
  if (!rep.applied) {
    setWmsg('✗ ' + (rep.reason || '未应用'), 'bad');
    btn.disabled = false;
    return;
  }
  setWmsg('✓ 已应用' + (rep.rolled_back ? '，但回读发现截断，已自动回滚——请减少指标' : '，共享内存已更新'),
          rep.rolled_back ? 'bad' : 'ok');
  await refreshAll();
  await loadPlan();
  reloadPreview();
}

async function loadPlan() {
  try { PLAN = await getJSON('/api/aida/plan'); } catch (e) { PLAN = null; }
  renderWizard();
}

/* ---------- 编辑器 ---------- */

let CFG = null;        // 磁盘上的版本
let draft = null;      // 正在改的版本
let dirty = false;
let debounce = null;

const clone = o => JSON.parse(JSON.stringify(o));
const chipsRow = () => draft.rows.find(r => r.type === 'chips');
const cardsRow = () => draft.rows.find(r => r.type === 'cards');

function pathsUsedByCards() {
  const used = new Set();
  for (const c of (cardsRow()?.items || [])) {
    if (c.bar) used.add(c.bar);
    if (c.spark) used.add(c.spark);
    for (const m of (c.value?.metrics || [])) used.add(typeof m === 'string' ? m : m.metric);
    for (const m of (c.sub?.metrics || [])) used.add(typeof m === 'string' ? m : m.metric);
  }
  return used;
}

async function postJSON(url, body) {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body),
                              headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
  return { status: r.status, data: await r.json() };
}

function buildEditor() {
  $('#e-w').value = draft.canvas.w;
  $('#e-h').value = draft.canvas.h;
  $('#e-cols').value = cardsRow()?.cols ?? 4;

  const labels = $('#e-labels');
  labels.replaceChildren(...(cardsRow()?.items || []).map((c, i) => {
    const inp = el('input');
    inp.type = 'text'; inp.value = c.label; inp.size = 22;
    inp.addEventListener('input', () => { c.label = inp.value; onChange(); });
    return el('label', null, [el('span', 'src', `卡${i + 1} 标题`), inp]);
  }));

  const inChips = new Set(chipsRow()?.items || []);
  const usedByCards = pathsUsedByCards();
  const box = $('#e-chips');
  box.replaceChildren(...METRICS.metrics.filter(m => m.out).map(m => {
    const cb = el('input');
    cb.type = 'checkbox'; cb.checked = inChips.has(m.out);
    cb.addEventListener('change', () => {
      const items = chipsRow().items.filter(x => x !== m.out);
      if (cb.checked) items.push(m.out);
      chipsRow().items = items;
      onChange();
    });
    return el('label', null, [cb, el('span', null, m.name),
      el('span', 'path', m.out), usedByCards.has(m.out) ? el('span', 'inuse', '卡片在用') : null]
      .filter(Boolean));
  }));

  ['e-w', 'e-h', 'e-cols'].forEach(id => $('#' + id).addEventListener('change', () => {
    draft.canvas.w = +$('#e-w').value;
    draft.canvas.h = +$('#e-h').value;
    cardsRow().cols = +$('#e-cols').value;
    onChange();
  }));
}

function setMsg(text, cls) {
  const m = $('#e-msg');
  m.textContent = text;
  m.className = cls || '';
}

async function onChange() {
  dirty = JSON.stringify(draft) !== JSON.stringify(CFG);
  clearTimeout(debounce);
  setMsg(dirty ? '校验中…' : '', '');
  debounce = setTimeout(async () => {
    const { data } = await postJSON('/api/layout-check', draft);
    if (data.errors?.length) {
      setMsg(`✗ ${data.errors.join('；')}`, 'bad');
      $('#e-save').disabled = true;
    } else {
      setMsg(dirty ? (data.warnings?.length ? `可保存（${data.warnings.length} 条提醒）` : '可保存')
                   : '没有改动', dirty ? 'warn' : '');
      $('#e-save').disabled = !dirty;
    }
    state.check = data;
    renderBudget();
    renderCheck();
  }, 350);
}

async function onSave() {
  const r = await fetch('/api/config', { method: 'PUT', body: JSON.stringify(draft),
                                         headers: { 'Content-Type': 'application/json' } });
  const rep = await r.json();
  if (!rep.saved) return setMsg(`✗ 保存失败：${(rep.errors || []).join('；')}`, 'bad');
  CFG = clone(draft);
  await onChange();
  reloadPreview();
  setMsg('✓ 已保存。OBS 里若没变化，点浏览器源的"刷新缓存"。', 'ok');
}

function reloadPreview() {
  $('#pv').src = `/?t=${Date.now()}`;
}

async function onUndo() {
  const { data } = await postJSON('/api/config/rollback', {});
  if (!data.restored) return setMsg(`✗ ${data.errors.join('；')}`, 'bad');
  await loadConfig();
  reloadPreview();
  setMsg('✓ 已还原到上一版', 'ok');
}

async function loadConfig() {
  CFG = await getJSON('/overlay.json');
  draft = clone(CFG);
  buildEditor();
  dirty = false;
  $('#e-save').disabled = true;
}

$('#e-save').addEventListener('click', onSave);
$('#e-undo').addEventListener('click', onUndo);

let timer = null;
function setAuto(on) {
  if (timer) clearInterval(timer);
  timer = on ? setInterval(refreshFast, 2000) : null;
}

$('#refresh').addEventListener('click', () => { refreshAll(); loadPlan(); });
$('#auto').addEventListener('change', e => setAuto(e.target.checked));

refreshAll().then(async () => {
  await loadConfig();
  await loadPlan();
  reloadPreview();
  setAuto($('#auto').checked);
});
