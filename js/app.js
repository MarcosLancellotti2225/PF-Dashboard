// ── STATE ────────────────────────────────────────
const STATE_COLORS = ['#3b82f6','#14b8a6','#8b5cf6','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899'];

const PROXY_URL = 'https://plejrqzzxnypnxxnamxj.supabase.co/functions/v1/PFtool';

const S = {
  token: null, userName: null, view: 'token', search: '',
  data: { feedback: [], discoveries: [], companies: [], messages: [] },
  fil:  { feedback: [], discoveries: [], companies: [] }
};

// ── UTILS ────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function emptyHTML(icon, msg) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
}

function updateBadges() {
  $('badge-feedback').textContent    = S.data.feedback.length    || '\u2014';
  $('badge-discoveries').textContent = S.data.discoveries.length || '\u2014';
  $('badge-companies').textContent   = S.data.companies.length   || '\u2014';
  $('badge-messages').textContent    = S.data.messages.length    || '\u2014';
}

function setBtnLoading(id, loading, label) {
  const b = $(id);
  if (b) { b.disabled = loading; b.textContent = label; }
}

let tT;
function toast(msg, type) {
  type = type || '';
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(tT);
  tT = setTimeout(() => { t.className = ''; }, 3000);
}

// ── API ──────────────────────────────────────────
async function api(path, tk) {
  tk = tk || S.token;
  const url = `${PROXY_URL}${path}`;
  const r = await fetch(url, {
    headers: {
      'x-harvestr-token': tk,
      'Content-Type': 'application/json'
    }
  });
  if (!r.ok) {
    const t = await r.text().catch(() => r.statusText);
    throw new Error(`API ${r.status}: ${t}`);
  }
  return r.json();
}

function safe(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.data)) return v.data;
  if (Array.isArray(v.items)) return v.items;
  if (Array.isArray(v.results)) return v.results;
  return [];
}

async function loadAll() {
  const rs = await Promise.allSettled([
    api('/feedback?limit=200'),
    api('/discovery?limit=200'),
    api('/company?limit=200'),
    api('/message?limit=100')
  ]);
  S.data.feedback    = safe(rs[0].status === 'fulfilled' ? rs[0].value : []);
  S.data.discoveries = safe(rs[1].status === 'fulfilled' ? rs[1].value : []);
  S.data.companies   = safe(rs[2].status === 'fulfilled' ? rs[2].value : []);
  S.data.messages    = safe(rs[3].status === 'fulfilled' ? rs[3].value : []);
  S.fil.feedback    = [...S.data.feedback];
  S.fil.discoveries = [...S.data.discoveries];
  S.fil.companies   = [...S.data.companies];
  updateBadges();
  populateFilters();
}

// ── GATE ────────────────────────────────────────
async function testGateToken() {
  const tk = $('gate-token').value.trim();
  if (!tk) { toast('Introduce un token', 'error'); return; }
  setBtnLoading('gateTestBtn', true, 'Probando...');
  const el = $('gate-result');
  try {
    await api('/feedback?limit=1', tk);
    el.innerHTML = '<div class="alert success">\u2713 Token v\u00e1lido \u2014 conexi\u00f3n con Harvestr OK</div>';
  } catch (e) {
    el.innerHTML = '<div class="alert error">\u2717 ' + esc(e.message) + '</div>';
  }
  setBtnLoading('gateTestBtn', false, 'Probar token');
}

async function submitGate() {
  const name = $('gate-name').value.trim() || 'CSM';
  const tk = $('gate-token').value.trim();
  if (!tk) { toast('Introduce tu API token', 'error'); return; }
  S.token = tk; S.userName = name;
  $('tokenDot').className = 'token-dot ok';
  $('tokenName').textContent = name;
  showPanel('dashboard');
  navigate('dashboard', true);
  $('dash-loading').style.display = 'flex';
  $('dash-ready').style.display = 'none';
  try {
    await loadAll();
    renderDashboard();
  } catch (e) {
    $('dash-loading').style.display = 'none';
    toast('Error: ' + e.message, 'error');
  }
}

function resetToken() {
  S.token = null; S.userName = null;
  S.data = { feedback: [], discoveries: [], companies: [], messages: [] };
  S.fil  = { feedback: [], discoveries: [], companies: [] };
  $('tokenDot').className = 'token-dot';
  $('tokenName').textContent = 'No token set';
  updateBadges();
  navigate('token');
}

// ── NAVIGATION ───────────────────────────────────
function navigate(view, skipRender) {
  S.view = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const nav = $('nav-' + view);
  if (nav) nav.classList.add('active');

  const titles = {
    dashboard: 'Dashboard', feedback: 'Feedback', discoveries: 'Discoveries',
    companies: 'Companies', messages: 'Messages', token: 'Harvestr'
  };
  $('topbarTitle').textContent = titles[view] || view;
  $('topbarSub').textContent = S.userName || '';
  $('topbarSep').style.display = S.userName ? 'inline' : 'none';
  $('exportBtn').style.display = ['feedback','discoveries','companies','messages'].includes(view) ? 'flex' : 'none';

  if (!S.token) { showPanel('token'); return; }
  if (!skipRender) {
    showPanel(view);
    if (view === 'feedback')    renderFbTable(S.fil.feedback);
    if (view === 'discoveries') renderDiscTable(S.fil.discoveries);
    if (view === 'companies')   renderCompTable(S.fil.companies);
    if (view === 'messages')    renderMsgTable(S.data.messages);
    if (view === 'dashboard')   renderDashboard();
  } else {
    showPanel(view);
  }
}

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const p = $('panel-' + id);
  if (p) p.classList.add('active');
}

// ── DASHBOARD ────────────────────────────────────
function renderDashboard() {
  $('dash-loading').style.display = 'none';
  $('dash-ready').style.display = 'block';
  const now = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
  $('report-meta').textContent = (S.userName ? S.userName + ' \u00b7 ' : '') + 'Generado el ' + now;

  $('statsGrid').innerHTML =
    '<div class="stat-card blue"><div class="stat-label">Feedback Total</div><div class="stat-value">' + S.data.feedback.length + '</div><div class="stat-sub">items recibidos</div></div>' +
    '<div class="stat-card teal"><div class="stat-label">Discoveries</div><div class="stat-value">' + S.data.discoveries.length + '</div><div class="stat-sub">features y mejoras</div></div>' +
    '<div class="stat-card purple"><div class="stat-label">Companies</div><div class="stat-value">' + S.data.companies.length + '</div><div class="stat-sub">clientes registrados</div></div>' +
    '<div class="stat-card amber"><div class="stat-label">Messages</div><div class="stat-value">' + S.data.messages.length + '</div><div class="stat-sub">mensajes importados</div></div>';

  // Discoveries with most feedback
  const dm = {};
  S.data.feedback.forEach(f => {
    const d = f.discovery;
    if (!d) return;
    const k = typeof d === 'object' ? (d.name || d.title || d.id) : d;
    if (k) dm[k] = (dm[k] || 0) + 1;
  });
  const td = Object.entries(dm).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const md = td[0] ? td[0][1] : 1;
  $('chart-disc').innerHTML = td.length
    ? td.map(([n,c]) => '<div class="bar-row"><div class="bar-label" title="' + esc(n) + '">' + esc(n) + '</div><div class="bar-track"><div class="bar-fill blue" style="width:' + ((c/md)*100) + '%"></div></div><div class="bar-count">' + c + '</div></div>').join('')
    : '<div style="color:var(--text-3);font-size:13px;">Sin datos vinculados a\u00fan</div>';

  // Discovery states
  const sm = {};
  S.data.discoveries.forEach(d => {
    const s = d.state;
    const k = s ? (typeof s === 'object' ? s.name : s) : 'Sin estado';
    sm[k] = (sm[k] || 0) + 1;
  });
  const se = Object.entries(sm).sort((a,b) => b[1] - a[1]);
  $('chart-states').innerHTML = se.length
    ? se.map(([n,c], i) => '<div class="state-row"><div class="state-name"><div class="state-dot" style="background:' + STATE_COLORS[i % STATE_COLORS.length] + '"></div>' + esc(n) + '</div><div class="state-count">' + c + '</div></div>').join('')
    : '<div style="color:var(--text-3);font-size:13px;">Sin discoveries</div>';

  // Top companies by feedback
  const cm = {};
  S.data.feedback.forEach(f => {
    const c = f.company;
    if (!c) return;
    const k = typeof c === 'object' ? (c.name || c.id) : c;
    if (k) cm[k] = (cm[k] || 0) + 1;
  });
  const tc = Object.entries(cm).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const mc = tc[0] ? tc[0][1] : 1;
  $('chart-comp').innerHTML = tc.length
    ? tc.map(([n,c]) => '<div class="bar-row"><div class="bar-label" title="' + esc(n) + '">' + esc(n) + '</div><div class="bar-track"><div class="bar-fill teal" style="width:' + ((c/mc)*100) + '%"></div></div><div class="bar-count">' + c + '</div></div>').join('')
    : '<div style="color:var(--text-3);font-size:13px;">Sin datos de empresa en feedback</div>';

  // Recent feedback
  const recent = [...S.data.feedback].sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 6);
  $('recent-list').innerHTML = recent.length
    ? recent.map(f => {
        const title = f.title || f.name || '(sin t\u00edtulo)';
        const company = f.company ? (typeof f.company === 'object' ? f.company.name : f.company) : null;
        const disc = f.discovery ? (typeof f.discovery === 'object' ? (f.discovery.name || f.discovery.title) : f.discovery) : null;
        const date = f.created_at ? new Date(f.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '';
        return '<div onclick=\'openDrawer(' + JSON.stringify(JSON.stringify(f)) + ',"feedback")\' style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;border-radius:4px;padding-left:4px;padding-right:4px;" onmouseenter="this.style.background=\'#f8fafc\'" onmouseleave="this.style.background=\'\'">' +
          '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(title) + '</div><div style="font-size:12px;color:var(--text-3);margin-top:2px;">' + [company, disc].filter(Boolean).map(esc).join(' \u00b7 ') + '</div></div>' +
          '<div style="font-size:11.5px;color:var(--text-3);white-space:nowrap;">' + date + '</div></div>';
      }).join('')
    : '<div style="color:var(--text-3);font-size:13px;padding:12px 0;">Sin feedback disponible</div>';
}

// ── TABLES ──────────────────────────────────────
function renderFbTable(items) {
  const q = S.search.toLowerCase();
  const shown = q ? items.filter(f => [f.title, f.content, f.description, f.body].map(x => x || '').join(' ').toLowerCase().includes(q)) : items;
  $('fb-count').textContent = shown.length + ' items';
  const wrap = $('fb-wrap');
  if (!shown.length) { wrap.innerHTML = emptyHTML('\u25ce', 'Sin feedback para este filtro'); return; }

  wrap.innerHTML = '<table><thead><tr><th>Feedback</th><th>Source</th><th>Company</th><th>Discovery</th><th>Fecha</th></tr></thead><tbody>' +
    shown.map((f, i) => {
      const title = f.title || f.name || '(sin t\u00edtulo)';
      const excerpt = f.content || f.description || f.body || '';
      const src = f.source || f.origin || '\u2014';
      const comp = f.company ? (typeof f.company === 'object' ? f.company.name : f.company) : '\u2014';
      const disc = f.discovery ? (typeof f.discovery === 'object' ? (f.discovery.name || f.discovery.title) : f.discovery) : '\u2014';
      const date = f.created_at ? new Date(f.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
      return '<tr data-i="' + i + '"><td><div class="td-title">' + esc(title) + '</div>' + (excerpt ? '<div class="td-excerpt">' + esc(excerpt.slice(0, 100)) + (excerpt.length > 100 ? '\u2026' : '') + '</div>' : '') + '</td><td><span class="tag gray">' + esc(src) + '</span></td><td class="td-meta">' + esc(comp) + '</td><td class="td-meta" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(disc) + '</td><td class="td-date">' + date + '</td></tr>';
    }).join('') + '</tbody></table>';
  clicks(wrap, shown, 'feedback');
}

function renderDiscTable(items) {
  const q = S.search.toLowerCase();
  const shown = q ? items.filter(d => [d.name, d.title, d.description].map(x => x || '').join(' ').toLowerCase().includes(q)) : items;
  $('disc-count').textContent = shown.length + ' discoveries';
  const wrap = $('disc-wrap');
  if (!shown.length) { wrap.innerHTML = emptyHTML('\u25c8', 'Sin discoveries para este filtro'); return; }

  wrap.innerHTML = '<table><thead><tr><th>Discovery</th><th>Estado</th><th>Componente</th><th>Feedback</th><th>Actualizado</th></tr></thead><tbody>' +
    shown.map((d, i) => {
      const name = d.name || d.title || '(sin nombre)';
      const desc = d.description || '';
      const state = d.state ? (typeof d.state === 'object' ? d.state.name : d.state) : '\u2014';
      const comp = d.component ? (typeof d.component === 'object' ? d.component.name : d.component) : '\u2014';
      const fbC = d.feedback_count !== undefined ? d.feedback_count : (d.feedbacks_count !== undefined ? d.feedbacks_count : '\u2014');
      const date = d.updated_at ? new Date(d.updated_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
      return '<tr data-i="' + i + '"><td><div class="td-title">' + esc(name) + '</div>' + (desc ? '<div class="td-excerpt">' + esc(desc.slice(0, 80)) + (desc.length > 80 ? '\u2026' : '') + '</div>' : '') + '</td><td><span class="tag blue">' + esc(state) + '</span></td><td class="td-meta">' + esc(comp) + '</td><td><span class="tag teal">' + fbC + '</span></td><td class="td-date">' + date + '</td></tr>';
    }).join('') + '</tbody></table>';
  clicks(wrap, shown, 'discovery');
}

function renderCompTable(items) {
  const q = S.search.toLowerCase();
  const shown = q ? items.filter(c => [c.name, c.domain].map(x => x || '').join(' ').toLowerCase().includes(q)) : items;
  $('comp-count').textContent = shown.length + ' empresas';
  const wrap = $('comp-wrap');
  if (!shown.length) { wrap.innerHTML = emptyHTML('\u25a6', 'Sin companies'); return; }

  wrap.innerHTML = '<table><thead><tr><th>Company</th><th>Dominio</th><th>Feedback</th><th>Creada</th></tr></thead><tbody>' +
    shown.map((c, i) => {
      const fbCount = S.data.feedback.filter(f => {
        const fc = f.company; if (!fc) return false;
        const fn = typeof fc === 'object' ? fc.name : fc;
        return fn === c.name;
      }).length;
      const date = c.created_at ? new Date(c.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
      return '<tr data-i="' + i + '"><td class="td-title">' + esc(c.name || '(sin nombre)') + '</td><td class="td-meta">' + esc(c.domain || c.website || '\u2014') + '</td><td>' + (fbCount > 0 ? '<span class="tag blue">' + fbCount + '</span>' : '<span class="td-meta">0</span>') + '</td><td class="td-date">' + date + '</td></tr>';
    }).join('') + '</tbody></table>';
  clicks(wrap, shown, 'company');
}

function renderMsgTable(items) {
  const wrap = $('msg-wrap');
  if (!items.length) { wrap.innerHTML = emptyHTML('\u2709', 'Sin mensajes'); return; }

  wrap.innerHTML = '<table><thead><tr><th>Mensaje</th><th>Autor</th><th>Fecha</th></tr></thead><tbody>' +
    items.map((m, i) => {
      const content = m.content || m.text || m.body || '(sin contenido)';
      const a = m.author || m.from || m.user || '\u2014';
      const aStr = typeof a === 'object' ? (a.name || a.email || JSON.stringify(a)) : a;
      const date = m.created_at ? new Date(m.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
      return '<tr data-i="' + i + '"><td><div class="td-excerpt" style="max-width:420px;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + esc(content.slice(0, 200)) + '</div></td><td class="td-meta">' + esc(aStr) + '</td><td class="td-date">' + date + '</td></tr>';
    }).join('') + '</tbody></table>';
  clicks(wrap, items, 'message');
}

function clicks(wrap, items, type) {
  wrap.querySelectorAll('tbody tr').forEach(row => {
    row.addEventListener('click', () => {
      const i = parseInt(row.dataset.i);
      if (!isNaN(i)) openDrawer(JSON.stringify(items[i]), type);
    });
  });
}

// ── DRAWER ──────────────────────────────────────
function openDrawer(jsonStr, type) {
  const item = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  $('drawerInner').innerHTML = buildDrawer(item, type);
  $('drawerOverlay').classList.add('open');
  if (type === 'discovery' && item.id) loadLinkedFb(item.id);
}

function closeDrawer() {
  $('drawerOverlay').classList.remove('open');
}

function buildDrawer(item, type) {
  const typeLabel = { feedback: 'Feedback', discovery: 'Discovery', company: 'Company', message: 'Mensaje' }[type] || type;
  const typeTag = { feedback: 'blue', discovery: 'teal', company: 'purple', message: 'amber' }[type] || 'gray';
  const title = item.title || item.name || (item.content || '').slice(0, 70) || (type + ' detail');
  const skip = new Set(['id','title','name','description','content','body','state','component','source','company','discovery','created_at','updated_at','feedback_count','feedbacks_count']);

  const keyFields = [];
  if (item.description || item.content || item.body) keyFields.push({ l: 'Descripci\u00f3n / Contenido', v: item.description || item.content || item.body });
  if (item.state) keyFields.push({ l: 'Estado', v: typeof item.state === 'object' ? (item.state.name || JSON.stringify(item.state)) : item.state });
  if (item.component) keyFields.push({ l: 'Componente', v: typeof item.component === 'object' ? (item.component.name || JSON.stringify(item.component)) : item.component });
  if (item.source) keyFields.push({ l: 'Source', v: item.source });
  if (item.company) keyFields.push({ l: 'Company', v: typeof item.company === 'object' ? (item.company.name || JSON.stringify(item.company)) : item.company });
  if (item.discovery) keyFields.push({ l: 'Discovery', v: typeof item.discovery === 'object' ? (item.discovery.name || item.discovery.title || JSON.stringify(item.discovery)) : item.discovery });
  if (item.feedback_count !== undefined) keyFields.push({ l: 'Feedback Count', v: item.feedback_count });
  if (item.created_at) keyFields.push({ l: 'Creado', v: new Date(item.created_at).toLocaleString('es-ES') });
  if (item.updated_at) keyFields.push({ l: 'Actualizado', v: new Date(item.updated_at).toLocaleString('es-ES') });

  const otherFields = Object.entries(item).filter(([k]) => !skip.has(k));

  return '<div class="drawer-header">' +
    '<div style="flex:1;min-width:0;">' +
      '<span class="tag ' + typeTag + '" style="margin-bottom:8px;display:inline-flex;">' + typeLabel + '</span>' +
      '<div class="drawer-title">' + esc(title) + '</div>' +
      '<div style="font-size:11px;color:var(--text-3);margin-top:4px;font-family:monospace;">ID: ' + esc(item.id || '\u2014') + '</div>' +
    '</div>' +
    '<button class="drawer-close" onclick="closeDrawer()">\u00d7</button>' +
  '</div>' +
  '<div class="drawer-body">' +
    keyFields.map(f => '<div><div class="field-label">' + esc(f.l) + '</div><div class="field-value">' + esc(String(f.v)) + '</div></div>').join('') +
    (type === 'discovery' ? '<div class="drawer-section"><div class="drawer-section-title">Feedback vinculado a esta Discovery</div><div id="linked-fb-wrap"><div class="loading-wrap" style="padding:16px;"><div class="spinner"></div></div></div></div>' : '') +
    (otherFields.length ? '<div class="drawer-section"><div class="drawer-section-title">Todos los campos</div>' +
      otherFields.map(([k, v]) => '<div style="margin-bottom:10px;"><div class="field-label">' + esc(k.replace(/_/g, ' ')) + '</div><div class="field-value muted">' + (typeof v === 'object' ? '<pre>' + esc(JSON.stringify(v, null, 2)) + '</pre>' : esc(String(v !== null && v !== undefined ? v : '\u2014'))) + '</div></div>').join('') +
    '</div>' : '') +
  '</div>';
}

async function loadLinkedFb(discId) {
  const el = document.getElementById('linked-fb-wrap');
  if (!el) return;
  try {
    const raw = await api('/discovery/' + discId + '/feedback?limit=50');
    const items = safe(raw);
    if (!items.length) { el.innerHTML = '<div style="color:var(--text-3);font-size:13px;">Sin feedback vinculado</div>'; return; }
    el.innerHTML = items.map(f => {
      const title = f.title || f.name || '(sin t\u00edtulo)';
      const company = f.company ? (typeof f.company === 'object' ? f.company.name : f.company) : null;
      const date = f.created_at ? new Date(f.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      return '<div class="linked-item" onclick=\'openDrawer(' + JSON.stringify(JSON.stringify(f)) + ',"feedback")\'>' +
        '<div style="font-size:13px;font-weight:500;">' + esc(title) + '</div>' +
        '<div style="font-size:12px;color:var(--text-3);margin-top:3px;">' + [company, date].filter(Boolean).map(esc).join(' \u00b7 ') + '</div></div>';
    }).join('');
  } catch (e) {
    if (el) el.innerHTML = '<div style="color:var(--red);font-size:12px;">Error: ' + esc(e.message) + '</div>';
  }
}

// ── FILTERS ──────────────────────────────────────
function populateFilters() {
  const discN = new Set();
  S.data.feedback.forEach(f => {
    const d = f.discovery;
    if (d) { const k = typeof d === 'object' ? (d.name || d.title || d.id) : d; if (k) discN.add(k); }
  });
  $('flt-fb-disc').innerHTML = '<option value="">Todas las Discoveries</option>' + [...discN].sort().map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');

  const srcN = new Set(S.data.feedback.map(f => f.source || f.origin).filter(Boolean));
  $('flt-fb-src').innerHTML = '<option value="">Todos los sources</option>' + [...srcN].sort().map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');

  const stN = new Set(S.data.discoveries.map(d => d.state ? (typeof d.state === 'object' ? d.state.name : d.state) : null).filter(Boolean));
  $('flt-disc-state').innerHTML = '<option value="">Todos los estados</option>' + [...stN].sort().map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');

  const compN = new Set(S.data.discoveries.map(d => d.component ? (typeof d.component === 'object' ? d.component.name : d.component) : null).filter(Boolean));
  $('flt-disc-comp').innerHTML = '<option value="">Todos los componentes</option>' + [...compN].sort().map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
}

function applyFbFilters() {
  const disc = $('flt-fb-disc').value;
  const src = $('flt-fb-src').value;
  S.fil.feedback = S.data.feedback.filter(f => {
    if (disc) { const d = f.discovery; const k = d ? (typeof d === 'object' ? (d.name || d.title || d.id) : d) : null; if (k !== disc) return false; }
    if (src) { if ((f.source || f.origin || '') !== src) return false; }
    return true;
  });
  renderFbTable(S.fil.feedback);
}

function applyDiscFilters() {
  const st = $('flt-disc-state').value;
  const comp = $('flt-disc-comp').value;
  S.fil.discoveries = S.data.discoveries.filter(d => {
    if (st) { const s = d.state; const k = s ? (typeof s === 'object' ? s.name : s) : null; if (k !== st) return false; }
    if (comp) { const c = d.component; const k = c ? (typeof c === 'object' ? c.name : c) : null; if (k !== comp) return false; }
    return true;
  });
  renderDiscTable(S.fil.discoveries);
}

// ── SEARCH ──────────────────────────────────────
let sT;
function handleSearch(q) {
  S.search = q;
  clearTimeout(sT);
  sT = setTimeout(() => {
    if (S.view === 'feedback')    renderFbTable(S.fil.feedback);
    if (S.view === 'discoveries') renderDiscTable(S.fil.discoveries);
    if (S.view === 'companies')   renderCompTable(S.fil.companies);
  }, 160);
}

// ── REFRESH ──────────────────────────────────────
async function refreshData() {
  if (!S.token) { navigate('token'); return; }
  setBtnLoading('refreshBtn', true, '\u21ba Cargando...');
  try {
    await loadAll();
    navigate(S.view);
    toast('Datos actualizados', 'success');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
  setBtnLoading('refreshBtn', false, '\u21ba Refresh');
}

// ── EXPORT CSV ──────────────────────────────────
function exportCSV() {
  let rows = [], fn = 'export';
  if (S.view === 'feedback') {
    fn = 'harvestr-feedback';
    rows = S.fil.feedback.map(f => ({
      id: f.id || '', title: f.title || f.name || '',
      content: (f.content || f.description || '').replace(/\n/g, ' '),
      source: f.source || '',
      company: f.company ? (typeof f.company === 'object' ? f.company.name : f.company) : '',
      discovery: f.discovery ? (typeof f.discovery === 'object' ? (f.discovery.name || f.discovery.title) : f.discovery) : '',
      created_at: f.created_at || ''
    }));
  } else if (S.view === 'discoveries') {
    fn = 'harvestr-discoveries';
    rows = S.fil.discoveries.map(d => ({
      id: d.id || '', name: d.name || d.title || '',
      description: (d.description || '').replace(/\n/g, ' '),
      state: d.state ? (typeof d.state === 'object' ? d.state.name : d.state) : '',
      component: d.component ? (typeof d.component === 'object' ? d.component.name : d.component) : '',
      feedback_count: d.feedback_count !== undefined ? d.feedback_count : '',
      updated_at: d.updated_at || ''
    }));
  } else if (S.view === 'companies') {
    fn = 'harvestr-companies';
    rows = S.fil.companies.map(c => ({
      id: c.id || '', name: c.name || '',
      domain: c.domain || '', created_at: c.created_at || ''
    }));
  } else if (S.view === 'messages') {
    fn = 'harvestr-messages';
    rows = S.data.messages.map(m => {
      const a = m.author || m.from || m.user || '';
      return {
        id: m.id || '',
        content: (m.content || m.text || m.body || '').replace(/\n/g, ' '),
        author: typeof a === 'object' ? (a.name || a.email || '') : a,
        created_at: m.created_at || ''
      };
    });
  }
  if (!rows.length) { toast('Sin datos', 'error'); return; }
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(','), ...rows.map(r => keys.map(k => '"' + String(r[k]).replace(/"/g, '""') + '"').join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = fn + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  toast('CSV descargado', 'success');
}

// ── KEYBOARD SHORTCUTS ──────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDrawer();
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); $('globalSearch').focus(); }
  if (e.key === 'Enter' && document.activeElement === $('gate-token')) submitGate();
});
