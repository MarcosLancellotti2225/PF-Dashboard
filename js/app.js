// ── STATE ────────────────────────────────────────
const STATE_COLORS = ['#3b82f6','#14b8a6','#8b5cf6','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899'];

const PROXY_URL = 'https://plejrqzzxnypnxxnamxj.supabase.co/functions/v1/PFtool';

const S = {
  token: null, userName: null, view: 'token', search: '',
  filters: { companyId: '', userId: '' }, // pre-query filters applied to API calls
  data: { feedback: [], discoveries: [], companies: [], messages: [], users: [] },
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
  const fb = S.data.feedback.length;
  const disc = S.data.discoveries.length;
  const comp = S.data.companies.length;
  const msg = S.data.messages.length;
  $('badge-feedback').textContent    = fb || '\u2014';
  $('badge-discoveries').textContent = disc || '\u2014';
  $('badge-companies').textContent   = comp || '\u2014';
  $('badge-messages').textContent    = msg || '\u2014';
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
  // Harvestr API returns named arrays: feedbacks, discoveries, companies, messages, users
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter(k => Array.isArray(v[k]));
    if (keys.length) return v[keys[0]];
  }
  return [];
}

// Paginated fetch: keeps requesting pages until all items are loaded
async function apiAllPages(path, tk) {
  let all = [];
  let page = 1;
  const maxPages = 50; // safety limit
  while (page <= maxPages) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await api(path + sep + 'page=' + page, tk);
    const items = safe(res);
    all = all.concat(items);
    // Check pageInfos for total pages
    const pi = res && res.pageInfos;
    const totalPages = pi ? (pi.totalPages || pi.total_pages || pi.lastPage || pi.last_page || 0) : 0;
    console.log('[PAGE] ' + path + ' page=' + page + '/' + (totalPages || '?') + ' got=' + items.length + ' total=' + all.length);
    if (!items.length || page >= totalPages) break;
    page++;
  }
  return all;
}

// Load only companies and users (lightweight, for the filter step)
async function loadCompaniesAndUsers(tk) {
  tk = tk || S.token;
  const rs = await Promise.allSettled([
    apiAllPages('/company?per_page=100', tk),
    apiAllPages('/user?per_page=100', tk)
  ]);
  S.data.companies = rs[0].status === 'fulfilled' ? rs[0].value : [];
  S.data.users = rs[1].status === 'fulfilled' ? rs[1].value : [];
  console.log('[PRELOAD] companies:', S.data.companies.length, 'users:', S.data.users.length);
}

async function loadAll() {
  const loadingText = $('dash-loading-text');
  if (loadingText) loadingText.textContent = 'Cargando todas las p\u00e1ginas de Harvestr...';

  // Fetch all pages for each endpoint (reuse preloaded discoveries if available)
  const hasPreloaded = S._preloadedDiscoveries && S._preloadedDiscoveries.length;
  const rs = await Promise.allSettled([
    apiAllPages('/feedback?per_page=100'),
    hasPreloaded ? Promise.resolve(S._preloadedDiscoveries) : apiAllPages('/discovery?per_page=100'),
    apiAllPages('/company?per_page=100'),
    apiAllPages('/message?per_page=100')
  ]);
  delete S._preloadedDiscoveries;

  S.data.feedback    = rs[0].status === 'fulfilled' ? rs[0].value : [];
  S.data.discoveries = rs[1].status === 'fulfilled' ? rs[1].value : [];
  S.data.companies   = rs[2].status === 'fulfilled' ? rs[2].value : [];
  S.data.messages    = rs[3].status === 'fulfilled' ? rs[3].value : [];

  console.log('[DATA] feedback:', S.data.feedback.length, 'discoveries:', S.data.discoveries.length, 'companies:', S.data.companies.length, 'messages:', S.data.messages.length);

  // Users (requires read_user scope — may fail if token lacks it)
  if (!S.data.users.length) {
    try {
      S.data.users = await apiAllPages('/user?per_page=100');
      console.log('[DATA] users:', S.data.users.length);
    } catch (e) {
      S.data.users = [];
      console.warn('Could not load users (needs read_user scope):', e.message);
    }
  }

  // Build lookup maps for resolving references
  const msgMap = new Map();
  S.data.messages.forEach(m => msgMap.set(String(m.id), m));
  const discMap = new Map();
  S.data.discoveries.forEach(d => discMap.set(String(d.id), d));
  const compMap = new Map();
  S.data.companies.forEach(c => compMap.set(String(c.id), c));
  const userMap = new Map();
  S.data.users.forEach(u => userMap.set(String(u.id), u));

  // Enrich feedback items by resolving messageId → message, discoveryId → discovery
  // Harvestr feedback has: id, messageId, discoveryId, score, starred, selections[]
  // We need to resolve these to get title, content, source, company, discovery name
  S.data.feedback = S.data.feedback.map(f => {
    const msg = f.messageId ? msgMap.get(String(f.messageId)) : null;
    const disc = f.discoveryId ? discMap.get(String(f.discoveryId)) : null;
    const requester = msg && msg.requesterId ? userMap.get(String(msg.requesterId)) : null;
    const company = requester && requester.companyId ? compMap.get(String(requester.companyId)) : null;
    const selectionText = (f.selections || []).map(s => s.content || '').join(' ').trim();
    return {
      ...f,
      // Resolved display fields
      _title: msg ? (msg.title || selectionText || '(sin título)') : (selectionText || '(sin título)'),
      _content: selectionText || (msg ? msg.content : '') || '',
      _source: msg ? (msg.channel || '') : '',
      _company: company || null,
      _companyId: company ? String(company.id) : (requester ? String(requester.companyId || '') : ''),
      _companyName: company ? company.name : '',
      _discovery: disc || null,
      _discoveryName: disc ? (disc.title || disc.name || '') : '',
      _discoveryId: f.discoveryId || '',
      _requester: requester || null,
      _requesterName: requester ? (requester.name || requester.email || '') : '',
      _date: f.createdAt || (msg ? msg.createdAt : '') || ''
    };
  });

  console.log('[ENRICHED] First feedback:', S.data.feedback.length ? S.data.feedback[0] : 'none');

  // Apply pre-query filters (client-side)
  if (S.filters.companyId) {
    const comp = compMap.get(S.filters.companyId);
    console.log('[FILTER] Company:', comp ? comp.name : S.filters.companyId);
    S.data.feedback = S.data.feedback.filter(f => f._companyId === S.filters.companyId);
    console.log('[FILTER] Feedback after company filter:', S.data.feedback.length);
  }
  if (S.filters.userId) {
    const user = userMap.get(S.filters.userId);
    console.log('[FILTER] Teammate:', user ? (user.name || user.email) : S.filters.userId);
    S.data.discoveries = S.data.discoveries.filter(d =>
      String(d.assigneeId || '') === S.filters.userId
    );
    console.log('[FILTER] Discoveries after teammate filter:', S.data.discoveries.length);
  }

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
  setBtnLoading('gateTestBtn', true, 'Conectando...');
  const el = $('gate-result');
  try {
    // Validate token
    await api('/feedback?per_page=1', tk);
    // Preload all companies + users for filter selectors (paginated)
    setBtnLoading('gateTestBtn', true, 'Cargando companies...');
    await loadCompaniesAndUsers(tk);

    // Populate filter selectors
    const compSel = $('gate-company');
    if (compSel) {
      const sorted = [...S.data.companies].sort((a,b) => (a.name || '').localeCompare(b.name || ''));
      compSel.innerHTML = '<option value="">-- Todas las companies --</option>' +
        sorted.map(c => '<option value="' + esc(String(c.id)) + '">' + esc(c.name || '(sin nombre)') + '</option>').join('');
    }
    // Also preload discoveries to extract assignees (teammates)
    setBtnLoading('gateTestBtn', true, 'Cargando discoveries...');
    const discRs = await apiAllPages('/discovery?per_page=100', tk);
    S._preloadedDiscoveries = discRs;

    // Try to load discovery states for labeling
    try {
      const statesRs = await api('/discoverystate?per_page=100', tk);
      const states = safe(statesRs);
      S._stateMap = new Map();
      states.forEach(s => S._stateMap.set(String(s.id), s.name || s.title || String(s.id)));
      console.log('[PRELOAD] discovery states:', S._stateMap.size, [...S._stateMap.values()]);
    } catch (e) {
      console.warn('Could not load discovery states:', e.message);
      S._stateMap = new Map();
    }

    // Extract unique assignees from discoveries (these are the real teammates)
    const teammateMap = new Map();
    discRs.forEach(d => {
      if (d.assigneeId) {
        const user = S.data.users.find(u => String(u.id) === String(d.assigneeId));
        if (!teammateMap.has(String(d.assigneeId))) {
          teammateMap.set(String(d.assigneeId), user ? (user.name || user.email) : ('User ' + String(d.assigneeId).slice(0, 8)));
        }
      }
    });
    console.log('[PRELOAD] teammates found in discoveries:', teammateMap.size, [...teammateMap.values()]);

    const userSel = $('gate-user');
    if (userSel) {
      const sorted = [...teammateMap.entries()].sort((a,b) => a[1].localeCompare(b[1]));
      userSel.innerHTML = '<option value="">-- Todos los teammates --</option>' +
        sorted.map(([id, name]) => '<option value="' + esc(id) + '">' + esc(name) + '</option>').join('');
    }

    // Switch to step 2
    $('gate-step1').style.display = 'none';
    $('gate-step2').style.display = 'block';
    $('gate-step2-info').textContent = '\u2713 Token v\u00e1lido \u2014 ' + S.data.companies.length + ' companies, ' + teammateMap.size + ' teammates encontrados.';
  } catch (e) {
    el.innerHTML = '<div class="alert error">\u2717 ' + esc(e.message) + '</div>';
  }
  setBtnLoading('gateTestBtn', false, 'Conectar \u2192');
}

function gateGoBack() {
  $('gate-step1').style.display = 'block';
  $('gate-step2').style.display = 'none';
}

async function submitGate() {
  const name = $('gate-name').value.trim() || 'CSM';
  const tk = $('gate-token').value.trim();
  if (!tk) { toast('Introduce tu API token', 'error'); return; }

  // Capture pre-query filters
  const compSel = $('gate-company');
  const userSel = $('gate-user');
  S.filters.companyId = compSel ? compSel.value : '';
  S.filters.userId = userSel ? userSel.value : '';

  S.token = tk; S.userName = name;
  $('tokenDot').className = 'token-dot ok';

  // Show active filter in token indicator and sidebar
  const filterInfo = [];
  if (S.filters.companyId) {
    const c = S.data.companies.find(c => String(c.id) === S.filters.companyId);
    if (c) filterInfo.push(c.name);
  }
  if (S.filters.userId) {
    const u = S.data.users.find(u => String(u.id) === S.filters.userId);
    if (u) filterInfo.push(u.name || u.email);
  }
  $('tokenName').textContent = name;
  const afl = $('activeFilterLabel');
  if (afl) {
    if (filterInfo.length) {
      afl.textContent = filterInfo.join(' \u00b7 ');
      afl.style.display = 'block';
    } else {
      afl.style.display = 'none';
    }
  }

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
  S.filters = { companyId: '', userId: '' };
  S.data = { feedback: [], discoveries: [], companies: [], messages: [], users: [] };
  S.fil  = { feedback: [], discoveries: [], companies: [] };
  $('tokenDot').className = 'token-dot';
  $('tokenName').textContent = 'No token set';
  $('gate-step1').style.display = 'block';
  $('gate-step2').style.display = 'none';
  $('gate-result').innerHTML = '';
  renderDashboard._debugged = false;
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
  const filterParts = [];
  if (S.userName) filterParts.push(S.userName);
  if (S.filters.companyId) {
    const c = S.data.companies.find(x => String(x.id) === S.filters.companyId);
    if (c) filterParts.push(c.name);
  }
  if (S.filters.userId) {
    const u = userNameById(S.filters.userId);
    if (u) filterParts.push(u);
  }
  $('topbarSub').textContent = filterParts.join(' \u00b7 ');
  $('topbarSep').style.display = filterParts.length ? 'inline' : 'none';
  $('exportBtn').style.display = ['feedback','discoveries','companies','messages'].includes(view) ? 'flex' : 'none';
  $('importUsersBtn').style.display = ['feedback','discoveries'].includes(view) ? 'flex' : 'none';
  $('importUsersInfo').style.display = (S.data.users.length && ['feedback','discoveries'].includes(view)) ? 'inline' : 'none';

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

  const fb = S.data.feedback;
  const disc = S.data.discoveries;

  // Show filter banner if active
  const banner = $('dash-filter-banner');
  const bannerParts = [];
  if (S.filters.companyId) {
    const c = S.data.companies.find(x => String(x.id) === S.filters.companyId);
    if (c) bannerParts.push('Company: ' + c.name);
  }
  if (S.filters.userId) {
    const u = userNameById(S.filters.userId);
    if (u) bannerParts.push('Teammate: ' + u);
  }
  if (banner) {
    if (bannerParts.length) {
      banner.style.display = 'flex';
      banner.innerHTML = '<strong>Filtro activo:</strong> ' + bannerParts.map(esc).join(' &middot; ') +
        ' <span style="margin-left:auto;font-size:12px;">' + fb.length + ' feedback &middot; ' + disc.length + ' discoveries</span>';
    } else {
      banner.style.display = 'none';
    }
  }

  $('statsGrid').innerHTML =
    '<div class="stat-card blue"><div class="stat-label">Feedback</div><div class="stat-value">' + fb.length + '</div><div class="stat-sub">items recibidos</div></div>' +
    '<div class="stat-card teal"><div class="stat-label">Discoveries</div><div class="stat-value">' + disc.length + '</div><div class="stat-sub">features y mejoras</div></div>' +
    '<div class="stat-card purple"><div class="stat-label">Companies</div><div class="stat-value">' + S.data.companies.length + '</div><div class="stat-sub">clientes registrados</div></div>' +
    '<div class="stat-card amber"><div class="stat-label">Messages</div><div class="stat-value">' + S.data.messages.length + '</div><div class="stat-sub">mensajes importados</div></div>';

  // Discoveries with most feedback (uses enriched feedback)
  const dm = {};
  fb.forEach(f => {
    const k = f._discoveryName;
    if (k) dm[k] = (dm[k] || 0) + 1;
  });
  const td = Object.entries(dm).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const md = td[0] ? td[0][1] : 1;
  $('chart-disc').innerHTML = td.length
    ? td.map(([n,c]) => '<div class="bar-row"><div class="bar-label" title="' + esc(n) + '">' + esc(n) + '</div><div class="bar-track"><div class="bar-fill blue" style="width:' + ((c/md)*100) + '%"></div></div><div class="bar-count">' + c + '</div></div>').join('')
    : '<div style="color:var(--text-3);font-size:13px;">Sin datos vinculados a\u00fan</div>';

  // Discovery states (using discoveryStateId — show ID for now, could resolve to names)
  const sm = {};
  disc.forEach(d => {
    const k = d.discoveryStateId ? (S._stateMap && S._stateMap.get(String(d.discoveryStateId))) || ('State ' + String(d.discoveryStateId).slice(0, 6)) : 'Sin estado';
    sm[k] = (sm[k] || 0) + 1;
  });
  const se = Object.entries(sm).sort((a,b) => b[1] - a[1]);
  $('chart-states').innerHTML = se.length
    ? se.map(([n,c], i) => '<div class="state-row"><div class="state-name"><div class="state-dot" style="background:' + STATE_COLORS[i % STATE_COLORS.length] + '"></div>' + esc(n) + '</div><div class="state-count">' + c + '</div></div>').join('')
    : '<div style="color:var(--text-3);font-size:13px;">Sin discoveries</div>';

  // Top companies by feedback (using enriched _companyName)
  const cm = {};
  fb.forEach(f => {
    if (f._companyName) cm[f._companyName] = (cm[f._companyName] || 0) + 1;
  });
  const tc = Object.entries(cm).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const mc = tc[0] ? tc[0][1] : 1;
  $('chart-comp').innerHTML = tc.length
    ? tc.map(([n,c]) => '<div class="bar-row"><div class="bar-label" title="' + esc(n) + '">' + esc(n) + '</div><div class="bar-track"><div class="bar-fill teal" style="width:' + ((c/mc)*100) + '%"></div></div><div class="bar-count">' + c + '</div></div>').join('')
    : '<div style="color:var(--text-3);font-size:13px;">Sin datos de empresa en feedback</div>';

  // Recent feedback (enriched)
  const recent = [...fb].sort((a,b) => new Date(b._date || 0) - new Date(a._date || 0)).slice(0, 6);
  $('recent-list').innerHTML = recent.length
    ? recent.map(f => {
        const title = f._title || '(sin t\u00edtulo)';
        const company = f._companyName;
        const disc = f._discoveryName;
        const date = f._date ? new Date(f._date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '';
        return '<div onclick=\'openDrawer(' + JSON.stringify(JSON.stringify(f)) + ',"feedback")\' style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;border-radius:4px;padding-left:4px;padding-right:4px;" onmouseenter="this.style.background=\'#f8fafc\'" onmouseleave="this.style.background=\'\'">' +
          '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(title) + '</div><div style="font-size:12px;color:var(--text-3);margin-top:2px;">' + [company, disc].filter(Boolean).map(esc).join(' \u00b7 ') + '</div></div>' +
          '<div style="font-size:11.5px;color:var(--text-3);white-space:nowrap;">' + date + '</div></div>';
      }).join('')
    : '<div style="color:var(--text-3);font-size:13px;padding:12px 0;">Sin feedback disponible</div>';
}

// ── TABLES ──────────────────────────────────────
function renderFbTable(items) {
  const q = S.search.toLowerCase();
  const shown = q ? items.filter(f => [f._title, f._content, f._companyName, f._discoveryName].map(x => x || '').join(' ').toLowerCase().includes(q)) : items;
  $('fb-count').textContent = shown.length + ' items';
  const wrap = $('fb-wrap');
  if (!shown.length) { wrap.innerHTML = emptyHTML('\u25ce', 'Sin feedback para este filtro'); return; }

  wrap.innerHTML = '<table translate="no"><thead><tr><th>Feedback</th><th>Source</th><th>Company</th><th>Discovery</th><th>Date</th></tr></thead><tbody>' +
    shown.map((f, i) => {
      const title = f._title || '(sin t\u00edtulo)';
      const excerpt = (f._content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const src = f._source || '\u2014';
      const comp = f._companyName || '\u2014';
      const disc = f._discoveryName || '\u2014';
      const date = f._date ? new Date(f._date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
      return '<tr data-i="' + i + '"><td><div class="td-title">' + esc(title) + '</div>' + (excerpt ? '<div class="td-excerpt">' + esc(excerpt.slice(0, 100)) + (excerpt.length > 100 ? '\u2026' : '') + '</div>' : '') + '</td><td><span class="tag gray">' + esc(src) + '</span></td><td class="td-meta">' + esc(comp) + '</td><td class="td-meta" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(disc) + '</td><td class="td-date">' + date + '</td></tr>';
    }).join('') + '</tbody></table>';
  clicks(wrap, shown, 'feedback');
}

function renderDiscTable(items) {
  const q = S.search.toLowerCase();
  const shown = q ? items.filter(d => [d.title, d.description].map(x => x || '').join(' ').toLowerCase().includes(q)) : items;
  $('disc-count').textContent = shown.length + ' discoveries';
  const wrap = $('disc-wrap');
  if (!shown.length) { wrap.innerHTML = emptyHTML('\u25c8', 'Sin discoveries para este filtro'); return; }

  wrap.innerHTML = '<table translate="no"><thead><tr><th>Discovery</th><th>State</th><th>Assignee</th><th>Feedback</th><th>Updated</th></tr></thead><tbody>' +
    shown.map((d, i) => {
      const name = d.title || d.name || '(sin nombre)';
      const rawDesc = d.description || '';
      const desc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      // Resolve state from discoveryStateId
      const stateId = d.discoveryStateId;
      const stateLabel = stateId ? (S._stateMap && S._stateMap.get(String(stateId))) || stateId : '\u2014';
      const assignee = d.assigneeId ? (userNameById(d.assigneeId) || d.assigneeId) : '\u2014';
      // Count feedback linked to this discovery
      const fbC = S.data.feedback.filter(f => String(f.discoveryId) === String(d.id)).length;
      const date = d.updatedAt ? new Date(d.updatedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
      return '<tr data-i="' + i + '"><td><div class="td-title">' + esc(name) + '</div>' + (desc ? '<div class="td-excerpt">' + esc(desc.slice(0, 80)) + (desc.length > 80 ? '\u2026' : '') + '</div>' : '') + '</td><td><span class="tag blue">' + esc(stateLabel) + '</span></td><td class="td-meta">' + esc(assignee) + '</td><td><span class="tag teal">' + fbC + '</span></td><td class="td-date">' + date + '</td></tr>';
    }).join('') + '</tbody></table>';
  clicks(wrap, shown, 'discovery');
}

function renderCompTable(items) {
  const q = S.search.toLowerCase();
  const shown = q ? items.filter(c => (c.name || '').toLowerCase().includes(q)) : items;
  $('comp-count').textContent = shown.length + ' empresas';
  const wrap = $('comp-wrap');
  if (!shown.length) { wrap.innerHTML = emptyHTML('\u25a6', 'Sin companies'); return; }

  wrap.innerHTML = '<table translate="no"><thead><tr><th>Company</th><th>Segments</th><th>Feedback</th><th>Users</th><th>Created</th></tr></thead><tbody>' +
    shown.map((c, i) => {
      const fbCount = S.data.feedback.filter(f => f._companyId === String(c.id)).length;
      const userCount = S.data.users.filter(u => String(u.companyId) === String(c.id)).length;
      const segs = (c.segments || []).map(s => s.name).filter(Boolean).join(', ');
      const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
      return '<tr data-i="' + i + '"><td class="td-title">' + esc(c.name || '(sin nombre)') + '</td><td class="td-meta">' + esc(segs || '\u2014') + '</td><td>' + (fbCount > 0 ? '<span class="tag blue">' + fbCount + '</span>' : '<span class="td-meta">0</span>') + '</td><td class="td-meta">' + userCount + '</td><td class="td-date">' + date + '</td></tr>';
    }).join('') + '</tbody></table>';
  clicks(wrap, shown, 'company');
}

function renderMsgTable(items) {
  const wrap = $('msg-wrap');
  if (!items.length) { wrap.innerHTML = emptyHTML('\u2709', 'Sin mensajes'); return; }

  wrap.innerHTML = '<table translate="no"><thead><tr><th>Message</th><th>Channel</th><th>Requester</th><th>Date</th></tr></thead><tbody>' +
    items.map((m, i) => {
      const title = m.title || '';
      const content = m.content || '(sin contenido)';
      const excerpt = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const channel = m.channel || '\u2014';
      const requester = m.requesterId ? (userNameById(m.requesterId) || m.requesterId) : '\u2014';
      const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
      return '<tr data-i="' + i + '"><td>' + (title ? '<div class="td-title">' + esc(title) + '</div>' : '') + '<div class="td-excerpt" style="max-width:420px;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + esc(excerpt.slice(0, 200)) + '</div></td><td><span class="tag gray">' + esc(channel) + '</span></td><td class="td-meta">' + esc(requester) + '</td><td class="td-date">' + date + '</td></tr>';
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

// Sanitize HTML: allow safe tags, strip dangerous ones (script, iframe, etc.)
function sanitizeHTML(html) {
  if (!html) return '';
  const str = String(html);
  // Strip script/iframe/object/embed tags and event handlers
  return str
    .replace(/<\s*(script|iframe|object|embed|form|input|textarea|button)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|form|input|textarea|button)[^>]*\/?>/gi, '')
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+on\w+\s*=\s*\S+/gi, '');
}

function buildDrawer(item, type) {
  const typeLabel = { feedback: 'Feedback', discovery: 'Discovery', company: 'Company', message: 'Mensaje' }[type] || type;
  const typeTag = { feedback: 'blue', discovery: 'teal', company: 'purple', message: 'amber' }[type] || 'gray';
  // Use enriched fields for feedback, standard fields for others
  const title = item._title || item.title || item.name || (item.content || '').slice(0, 70) || (type + ' detail');
  const skip = new Set(['id','title','name','description','content','body','state','component','source','company','discovery','created_at','updated_at','createdAt','updatedAt','feedback_count','feedbacks_count','_title','_content','_source','_company','_companyId','_companyName','_discovery','_discoveryId','_discoveryName','_requester','_requesterName','_date','selections','messageId','discoveryId','clientId','starred','score']);

  const keyFields = [];
  if (type === 'feedback') {
    // Enriched feedback fields
    if (item._content) keyFields.push({ l: 'Contenido', v: item._content, html: true });
    if (item._source) keyFields.push({ l: 'Canal', v: item._source });
    if (item._companyName) keyFields.push({ l: 'Company', v: item._companyName });
    if (item._discoveryName) keyFields.push({ l: 'Discovery', v: item._discoveryName });
    if (item._requesterName) keyFields.push({ l: 'Requester', v: item._requesterName });
    if (item.score !== undefined) keyFields.push({ l: 'Score', v: String(item.score) });
    if (item.starred) keyFields.push({ l: 'Starred', v: '\u2605 S\u00ed' });
    if (item._date) keyFields.push({ l: 'Creado', v: new Date(item._date).toLocaleString('es-ES') });
  } else {
    if (item.description || item.content) keyFields.push({ l: 'Descripci\u00f3n / Contenido', v: item.description || item.content, html: true });
    if (item.discoveryStateId) {
      const stateLabel = S._stateMap && S._stateMap.get(String(item.discoveryStateId));
      keyFields.push({ l: 'Estado', v: stateLabel || item.discoveryStateId });
    }
    if (item.channel) keyFields.push({ l: 'Canal', v: item.channel });
    if (item.assigneeId) keyFields.push({ l: 'Assignee', v: userNameById(item.assigneeId) || item.assigneeId });
    if (item.createdAt) keyFields.push({ l: 'Creado', v: new Date(item.createdAt).toLocaleString('es-ES') });
    if (item.updatedAt) keyFields.push({ l: 'Actualizado', v: new Date(item.updatedAt).toLocaleString('es-ES') });
  }

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
    keyFields.map(f => '<div><div class="field-label">' + esc(f.l) + '</div><div class="field-value' + (f.html ? ' rich-content' : '') + '">' + (f.html ? sanitizeHTML(String(f.v)) : esc(String(f.v))) + '</div></div>').join('') +
    (type === 'discovery' ? '<div class="drawer-section"><div class="drawer-section-title">Feedback vinculado a esta Discovery</div><div id="linked-fb-wrap"><div class="loading-wrap" style="padding:16px;"><div class="spinner"></div></div></div></div>' : '') +
    (otherFields.length ? '<div class="drawer-section"><div class="drawer-section-title">Todos los campos</div>' +
      otherFields.map(([k, v]) => '<div style="margin-bottom:10px;"><div class="field-label">' + esc(k.replace(/_/g, ' ')) + '</div><div class="field-value muted">' + (typeof v === 'object' ? '<pre>' + esc(JSON.stringify(v, null, 2)) + '</pre>' : esc(String(v !== null && v !== undefined ? v : '\u2014'))) + '</div></div>').join('') +
    '</div>' : '') +
  '</div>';
}

async function loadLinkedFb(discId) {
  const el = document.getElementById('linked-fb-wrap');
  if (!el) return;
  // Show feedback already loaded and enriched from local data
  const linked = S.data.feedback.filter(f => String(f.discoveryId) === String(discId));
  if (!linked.length) { el.innerHTML = '<div style="color:var(--text-3);font-size:13px;">Sin feedback vinculado</div>'; return; }
  el.innerHTML = linked.map(f => {
    const title = f._title || '(sin t\u00edtulo)';
    const company = f._companyName;
    const date = f._date ? new Date(f._date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    return '<div class="linked-item" onclick=\'openDrawer(' + JSON.stringify(JSON.stringify(f)) + ',"feedback")\'>' +
      '<div style="font-size:13px;font-weight:500;">' + esc(title) + '</div>' +
      '<div style="font-size:12px;color:var(--text-3);margin-top:3px;">' + [company, date].filter(Boolean).map(esc).join(' \u00b7 ') + '</div></div>';
  }).join('');
}

// ── HELPERS ──────────────────────────────────────
function userNameById(id) {
  if (!id) return null;
  const u = S.data.users.find(u => String(u.id) === String(id));
  return u ? (u.name || u.email || String(u.id)) : null;
}


// ── FILTERS ──────────────────────────────────────
function populateFilters() {
  // Feedback discovery filter (using enriched _discoveryName)
  const discN = new Set(S.data.feedback.map(f => f._discoveryName).filter(Boolean));
  $('flt-fb-disc').innerHTML = '<option value="">Todas las Discoveries</option>' + [...discN].sort().map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');

  // Feedback source/channel filter (using enriched _source)
  const srcN = new Set(S.data.feedback.map(f => f._source).filter(Boolean));
  $('flt-fb-src').innerHTML = '<option value="">Todos los channels</option>' + [...srcN].sort().map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');

  // Feedback company filter
  const fbCompMap = new Map();
  S.data.feedback.forEach(f => {
    if (f._companyId && f._companyName) fbCompMap.set(f._companyId, f._companyName);
  });
  const fbUserEl = $('flt-fb-user');
  if (fbUserEl) {
    if (fbCompMap.size) {
      fbUserEl.innerHTML = '<option value="">Todas las companies</option>' + [...fbCompMap.entries()].sort((a,b) => a[1].localeCompare(b[1])).map(([id, name]) => '<option value="' + esc(id) + '">' + esc(name) + '</option>').join('');
      fbUserEl.style.display = '';
    } else {
      fbUserEl.style.display = 'none';
    }
  }

  // Discovery state filter (using discoveryStateId)
  const stN = new Set(S.data.discoveries.map(d => d.discoveryStateId).filter(Boolean));
  $('flt-disc-state').innerHTML = '<option value="">Todos los estados</option>' + [...stN].map(id => {
    const label = (S._stateMap && S._stateMap.get(String(id))) || ('State ' + String(id).slice(0, 6));
    return '<option value="' + esc(String(id)) + '">' + esc(label) + '</option>';
  }).join('');

  // Discovery assignee filter
  const assigneeMap = new Map();
  S.data.discoveries.forEach(d => {
    if (d.assigneeId) {
      const name = userNameById(d.assigneeId);
      assigneeMap.set(String(d.assigneeId), name || ('User ' + String(d.assigneeId).slice(0, 8)));
    }
  });
  const discUserEl = $('flt-disc-assignee');
  if (discUserEl) {
    discUserEl.innerHTML = '<option value="">Todos los assignees</option>' + [...assigneeMap.entries()].sort((a,b) => a[1].localeCompare(b[1])).map(([id, name]) => '<option value="' + esc(id) + '">' + esc(name) + '</option>').join('');
  }

  // Remove component filter (API doesn't expose component directly on discovery)
  const discCompEl = $('flt-disc-comp');
  if (discCompEl) discCompEl.style.display = 'none';
}

function applyFbFilters() {
  const disc = $('flt-fb-disc').value;
  const src = $('flt-fb-src').value;
  const compId = $('flt-fb-user') ? $('flt-fb-user').value : '';
  S.fil.feedback = S.data.feedback.filter(f => {
    if (disc && f._discoveryName !== disc) return false;
    if (src && f._source !== src) return false;
    if (compId && f._companyId !== compId) return false;
    return true;
  });
  renderFbTable(S.fil.feedback);
}

function applyDiscFilters() {
  const st = $('flt-disc-state').value;
  const assignee = $('flt-disc-assignee') ? $('flt-disc-assignee').value : '';
  S.fil.discoveries = S.data.discoveries.filter(d => {
    if (st && String(d.discoveryStateId) !== st) return false;
    if (assignee && String(d.assigneeId) !== assignee) return false;
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
      id: f.id || '', title: f._title || '',
      content: (f._content || '').replace(/<[^>]+>/g, ' ').replace(/\n/g, ' '),
      channel: f._source || '',
      company: f._companyName || '',
      discovery: f._discoveryName || '',
      requester: f._requesterName || '',
      score: f.score !== undefined ? f.score : '',
      created_at: f._date || ''
    }));
  } else if (S.view === 'discoveries') {
    fn = 'harvestr-discoveries';
    rows = S.fil.discoveries.map(d => ({
      id: d.id || '', title: d.title || '',
      description: (d.description || '').replace(/<[^>]+>/g, ' ').replace(/\n/g, ' '),
      state: d.discoveryStateId ? ((S._stateMap && S._stateMap.get(String(d.discoveryStateId))) || d.discoveryStateId) : '',
      assignee: d.assigneeId ? (userNameById(d.assigneeId) || d.assigneeId) : '',
      feedback_count: S.data.feedback.filter(f => String(f.discoveryId) === String(d.id)).length,
      updated_at: d.updatedAt || ''
    }));
  } else if (S.view === 'companies') {
    fn = 'harvestr-companies';
    rows = S.fil.companies.map(c => ({
      id: c.id || '', name: c.name || '',
      segments: (c.segments || []).map(s => s.name).filter(Boolean).join('; '),
      feedback_count: S.data.feedback.filter(f => f._companyId === String(c.id)).length,
      user_count: S.data.users.filter(u => String(u.companyId) === String(c.id)).length,
      created_at: c.createdAt || ''
    }));
  } else if (S.view === 'messages') {
    fn = 'harvestr-messages';
    rows = S.data.messages.map(m => ({
      id: m.id || '',
      title: m.title || '',
      content: (m.content || '').replace(/<[^>]+>/g, ' ').replace(/\n/g, ' '),
      channel: m.channel || '',
      requester: m.requesterId ? (userNameById(m.requesterId) || m.requesterId) : '',
      created_at: m.createdAt || ''
    }));
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

// ── DASHBOARD CSV EXPORT ─────────────────────────
function exportDashboardCSV() {
  // Export all filtered feedback + discoveries as a combined CSV
  const fbRows = S.data.feedback.map(f => ({
    type: 'feedback',
    id: f.id || '',
    title: f._title || '',
    content: (f._content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\n/g, ' ').slice(0, 500),
    channel: f._source || '',
    company: f._companyName || '',
    discovery: f._discoveryName || '',
    state: '',
    assignee: f._requesterName || '',
    created_at: f._date || ''
  }));
  const discRows = S.data.discoveries.map(d => ({
    type: 'discovery',
    id: d.id || '',
    title: d.title || '',
    content: (d.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/\n/g, ' ').slice(0, 500),
    channel: '',
    company: '',
    discovery: '',
    state: d.discoveryStateId ? ((S._stateMap && S._stateMap.get(String(d.discoveryStateId))) || d.discoveryStateId) : '',
    assignee: d.assigneeId ? (userNameById(d.assigneeId) || d.assigneeId) : '',
    created_at: d.createdAt || d.updatedAt || ''
  }));
  const rows = fbRows.concat(discRows);
  if (!rows.length) { toast('Sin datos para exportar', 'error'); return; }
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(','), ...rows.map(r => keys.map(k => '"' + String(r[k]).replace(/"/g, '""') + '"').join(','))].join('\n');
  const a = document.createElement('a');
  const filterSuffix = S.filters.companyId || S.filters.userId ? '-filtrado' : '';
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'harvestr-dashboard' + filterSuffix + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  toast('Dashboard CSV descargado (' + rows.length + ' filas)', 'success');
}

// ── IMPORT USERS CSV ─────────────────────────────
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  // Parse header
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = [];
    let cur = '', inQuote = false;
    for (let c = 0; c < lines[i].length; c++) {
      const ch = lines[i][c];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, j) => { obj[h] = vals[j] || ''; });
    rows.push(obj);
  }
  return rows;
}

function importUsersCSV(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const rows = parseCSV(e.target.result);
      if (!rows.length) { toast('CSV vac\u00edo', 'error'); return; }
      // Map CSV columns to user objects. Accept: id, name, email (flexible column names)
      const users = rows.map(r => ({
        id: r.id || r.userid || r.user_id || r.externaluid || r.external_uid || '',
        name: r.name || r.nombre || r.fullname || r.full_name || r.username || '',
        email: r.email || r.mail || r.correo || ''
      })).filter(u => u.id || u.name || u.email);

      // Merge with existing users (CSV overrides API data)
      const merged = new Map();
      S.data.users.forEach(u => merged.set(String(u.id), u));
      users.forEach(u => {
        const key = String(u.id || u.email || u.name);
        merged.set(key, u);
      });
      S.data.users = [...merged.values()];

      // Re-populate filters with new user data
      populateFilters();
      if (S.view === 'feedback') renderFbTable(S.fil.feedback);
      if (S.view === 'discoveries') renderDiscTable(S.fil.discoveries);

      $('importUsersInfo').textContent = users.length + ' usuarios cargados';
      $('importUsersInfo').style.display = 'inline';
      toast(users.length + ' usuarios importados del CSV', 'success');
    } catch (err) {
      toast('Error leyendo CSV: ' + err.message, 'error');
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// ── KEYBOARD SHORTCUTS ──────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDrawer();
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); $('globalSearch').focus(); }
  if (e.key === 'Enter' && document.activeElement === $('gate-token')) testGateToken();
});
