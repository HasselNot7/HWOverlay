/* 管理页。
 * 数据来源与叠加层完全一致，避免"管理页说一套、叠加层显示另一套"。
 * /api/aida/status 会起 PowerShell，约 2 秒，所以只在进页面和点刷新时调，自动刷新只拉 /hw.json。
 *
 * 编辑器 v2：直接编辑 draft.widgets 部件数组。
 * 版式树"哪些路径被用到"不在这里重算 —— 服务端校验响应里的 referenced 是唯一事实
 * （历史上前端自己数过一遍，键集合和服务端不一致，就是 e2e567e 那类 bug 的温床）。
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
  sizePreview(c.canvas_w, c.canvas_h);
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

/* ---------- 编辑器：部件数组直编 ---------- */

let CFG = null;        // 磁盘上的版本
let draft = null;      // 正在改的版本
let dirty = false;
let debounce = null;

const clone = o => JSON.parse(JSON.stringify(o));
const outPaths = () => (METRICS?.metrics || []).filter(m => m.out).map(m => m.out);
const usedPaths = () => new Set(state.check?.referenced || []);
const nextKey = () => {
  const keys = new Set((draft.widgets || []).flatMap(w => (w.items || []).map(c => c.key)));
  let i = 1;
  while (keys.has('card' + i)) i += 1;
  return 'card' + i;
};

async function postJSON(url, body) {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify(body),
                              headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
  return { status: r.status, data: await r.json() };
}

function metricSelect(value, onchange) {
  const sel = el('select');
  const cur = el('option', null, value || '(无)');
  cur.value = value || '';
  sel.append(cur);
  for (const p of outPaths()) {
    if (p === value) continue;
    const o = el('option', null, p);
    o.value = p;
    sel.append(o);
  }
  sel.addEventListener('change', () => onchange(sel.value));
  return sel;
}

/* 槽位（value/sub）里的一个条目行。字符串引用就地改写；
 * pair/diff 这类复合对象只显示与删除，不提供内部编辑（要改就删了重加）。 */
function slotRow(arr, i, rebuild) {
  const item = arr[i];
  const row = el('div', 'slot-row');
  if (typeof item === 'string') {
    const sel = metricSelect(item, v => { arr[i] = v; onChange(); });
    const label = el('input'); label.type = 'text'; label.placeholder = '前缀标签（可空）';
    label.value = ''; label.size = 8; label.title = '字符串引用没有标签字段；填标签会把它升级成对象';
    label.addEventListener('change', () => {
      if (label.value) { arr[i] = { metric: arr[i], label: label.value }; rebuild(); }
    });
    row.append(sel, label);
  } else if (item?.metric) {
    const sel = metricSelect(item.metric, v => { item.metric = v; onChange(); });
    const label = el('input'); label.type = 'text'; label.placeholder = '前缀标签（可空）';
    label.value = item.label ?? ''; label.size = 8;
    label.addEventListener('input', () => { item.label = label.value || undefined; onChange(); });
    row.append(sel, label);
  } else if (item?.pair || item?.diff) {
    const pair = item.pair || item.diff;
    row.append(el('span', 'path', `${item.pair ? 'pair' : 'diff'}: ${pair.join(' / ')}`));
  } else {
    row.append(el('span', 'path', JSON.stringify(item)));
  }
  const del = el('button', 'mini'); del.textContent = '✕';
  del.title = '移除这一项';
  del.addEventListener('click', () => { arr.splice(i, 1); rebuild(); onChange(); });
  row.append(del);
  return row;
}

function slotEditor(card, defKey, title) {
  const box = el('div', 'slot');
  box.append(el('span', 'src', title));
  const rebuild = () => fillSlot(box, card, defKey, title, rebuild);
  fillSlot(box, card, defKey, title, rebuild);
  return box;
}

function fillSlot(box, card, defKey, title, rebuild) {
  const def = card[defKey];
  const list = def?.metrics ?? [];
  box.querySelectorAll('.slot-row, .slot-add').forEach(n => n.remove());
  list.forEach((_, i) => box.append(slotRow(list, i, rebuild)));
  const add = el('button', 'mini slot-add'); add.textContent = '+ 加指标';
  add.addEventListener('click', () => {
    const first = outPaths()[0];
    if (def) def.metrics.push(first);
    else card[defKey] = { metrics: [first] };
    rebuild(); onChange();
  });
  box.append(add);
}

function cardEditor(w, c, i, rebuildCards) {
  const fs = el('fieldset', 'card-edit');
  const legend = el('legend', null, `卡 ${i + 1}`);
  const delCard = el('button', 'mini'); delCard.textContent = '删卡';
  delCard.addEventListener('click', () => { w.items.splice(i, 1); rebuildCards(); onChange(); });
  legend.append(delCard);
  fs.append(legend);

  const label = el('input'); label.type = 'text'; label.value = c.label ?? ''; label.size = 24;
  label.addEventListener('input', () => { c.label = label.value; onChange(); });
  fs.append(el('label', null, [el('span', 'src', '标题'), label]));

  fs.append(el('div', 'form', [
    el('label', null, [el('span', 'src', '进度条'),
      metricSelect(c.bar, v => { v ? c.bar = v : delete c.bar; onChange(); })]),
    el('label', null, [el('span', 'src', '曲线'),
      metricSelect(c.spark, v => { v ? c.spark = v : delete c.spark; onChange(); })]),
  ]));

  fs.append(slotEditor(c, 'value', '主值'));
  fs.append(slotEditor(c, 'sub', '次要行'));
  return fs;
}

function buildCardsEditor(w, host) {
  const addCard = el('button', 'mini'); addCard.textContent = '+ 卡片';
  const rebuildCards = () => {
    host.replaceChildren();
    (w.items || []).forEach((c, i) => host.append(cardEditor(w, c, i, rebuildCards)));
    host.append(addCard);
  };
  addCard.addEventListener('click', () => {
    const first = outPaths()[0];
    w.items = w.items || [];
    w.items.push({ key: nextKey(), label: '新卡片', bar: first,
                   value: { metrics: [first] }, sub: { sep: ' · ', metrics: [] } });
    rebuildCards(); onChange();
  });
  rebuildCards();
}

function buildChipsEditor(w, host) {
  const form = el('div', 'form');
  const font = el('input'); font.type = 'number'; font.value = w.font ?? 15; font.min = 8; font.max = 40;
  font.addEventListener('change', () => { w.font = +font.value; onChange(); });
  form.append(el('label', null, [el('span', 'src', '字号'), font]));
  host.append(form);

  const inChips = new Set(w.items || []);
  const box = el('div', 'chips-edit');
  box.replaceChildren(...outPaths().map(p => {
    const m = METRICS.metrics.find(x => x.out === p);
    const cb = el('input');
    cb.type = 'checkbox'; cb.checked = inChips.has(p);
    cb.addEventListener('change', () => {
      w.items = (w.items || []).filter(x => x !== p);
      if (cb.checked) w.items.push(p);
      onChange();
    });
    return el('label', null, [cb, el('span', null, m.name),
      el('span', 'path', p), usedPaths().has(p) && !cb.checked ? el('span', 'inuse', '版式别处在用') : null]
      .filter(Boolean));
  }));
  host.append(box);
}

function buildTextEditor(w, host) {
  const form = el('div', 'form');
  const text = el('input'); text.type = 'text'; text.value = w.text ?? ''; text.size = 60;
  text.addEventListener('input', () => { w.text = text.value; onChange(); });
  const size = el('input'); size.type = 'number'; size.value = w.size ?? 19; size.min = 8; size.max = 60;
  size.addEventListener('change', () => { w.size = +size.value; onChange(); });
  form.append(
    el('label', null, [el('span', 'src', '正文'), text]),
    el('label', null, [el('span', 'src', '字号'), size]));
  host.append(form, el('div', 'src', '正文里用 {cpu.usage} 这类占位符插入指标值，缺失时显示 --。'));
}

const WIDGET_EDITORS = { cards: buildCardsEditor, chips: buildChipsEditor, text: buildTextEditor };

function buildEditor() {
  $('#e-w').value = draft.canvas.w;
  $('#e-h').value = draft.canvas.h;
  ['e-w', 'e-h'].forEach(id => $('#' + id).addEventListener('change', () => {
    draft.canvas.w = +$('#e-w').value;
    draft.canvas.h = +$('#e-h').value;
    onChange();
  }));

  const host = $('#e-widgets');
  host.replaceChildren();
  (draft.widgets || []).forEach((w, i) => {
    const box = el('div', 'widget-edit');
    const del = el('button', 'mini'); del.textContent = '删部件';
    del.addEventListener('click', () => { draft.widgets.splice(i, 1); buildEditor(); onChange(); });
    const meta = { cards: '卡片网格', chips: '底部小指标', text: '自定义文本行' }[w.type] ?? w.type;
    box.append(el('div', 'w-head', [el('b', null, `部件 ${i + 1} · ${meta}`), del]));
    const inner = el('div', 'w-body');
    box.append(inner);
    (WIDGET_EDITORS[w.type] ?? (() => inner.append(el('div', 'src', `不认识的类型 ${w.type}，只能整体删除`))))(w, inner);
    host.append(box);
  });

  const addbar = el('div', 'addbar');
  const addText = el('button'); addText.textContent = '+ 文本行';
  addText.addEventListener('click', () => {
    draft.widgets.push({ type: 'text', text: `CPU {cpu.usage}% · {cpu.temp}°C`, size: 19, margin_top: 6 });
    buildEditor(); onChange();
  });
  const addCards = el('button'); addCards.textContent = '+ 卡片行';
  addCards.addEventListener('click', () => {
    const first = outPaths()[0];
    draft.widgets.push({ type: 'cards', items: [
      { key: nextKey(), label: '新卡片', bar: first,
        value: { metrics: [first] }, sub: { sep: ' · ', metrics: [] } }] });
    buildEditor(); onChange();
  });
  addbar.append(addCards, addText);
  host.append(addbar);
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
    renderObs();
  }, 350);
}

async function onSave() {
  const r = await fetch('/api/config', { method: 'PUT', body: JSON.stringify(draft),
                                        headers: { 'Content-Type': 'application/json' } });
  const rep = await r.json();
  if (!rep.saved) return setMsg(`✗ 保存失败：${(rep.errors || []).join('；')}`, 'bad');
  CFG = clone(draft);
  dirty = false;
  $('#e-save').disabled = true;
  reloadPreview();
  setMsg('✓ 已保存。OBS 里若没变化，点浏览器源的"刷新缓存"。', 'ok');
  // 静默刷新校验/预算面板；不能走 onChange，它会把这条确认消息盖成"没有改动"
  const { data } = await postJSON('/api/layout-check', draft);
  state.check = data;
  renderBudget();
  renderCheck();
  renderObs();
}

function sizePreview(cw, ch) {
  const pv = $('#pv'), wrap = $('#pv-wrap');
  if (!pv || !cw || !ch) return;
  const s = 0.45;
  pv.style.width = cw + 'px';
  pv.style.height = ch + 'px';
  pv.style.transform = `scale(${s})`;
  wrap.style.height = Math.ceil(ch * s) + 'px';
  $('#pv-note').textContent = `预览按 ${Math.round(s * 100)}% 缩放，真实尺寸 ${cw}×${ch}。`;
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
