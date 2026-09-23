/* Hi World Club — Club desk. Vanilla JS, token stays in the x-admin-token header. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const els = {
    gate: $('#gate'),
    gateForm: $('#gateForm'),
    gateInput: $('#token'),
    gateErr: $('#gateErr'),
    gateHint: $('#gateHint'),
    remember: $('#remember'),
    shell: $('#shell'),
    view: $('#view'),
    pageTitle: $('#pageTitle'),
    crumb: $('#crumb'),
    live: $('#liveChip'),
    alert: $('#alert'),
    demoBanner: $('#demoBanner'),
    demoNote: $('#demoNote'),
    nav: $('#side'),
    navScrim: $('#navScrim'),
    burger: $('#burger'),
    drawer: $('#drawer'),
    drawerScrim: $('#drawerScrim'),
    modal: $('#modal'),
    modalCard: $('#modalCard'),
    confirm: $('#confirm'),
    toast: $('#toast'),
    search: $('#globalSearch'),
    searchPop: $('#searchPop'),
  };

  const COLLECTIONS = ['applications', 'pledges', 'reservations', 'passes'];
  const ROUTES = {
    overview: { title: 'Overview', crumb: 'Desk' },
    applications: { title: 'Applications', crumb: 'People' },
    pledges: { title: 'Book drive', crumb: 'Impact' },
    treks: { title: 'Trek roster', crumb: 'Fieldwork' },
    passes: { title: 'Visitor passes', crumb: 'Cohort' },
    activity: { title: 'Activity', crumb: 'Desk' },
  };
  const STATUS = {
    applications: ['new', 'reviewing', 'accepted', 'waitlisted', 'declined'],
    pledges: ['pledged', 'received', 'cancelled'],
    reservations: ['confirmed', 'checked-in', 'waitlisted', 'cancelled'],
    passes: ['active', 'revoked'],
  };
  const STATUS_LABEL = {
    new: 'New', reviewing: 'Reviewing', accepted: 'Accepted', waitlisted: 'Waitlisted', declined: 'Declined',
    pledged: 'Pledged', received: 'Received', confirmed: 'Confirmed', 'checked-in': 'Checked in',
    cancelled: 'Cancelled', active: 'Active', revoked: 'Revoked',
  };
  const INTEREST_LABEL = { treks: 'Treks', workshops: 'Workshops', csr: 'Book drive' };
  const TREK_LABEL = { alibaba: 'Alibaba HQ · Hangzhou', refinery: 'Refinery Island' };
  const GENRES = ["Children's picture books", 'Middle-grade fiction', 'STEM & science', 'English learning', 'Classics'];
  const TRACKS = ['All-rounder', 'Treks', 'Craft', 'Impact'];

  const state = {
    token: '',
    demo: false,
    detail: null,
    previousFocus: null,
    confirmResolve: null,
    toastTimer: null,
    searchTimer: null,
    viewTimer: null,
    pollTimer: null,
    selected: new Set(),
    searchIndex: -1,
    searchResults: [],
    renderedRoute: null,
    restoreFocus: null,
    loading: false,
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
  const attr = esc;
  const nfmt = (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0);
  const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
  const param = (v) => (v == null ? '' : String(v));
  const classStatus = (s) => `st-${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  function cleanHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const q = raw.indexOf('?');
    const path = q < 0 ? raw : raw.slice(0, q);
    const query = q < 0 ? '' : raw.slice(q + 1);
    const parts = path.split('/').filter(Boolean);
    const view = ROUTES[parts[0]] ? parts[0] : 'overview';
    const id = parts.length > 1 && /^\d+$/.test(parts[1]) ? Number(parts[1]) : null;
    return { view, id, params: new URLSearchParams(query) };
  }

  function hashFor(view, params = new URLSearchParams(), id = null) {
    const path = `#/${view}${id ? `/${id}` : ''}`;
    const search = params.toString();
    return path + (search ? `?${search}` : '');
  }

  function routeHref(view, values = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) if (v != null && v !== '' && v !== 'all') params.set(k, String(v));
    return hashFor(view, params);
  }

  function setQuery(key, value, resetPage = true) {
    const route = cleanHash();
    const p = route.params;
    if (value == null || value === '' || value === 'all') p.delete(key);
    else p.set(key, String(value));
    if (resetPage && key !== 'page') p.delete('page');
    location.hash = hashFor(route.view, p);
  }

  function getTokenStore() {
    return localStorage.getItem('hw_admin_token') || sessionStorage.getItem('hw_admin_token') || '';
  }

  function storeToken(token, remember) {
    localStorage.removeItem('hw_admin_token');
    sessionStorage.removeItem('hw_admin_token');
    if (token) (remember ? localStorage : sessionStorage).setItem('hw_admin_token', token);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (state.token) headers.set('x-admin-token', state.token);
    let body = options.body;
    if (body && typeof body !== 'string' && !(body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    const response = await fetch(path, { ...options, headers, body, cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (response.status === 401) {
      if (state.token && els.shell && !els.shell.hidden) {
        storeToken('', false);
        state.token = '';
        showGate('Your desk key was not accepted. Sign in again.');
      }
      const error = new Error((data && data.error) || 'Unauthorized');
      error.status = 401;
      throw error;
    }
    if (!response.ok) {
      const error = new Error((data && data.error) || `Request failed (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function showGate(message = '') {
    state.detail = null;
    els.shell.hidden = true;
    els.gate.hidden = false;
    els.nav.classList.remove('open');
    els.drawer.classList.remove('open');
    els.drawer.hidden = true;
    els.drawerScrim.classList.remove('open');
    els.drawerScrim.hidden = true;
    els.modal.classList.remove('open');
    els.modal.hidden = true;
    els.confirm.classList.remove('open');
    els.confirm.hidden = true;
    if (state.confirmResolve) state.confirmResolve(false);
    state.confirmResolve = null;
    syncBodyLock();
    document.body.classList.remove('booting');
    els.gateErr.textContent = message;
    els.gateErr.hidden = !message;
    els.gateInput.focus({ preventScroll: true });
    els.searchPop.hidden = true;
    if (state.pollTimer) clearInterval(state.pollTimer);
  }

  function showApp() {
    els.gate.hidden = true;
    els.shell.hidden = false;
    document.body.classList.remove('booting');
    els.gateErr.hidden = true;
    setLive('sync');
    updateBadges().catch(() => {});
    renderRoute();
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      updateBadges().catch(() => {});
      if (cleanHash().view === 'overview' && !document.hidden) renderRoute({ quiet: true });
    }, 45_000);
  }

  function setLive(mode) {
    els.live.classList.remove('sync', 'off');
    if (mode === 'sync') {
      els.live.classList.add('sync');
      els.live.lastElementChild.textContent = 'Syncing';
    } else if (mode === 'off') {
      els.live.classList.add('off');
      els.live.lastElementChild.textContent = 'Offline';
    } else {
      els.live.lastElementChild.textContent = 'Live';
    }
  }

  async function signIn(token, remember) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) {
      els.gateErr.textContent = 'Enter the desk key to continue.';
      els.gateErr.hidden = false;
      els.gateInput.focus();
      return;
    }
    els.gateErr.hidden = true;
    const submit = $('button[type="submit"]', els.gateForm);
    const previousText = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Checking key…';
    state.token = cleanToken;
    try {
      await api('/api/admin/overview');
      storeToken(cleanToken, remember);
      state.demo = false;
      showApp();
      if (!location.hash) location.hash = '#/overview';
    } catch (err) {
      state.token = '';
      els.gateErr.textContent = err.status === 401 ? 'That desk key was not accepted.' : `Could not reach the desk: ${err.message}`;
      els.gateErr.hidden = false;
      els.gateInput.focus();
    } finally {
      submit.disabled = false;
      submit.textContent = previousText;
    }
  }

  async function boot() {
    try {
      const health = await fetch('/api/health', { cache: 'no-store' }).then((r) => r.json());
      els.gateHint.hidden = !health.adminDefault;
    } catch {
      els.gateHint.hidden = true;
    }
    const stored = getTokenStore();
    if (stored) {
      state.token = stored;
      try {
        await api('/api/admin/overview');
        showApp();
        return;
      } catch (err) {
        storeToken('', false);
        state.token = '';
        if (err.status !== 401) {
          els.gateErr.textContent = `The desk could not connect: ${err.message}`;
          els.gateErr.hidden = false;
        }
      }
    }
    showGate();
  }

  function syncBodyLock() {
    const locked = Boolean(
      state.detail || els.nav.classList.contains('open') ||
      (!els.modal.hidden && els.modal.classList.contains('open')) ||
      (!els.confirm.hidden && els.confirm.classList.contains('open'))
    );
    document.body.classList.toggle('lock', locked);
  }

  function toast(message, ms = 3000) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }

  function setAlert(message = '') {
    els.alert.textContent = message;
    els.alert.hidden = !message;
  }

  function restoreSearchFocus() {
    const target = state.restoreFocus;
    if (!target) return;
    state.restoreFocus = null;
    const input = $(`#${target.id}`, els.view);
    if (!input) return;
    input.focus({ preventScroll: true });
    if (typeof input.setSelectionRange === 'function' && target.start != null) {
      input.setSelectionRange(target.start, target.end ?? target.start);
    }
  }

  function niceDate(value, options = {}) {
    if (!value) return '—';
    const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
    if (Number.isNaN(d.getTime())) return esc(value);
    const opts = options.long
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : { month: 'short', day: 'numeric' };
    return new Intl.DateTimeFormat('en-US', opts).format(d);
  }

  function relative(value) {
    if (!value) return '—';
    const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
    if (Number.isNaN(d.getTime())) return '—';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days < 0) return 'just now';
    if (days === 0) {
      const hours = Math.floor((Date.now() - d.getTime()) / 3600000);
      if (hours < 1) return 'less than an hour ago';
      return `${hours}h ago`;
    }
    if (days === 1) return 'yesterday';
    if (days < 14) return `${days}d ago`;
    return niceDate(value);
  }

  function setPage(view) {
    const meta = ROUTES[view] || ROUTES.overview;
    els.crumb.textContent = meta.crumb;
    els.pageTitle.textContent = meta.title;
    $$('[data-nav]', els.nav).forEach((a) => {
      if (a.dataset.nav === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function sparkline(values, color = '#ee6a24') {
    const vals = (values || []).map(Number);
    const max = Math.max(1, ...vals);
    const points = vals.map((v, i) => {
      const x = vals.length < 2 ? 50 : (i / (vals.length - 1)) * 100;
      const y = 27 - (v / max) * 23;
      return `${x},${y}`;
    }).join(' ');
    return `<svg class="spark" viewBox="0 0 100 30" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
  }

  function deltaText(n, label) {
    const sign = Number(n) > 0 ? '+' : '';
    const cls = Number(n) > 0 ? 'up' : Number(n) < 0 ? 'down' : '';
    return `<p class="delta ${cls}">${sign}${nfmt(n)} vs prior 7 days · ${esc(label)}</p>`;
  }

  function bookRing(pledged, goal, size = 140) {
    const pct = goal ? Math.min(100, (pledged / goal) * 100) : 0;
    const r = 42;
    const circumference = 2 * Math.PI * r;
    const dash = (pct / 100) * circumference;
    return `<svg class="donut" style="width:${size}px;height:${size}px" viewBox="0 0 100 100" role="img" aria-label="${nfmt(pledged)} of ${nfmt(goal)} books pledged">
      <circle cx="50" cy="50" r="42" fill="none" stroke="#ebe6dc" stroke-width="9" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="#ee6a24" stroke-width="9" stroke-linecap="round" stroke-dasharray="${dash} ${circumference - dash}" transform="rotate(-90 50 50)" />
      <text class="donut-n" x="50" y="48" text-anchor="middle">${Math.round(pct)}%</text>
      <text class="donut-s" x="50" y="57" text-anchor="middle">OF GOAL</text>
    </svg>`;
  }

  function stackedBars(series) {
    const max = Math.max(1, ...series.applications, ...series.pledgeCount, ...series.reservations, ...series.passes);
    const labels = series.days || [];
    return `<div class="bars" role="img" aria-label="Daily activity across the last fourteen days">
      ${labels.map((day, i) => {
        const a = Number(series.applications[i]) || 0;
        const p = Number(series.pledgeCount[i]) || 0;
        const r = Number(series.reservations[i]) || 0;
        const pass = Number(series.passes[i]) || 0;
        const height = Math.max(3, ((a + p + r + pass) / max) * 112);
        const label = new Date(`${day}T12:00:00Z`).getUTCDate();
        return `<div class="bar-col" title="${esc(day)}: ${a} applications, ${p} pledges, ${r} reservations, ${pass} passes">
          <div class="bar-stack" style="height:${height}px">
            <i style="height:${(a / Math.max(1, a + p + r + pass)) * 100}%;background:#101735"></i>
            <i style="height:${(p / Math.max(1, a + p + r + pass)) * 100}%;background:#ee6a24"></i>
            <i style="height:${(r / Math.max(1, a + p + r + pass)) * 100}%;background:#42769b"></i>
            <i style="height:${(pass / Math.max(1, a + p + r + pass)) * 100}%;background:#4a9a69"></i>
          </div>
          <span>${i % 2 === 0 ? label : ''}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  function feedItems(items) {
    if (!items || !items.length) return '<p class="empty-note">Nothing has happened yet. The first move will show up here.</p>';
    return `<ul class="feed">${items.map((item) => {
      const collection = `${item.type}s` === 'applications' ? 'applications'
        : item.type === 'reservation' ? 'reservations'
          : `${item.type}s`;
      return `<li><a href="${hashFor(collection, new URLSearchParams(), item.ref_id)}">
        <i class="feed-dot ty-${esc(item.type)}" aria-hidden="true"></i>
        <span class="feed-sum">${esc(item.summary)}</span>
        <time datetime="${attr(item.created_at)}">${esc(relative(item.created_at))}</time>
      </a></li>`;
    }).join('')}</ul>`;
  }

  function renderOverviewHtml(data) {
    const k = data.kpis;
    const b = k.books;
    const a = k.applications;
    const r = k.reservations;
    const p = k.passes;
    const maxInterest = Math.max(1, ...Object.values(data.interests || {}));
    const maxGenre = Math.max(1, ...(data.genres || []).map((x) => x.qty));
    return `
      <div class="hero-row">
        <div><p class="eyebrow">A quiet room for the work</p><h2>Good to see you.</h2><p class="lede">A live read on the club — what is moving, what needs a nudge, and where the next seat opens.</p></div>
        <div class="page-actions"><button type="button" class="btn btn-sm" data-act="refresh">↻ Refresh desk</button><a class="btn btn-ink btn-sm" href="${routeHref('applications', { status: 'new' })}">Review new <span aria-hidden="true">→</span></a></div>
      </div>
      <section class="kpi-grid" aria-label="Club totals">
        <a class="kpi" href="${routeHref('pledges')}"><p class="kpi-label">Books pledged</p><p class="kpi-num">${nfmt(b.pledged)}<small>/ ${nfmt(b.goal)}</small></p>${sparkline(data.series.pledges)}<div class="meter"><i style="width:${Math.min(100, (b.pledged / b.goal) * 100)}%"></i></div>${deltaText(b.delta, 'books')}</a>
        <a class="kpi" href="${routeHref('applications', { status: 'new' })}"><p class="kpi-label">Applications waiting</p><p class="kpi-num">${nfmt(a.new)}<small>new</small></p>${sparkline(data.series.applications, '#315b8f')}<p class="kpi-sub">${nfmt(a.reviewing)} in review · ${nfmt(a.accepted)} accepted</p>${deltaText(a.delta, 'applications')}</a>
        <a class="kpi" href="${routeHref('treks')}"><p class="kpi-label">Trek seats used</p><p class="kpi-num">${nfmt(r.active)}<small>/ ${nfmt(r.seats)}</small></p>${sparkline(data.series.reservations, '#42769b')}<p class="kpi-sub">${nfmt(r.seatsLeft)} seats remain · ${nfmt(r.waitlisted)} waitlisted</p><div class="meter"><i style="width:${r.seats ? Math.min(100, (r.active / r.seats) * 100) : 0}%;background:#42769b"></i></div></a>
        <a class="kpi" href="${routeHref('passes')}"><p class="kpi-label">Active visitor passes</p><p class="kpi-num">${nfmt(p.active)}</p>${sparkline(data.series.passes, '#4a9a69')}<p class="kpi-sub">${nfmt(p.byTrack['All-rounder'] || 0)} all-rounders · ${nfmt(p.byTrack.Treks || 0)} trek-focused</p>${deltaText(p.delta, 'passes')}</a>
      </section>

      <section class="split">
        <article class="card">
          <div class="card-head"><div><p class="eyebrow">Last 14 days</p><h3>Club activity</h3></div><ul class="legend"><li><i style="background:#101735"></i>Applications</li><li><i style="background:#ee6a24"></i>Pledges</li><li><i style="background:#42769b"></i>Treks</li><li><i style="background:#4a9a69"></i>Passes</li></ul></div>
          ${stackedBars(data.series)}
          <p class="kpi-sub">Pledges count new pledge records; the book-drive total above counts books.</p>
        </article>
        <article class="card">
          <div class="card-head"><div><p class="eyebrow">The 500-book goal</p><h3>Every shelf starts somewhere.</h3></div></div>
          <div class="donut-row">${bookRing(b.pledged, b.goal, 132)}<ul class="legend stack">
            <li><i style="background:#ee6a24"></i><span><b>${nfmt(b.pledged)}</b> total toward ${nfmt(b.goal)}</span></li>
            <li><i style="background:#101735"></i><span><b>${nfmt(b.base)}</b> historical baseline</span></li>
            <li><i style="background:#f5a15f"></i><span><b>${nfmt(b.siteQty)}</b> pledged on this desk</span></li>
            <li><i style="background:#4a9a69"></i><span><b>${nfmt(b.receivedQty)}</b> received · ${nfmt(b.openQty)} on the way</span></li>
          </ul></div>
          <div class="meter"><i style="width:${Math.min(100, (b.pledged / b.goal) * 100)}%"></i></div>
          <p class="kpi-sub">${b.toGo ? `${nfmt(b.toGo)} more books` : 'Goal reached'} · overview and public site share the same total.</p>
        </article>
      </section>

      <section class="trio">
        <article class="card"><p class="eyebrow">Attention</p><h3>Worth a look</h3>
          ${(data.attention || []).map((x) => `<a class="attn attn-${esc(x.tone)}" href="${attr(x.href)}"><i class="attn-tone"></i><span><strong>${esc(x.title)}</strong><em>${esc(x.detail)}</em></span></a>`).join('') || '<p class="empty-note">All quiet. Nice work.</p>'}
        </article>
        <article class="card"><p class="eyebrow">By genre</p><h3>Books finding their shelf</h3>
          ${(data.genres || []).map((g) => `<div class="hbar"><div class="hbar-top"><span>${esc(g.genre)}</span><b>${nfmt(g.qty)} <small>· ${nfmt(g.received)} in</small></b></div><div class="track"><i style="width:${(g.qty / maxGenre) * 100}%;background:#ee6a24"></i></div></div>`).join('')}
          <a class="linkish" href="#/pledges">Open the book drive →</a>
        </article>
        <article class="card"><p class="eyebrow">Where people lean in</p><h3>Interest signals</h3>
          ${Object.entries(data.interests || {}).map(([key, count]) => `<div class="hbar"><div class="hbar-top"><span>${esc(INTEREST_LABEL[key] || key)}</span><b>${nfmt(count)}</b></div><div class="track"><i style="width:${(count / maxInterest) * 100}%;background:#315b8f"></i></div></div>`).join('')}
          <p class="kpi-sub">From all applications except declined ones.</p>
        </article>
      </section>

      <section class="trek-grid" aria-label="Trek capacity">
        ${(data.treks || []).map((t) => `<a class="trek-card" href="${routeHref('treks', { trek: t.id })}">
          <img src="${attr(t.image)}" alt="" loading="lazy" />
          <div class="trek-card-body"><p class="eyebrow">${esc(t.location)} · ${esc(t.days)}</p><h3>${esc(t.name)}</h3><p>${nfmt(t.taken)} of ${nfmt(t.seats)} seats · ${nfmt(t.left)} left · ${nfmt(t.waitlisted)} waiting</p><div class="meter"><i style="width:${t.seats ? Math.min(100, (t.taken / t.seats) * 100) : 0}%"></i></div></div>
        </a>`).join('')}
      </section>

      <section class="card" style="margin-top:12px"><div class="card-head"><div><p class="eyebrow">Just now, and not so long ago</p><h3>Recent activity</h3></div><a class="linkish" href="#/activity">Full activity log →</a></div>${feedItems(data.recent)}</section>
      <p class="kpi-sub" style="text-align:right">Updated ${esc(niceDate(data.generatedAt, { long: true }))}</p>`;
  }

  async function renderOverview(quiet = false) {
    const startedHash = location.hash;
    try {
      const data = await api('/api/admin/overview');
      if (cleanHash().view !== 'overview') return;
      state.demo = !!data.demo;
      setDemo(data.demo);
      els.view.innerHTML = renderOverviewHtml(data);
      setLive('live');
      setAlert('');
    } catch (err) {
      if (cleanHash().view !== 'overview') return;
      setLive('off');
      if (!quiet) setAlert(`Could not load the overview. ${err.message}`);
      if (!quiet) els.view.innerHTML = `<div class="empty"><h3>The desk is out of reach.</h3><p>${esc(err.message)}</p><button class="btn" type="button" data-act="refresh">Try again</button></div>`;
    }
  }

  function setDemo(isDemo) {
    state.demo = !!isDemo;
    els.demoBanner.hidden = !state.demo || sessionStorage.getItem('hw_demo_dismissed') === '1';
    els.demoNote.hidden = !state.demo;
  }

  async function updateBadges() {
    const data = await api('/api/admin/badges');
    setDemo(data.demo);
    const appBadge = $('[data-badge="applications"]');
    appBadge.textContent = data.newApplications > 99 ? '99+' : data.newApplications;
    appBadge.hidden = !data.newApplications;
    const overviewBadge = $('[data-badge="overview"]');
    overviewBadge.textContent = data.attention > 99 ? '99+' : data.attention;
    overviewBadge.hidden = !data.attention;
    const trekBadge = $('[data-badge="treks"]');
    if (trekBadge) {
      trekBadge.textContent = data.waitlisted > 99 ? '99+' : data.waitlisted;
      trekBadge.hidden = !data.waitlisted;
    }
  }

  function buildStatusOptions(collection, selected, includeAll = false) {
    const statuses = STATUS[collection] || [];
    return `${includeAll ? '<option value="all">All statuses</option>' : ''}${statuses.map((s) => `<option value="${attr(s)}" ${s === selected ? 'selected' : ''}>${esc(STATUS_LABEL[s] || s)}</option>`).join('')}`;
  }

  function statusSelect(collection, row, compact = false) {
    return `<select class="pill-select ${classStatus(row.status)}" aria-label="Status for ${attr(row.name)}" data-act="status-change" data-type="${collection}" data-id="${row.id}">${buildStatusOptions(collection, row.status)}</select>`;
  }

  function statusCount(status, counts) {
    return `<b>${nfmt(counts?.[status] || 0)}</b>`;
  }

  function statusChips(collection, current, counts) {
    const allCount = Object.values(counts || {}).reduce((sum, n) => sum + Number(n || 0), 0);
    const labels = [['all', 'All', allCount], ...STATUS[collection].map((s) => [s, STATUS_LABEL[s], counts?.[s] || 0])];
    return `<div class="chips" role="group" aria-label="Filter by status">${labels.map(([value, label, count]) => `<button type="button" class="chip ${current === value || (!current && value === 'all') ? 'on' : ''}" data-act="filter" data-key="status" data-value="${attr(value)}" aria-pressed="${current === value || (!current && value === 'all')}">${esc(label)} ${statusCount(value, value === 'all' ? { all: count } : counts)}</button>`).join('')}</div>`;
  }

  function filterSelect(label, key, selected, values) {
    return `<label class="sr-only" for="filter-${key}">${esc(label)}</label><select id="filter-${key}" class="filter-select" data-act="select-filter" data-key="${attr(key)}"><option value="all">All ${esc(label.toLowerCase())}</option>${values.map(([v, title]) => `<option value="${attr(v)}" ${selected === v ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select>`;
  }

  function commonPageHead(collection, typeLabel, total, addLabel) {
    const route = cleanHash();
    const q = route.params.get('q') || '';
    return `<div class="page-head"><div><p class="eyebrow">Club desk · ${esc(typeLabel)}</p><h2 class="page-title">${esc(ROUTES[route.view].title)}</h2><p class="kpi-sub">${nfmt(total)} record${total === 1 ? '' : 's'} in the desk.</p></div><div class="page-actions">
      <button class="btn btn-sm" type="button" data-act="export" data-type="${collection}">↓ Export CSV</button>
      ${collection === 'reservations' ? '<button class="btn btn-sm" type="button" data-act="print">▤ Print roster</button>' : ''}
      <button class="btn btn-ink btn-sm" type="button" data-act="add" data-type="${collection}">＋ ${esc(addLabel)}</button>
    </div></div>`;
  }

  function sortHead(label, key, sort, dir) {
    const aria = sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th aria-sort="${aria}"><button type="button" data-act="sort" data-sort="${key}">${esc(label)}</button></th>`;
  }

  function personCell(row, collection) {
    const sub = collection === 'applications' ? row.org || 'School not listed'
      : collection === 'passes' ? `${row.track} track`
        : collection === 'reservations' ? TREK_LABEL[row.trek] || row.trek
          : `${row.qty} ${Number(row.qty) === 1 ? 'book' : 'books'} · ${row.genre}`;
    return `<button type="button" class="name-btn" data-act="open" data-type="${collection}" data-id="${row.id}">${esc(row.name)}</button><span class="sub">${esc(sub)}</span>`;
  }

  function rowCreated(row) {
    return `<span title="${attr(niceDate(row.created_at, { long: true }))}">${esc(relative(row.created_at))}</span>`;
  }

  function renderApplicationRow(row) {
    const interests = (row.interests || []).map((i) => `<i>${esc(INTEREST_LABEL[i] || i)}</i>`).join('') || '<span class="sub">No interests listed</span>';
    return `<tr>
      <td class="check-cell"><input type="checkbox" data-act="select-row" data-id="${row.id}" aria-label="Select ${attr(row.name)}" /></td>
      <td>${personCell(row, 'applications')}</td>
      <td><span class="wc">${esc(row.wc)}</span> <button class="copy-btn" type="button" data-act="copy" data-copy="${attr(row.wc)}" aria-label="Copy WeChat ID">⧉</button></td>
      <td><div class="mini">${interests}</div></td>
      <td>${statusSelect('applications', row)}</td>
      <td>${rowCreated(row)}</td>
      <td class="row-actions"><button class="linkish" type="button" data-act="open" data-type="applications" data-id="${row.id}">Details</button></td>
    </tr>`;
  }

  function renderPledgeRow(row) {
    return `<tr>
      <td class="check-cell"><input type="checkbox" data-act="select-row" data-id="${row.id}" aria-label="Select ${attr(row.name)}'s pledge" /></td>
      <td>${personCell(row, 'pledges')}</td>
      <td>${esc(row.genre)}</td>
      <td><strong>${nfmt(row.qty)}</strong></td>
      <td>${statusSelect('pledges', row)}</td>
      <td>${rowCreated(row)}</td>
      <td class="row-actions"><button class="linkish" type="button" data-act="open" data-type="pledges" data-id="${row.id}">Details</button></td>
    </tr>`;
  }

  function renderReservationRow(row) {
    return `<tr>
      <td class="check-cell"><input type="checkbox" data-act="select-row" data-id="${row.id}" aria-label="Select ${attr(row.name)}'s reservation" /></td>
      <td>${personCell(row, 'reservations')}</td>
      <td><span class="wc">${esc(row.wc)}</span> <button class="copy-btn" type="button" data-act="copy" data-copy="${attr(row.wc)}" aria-label="Copy WeChat ID">⧉</button></td>
      <td>${statusSelect('reservations', row)}</td>
      <td>${rowCreated(row)}</td>
      <td class="row-actions"><button class="linkish" type="button" data-act="open" data-type="reservations" data-id="${row.id}">Details</button></td>
    </tr>`;
  }

  function renderPassRow(row) {
    return `<tr>
      <td class="check-cell"><input type="checkbox" data-act="select-row" data-id="${row.id}" aria-label="Select ${attr(row.name)}'s pass" /></td>
      <td>${personCell(row, 'passes')}</td>
      <td>${esc(row.track)}</td>
      <td>${statusSelect('passes', row)}</td>
      <td>${rowCreated(row)}</td>
      <td class="row-actions"><button class="linkish" type="button" data-act="open" data-type="passes" data-id="${row.id}">Details</button></td>
    </tr>`;
  }

  function skeletonRow(cols) {
    return `<tr class="skel-row">${Array.from({ length: cols }, () => '<td><i class="skel" style="width:74%"></i></td>').join('')}</tr>`;
  }

  function trekCapacityCards(capacity = []) {
    return `<div class="track-grid">${capacity.map((t) => `<article class="track-card">
      <span>${esc(t.name)}</span><b>${nfmt(t.taken)}<small style="font:500 15px var(--sans);color:var(--muted)"> / ${nfmt(t.seats)}</small></b>
      <div class="track"><i style="width:${t.seats ? Math.min(100, (t.taken / t.seats) * 100) : 0}%;background:#315b8f"></i></div>
      <p class="kpi-sub">${nfmt(t.left)} open · ${nfmt(t.waitlisted)} waitlisted · ${nfmt(t.checkedIn)} checked in</p>
      <button type="button" class="linkish" data-act="filter" data-key="trek" data-value="${attr(t.id)}">View roster →</button>
    </article>`).join('')}</div>`;
  }

  function bookDriveSummary(books) {
    if (!books) return '';
    return `<article class="card books-hero" style="margin-bottom:12px">
      <div class="ring-wrap">${bookRing(books.pledged, books.goal, 160)}<div class="ring-label"><div><b>${nfmt(books.pledged)}</b><span>of ${nfmt(books.goal)}</span></div></div></div>
      <div><p class="eyebrow">The collection</p><h3 style="margin:4px 0 2px">A book for the next kid.</h3><p class="kpi-sub">${nfmt(books.base)} historical baseline + ${nfmt(books.siteQty)} pledged on the desk = ${nfmt(books.pledged)} toward ${nfmt(books.goal)}.</p>
        <div class="stat-pills"><span><b>${nfmt(books.receivedQty)}</b>Received</span><span><b>${nfmt(books.openQty)}</b>Still pledged</span><span><b>${nfmt(books.toGo)}</b>To goal</span></div>
      </div>
    </article>`;
  }

  function toolbar(collection, route, payload) {
    const params = route.params;
    const status = params.get('status') || 'all';
    let extra = '';
    if (collection === 'applications') {
      extra = filterSelect('interest', 'interest', params.get('interest') || 'all', [['treks', 'Treks'], ['workshops', 'Workshops'], ['csr', 'Book drive']]);
    } else if (collection === 'reservations') {
      extra = filterSelect('trek', 'trek', params.get('trek') || 'all', [['alibaba', 'Alibaba HQ'], ['refinery', 'Refinery Island']]);
    } else if (collection === 'passes') {
      extra = filterSelect('track', 'track', params.get('track') || 'all', TRACKS.map((x) => [x, x]));
    } else if (collection === 'pledges') {
      extra = filterSelect('genre', 'genre', params.get('genre') || 'all', GENRES.map((x) => [x, x]));
    }
    return `${statusChips(collection, status, payload.facets?.status || {})}
      <div class="toolbar"><input id="listSearch" type="search" value="${attr(params.get('q') || '')}" placeholder="Search this list…" aria-label="Search this list" />
      ${extra}<span class="toolbar-meta">${nfmt(payload.total)} results · page ${payload.page} of ${payload.pages}</span></div>`;
  }

  function tableFor(collection, items, route) {
    const sort = route.params.get('sort') || 'created_at';
    const dir = route.params.get('dir') || 'desc';
    const cells = collection === 'applications'
      ? `<table><caption class="sr-only">Member applications</caption><thead><tr><th class="check-cell"><input type="checkbox" data-act="select-page" aria-label="Select all on this page" /></th>${sortHead('Applicant', 'name', sort, dir)}<th>WeChat ID</th><th>Interests</th>${sortHead('Status', 'status', sort, dir)}${sortHead('Applied', 'created_at', sort, dir)}<th></th></tr></thead><tbody>${items.map(renderApplicationRow).join('')}</tbody></table>`
      : collection === 'pledges'
        ? `<table><caption class="sr-only">Book pledges</caption><thead><tr><th class="check-cell"><input type="checkbox" data-act="select-page" aria-label="Select all on this page" /></th>${sortHead('Donor', 'name', sort, dir)}${sortHead('Genre', 'genre', sort, dir)}${sortHead('Qty', 'qty', sort, dir)}${sortHead('Status', 'status', sort, dir)}${sortHead('Pledged', 'created_at', sort, dir)}<th></th></tr></thead><tbody>${items.map(renderPledgeRow).join('')}</tbody></table>`
        : collection === 'reservations'
          ? `<table><caption class="sr-only">Trek reservations</caption><thead><tr><th class="check-cell"><input type="checkbox" data-act="select-page" aria-label="Select all on this page" /></th>${sortHead('Visitor', 'name', sort, dir)}<th>WeChat ID</th>${sortHead('Status', 'status', sort, dir)}${sortHead('Reserved', 'created_at', sort, dir)}<th></th></tr></thead><tbody>${items.map(renderReservationRow).join('')}</tbody></table>`
          : `<table><caption class="sr-only">Visitor passes</caption><thead><tr><th class="check-cell"><input type="checkbox" data-act="select-page" aria-label="Select all on this page" /></th>${sortHead('Visitor', 'name', sort, dir)}${sortHead('Track', 'track', sort, dir)}${sortHead('Status', 'status', sort, dir)}${sortHead('Issued', 'created_at', sort, dir)}<th></th></tr></thead><tbody>${items.map(renderPassRow).join('')}</tbody></table>`;
    return `<div class="table-card"><div class="table-wrap">${cells}</div>${items.length ? '' : `<div class="empty"><h3>No ${collection === 'applications' ? 'applications' : collection === 'pledges' ? 'pledges' : collection === 'reservations' ? 'reservations' : 'passes'} here.</h3><p>Try another filter or record a new one.</p><button type="button" class="btn btn-ink btn-sm" data-act="add" data-type="${collection}">＋ Add a record</button></div>`}</div>`;
  }

  function pager(total, page, pages) {
    return `<div class="pager"><span>${nfmt(total)} total</span><button type="button" class="btn btn-sm" data-act="page" data-page="${Math.max(1, page - 1)}" ${page <= 1 ? 'disabled' : ''}>← Newer</button><span>${page} / ${pages}</span><button type="button" class="btn btn-sm" data-act="page" data-page="${Math.min(pages, page + 1)}" ${page >= pages ? 'disabled' : ''}>Older →</button></div>`;
  }

  function bulkToolbar(collection) {
    const statuses = STATUS[collection] || [];
    return `<div class="bulk" data-bulk hidden><span><b data-selected-count>0</b> selected</span>
      ${statuses.map((s) => `<button type="button" class="btn btn-sm" data-act="bulk-status" data-status="${attr(s)}">Mark ${esc(STATUS_LABEL[s])}</button>`).join('')}
      <button type="button" class="btn btn-sm" data-act="bulk-clear">Clear</button></div>`;
  }

  async function renderCollection(collection) {
    state.selected.clear();
    const startedHash = location.hash;
    const route = cleanHash();
    const query = new URLSearchParams(route.params);
    if (!query.has('limit')) query.set('limit', '12');
    try {
      const payload = await api(`/api/admin/${collection}?${query.toString()}`);
      if (location.hash !== startedHash) return;
      let header = '';
      const label = collection === 'applications' ? 'People & applications'
        : collection === 'pledges' ? 'Collection & giving'
          : collection === 'reservations' ? 'Capacity & fieldwork' : 'Access & cohort';
      const add = collection === 'applications' ? 'Add applicant'
        : collection === 'pledges' ? 'Record pledge'
          : collection === 'reservations' ? 'Add visitor' : 'Issue pass';
      header = commonPageHead(collection, label, payload.total, add);
      let extra = '';
      if (collection === 'reservations') extra = trekCapacityCards(payload.capacity || []);
      if (collection === 'pledges') extra = bookDriveSummary(payload.books);
      const content = `${header}${extra}${toolbar(collection, route, payload)}<div class="print-only">Hi World Club · ${esc(ROUTES[route.view].title)} · printed ${esc(niceDate(new Date().toISOString(), { long: true }))}</div>
        ${payload.items.length ? tableFor(collection, payload.items, route) : tableFor(collection, [], route)}${pager(payload.total, payload.page, payload.pages)}${bulkToolbar(collection)}`;
      els.view.innerHTML = content;
      restoreSearchFocus();
      setLive('live');
      setAlert('');
      if (route.id && (!state.detail || state.detail.collection !== collection || state.detail.id !== Number(route.id))) {
        openDrawer(collection, route.id, { noHash: true });
      }
      await updateBadges().catch(() => {});
    } catch (err) {
      if (location.hash !== startedHash) return;
      setLive('off');
      setAlert(`Could not load this list. ${err.message}`);
      els.view.innerHTML = `<div class="empty"><h3>The roster did not load.</h3><p>${esc(err.message)}</p><button class="btn" type="button" data-act="refresh">Try again</button></div>`;
    }
  }

  function collectionForView(view) {
    return view === 'treks' ? 'reservations' : view;
  }

  async function renderActivity() {
    const startedHash = location.hash;
    const route = cleanHash();
    const params = new URLSearchParams(route.params);
    if (!params.has('limit')) params.set('limit', '20');
    try {
      const data = await api(`/api/admin/activity?${params.toString()}`);
      if (location.hash !== startedHash) return;
      const currentType = route.params.get('type') || 'all';
      const q = route.params.get('q') || '';
      const types = [['all', 'Everything', Object.values(data.facets).reduce((x, n) => x + n, 0)], ...Object.entries(data.facets).map(([key, value]) => [key, key[0].toUpperCase() + key.slice(1), value])];
      els.view.innerHTML = `<div class="page-head"><div><p class="eyebrow">A trail of small decisions</p><h2 class="page-title">Activity</h2><p class="kpi-sub">${nfmt(data.total)} events · the most recent 500 are retained.</p></div><div class="page-actions"><button class="btn btn-sm" type="button" data-act="export-activity">↓ Export CSV</button></div></div>
        <div class="chips" role="group" aria-label="Filter activity">${types.map(([type, label, count]) => `<button class="chip ${currentType === type ? 'on' : ''}" type="button" data-act="filter" data-key="type" data-value="${attr(type)}">${esc(label)} <b>${nfmt(count)}</b></button>`).join('')}</div>
        <div class="toolbar"><input id="activitySearch" type="search" value="${attr(q)}" placeholder="Search the log…" aria-label="Search activity" /><span class="toolbar-meta">${nfmt(data.total)} events</span></div>
        <div class="table-card"><div class="table-wrap"><table style="min-width:600px"><caption class="sr-only">Club activity</caption><thead><tr><th>Event</th><th>Record</th><th>When</th><th></th></tr></thead><tbody>
        ${(data.items || []).map((e) => `<tr><td><i class="feed-dot ty-${attr(e.type)}" style="display:inline-block;vertical-align:middle;margin-right:8px"></i>${esc(e.summary)}</td><td>${esc(e.type)}</td><td title="${attr(niceDate(e.created_at, { long: true }))}">${esc(relative(e.created_at))}</td><td class="row-actions">${e.action === 'deleted' ? '<span class="sub">Removed</span>' : `<button type="button" class="linkish" data-act="open" data-type="${e.type === 'reservation' ? 'reservations' : `${e.type}s`}" data-id="${e.ref_id}">Open</button>`}</td></tr>`).join('')}
        </tbody></table></div>${data.items.length ? '' : '<div class="empty"><h3>No events found.</h3><p>Change the filter or search again.</p></div>'}</div>${pager(data.total, data.page, data.pages)}`;
      restoreSearchFocus();
      setLive('live');
      setAlert('');
    } catch (err) {
      if (location.hash !== startedHash) return;
      setLive('off');
      setAlert(`Could not load activity. ${err.message}`);
      els.view.innerHTML = `<div class="empty"><h3>The log did not load.</h3><p>${esc(err.message)}</p><button class="btn" type="button" data-act="refresh">Try again</button></div>`;
    }
  }

  async function renderRoute(options = {}) {
    if (!state.token || els.shell.hidden) return;
    const route = cleanHash();
    state.renderedRoute = route;
    setPage(route.view);
    closeNav();
    if (state.detail && !route.id) closeDrawer({ noHash: true });
    setAlert('');
    if (route.view === 'overview') await renderOverview(!!options.quiet);
    else if (route.view === 'activity') await renderActivity();
    else await renderCollection(collectionForView(route.view));
    if (route.id && !state.detail) {
      const collection = collectionForView(route.view);
      openDrawer(collection, route.id, { noHash: true });
    }
  }

  function routeTo(view, params) {
    const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
    location.hash = hashFor(view, p);
  }

  function statusOptionsHtml(collection, current) {
    return STATUS[collection].map((s) => `<option value="${attr(s)}" ${s === current ? 'selected' : ''}>${esc(STATUS_LABEL[s])}</option>`).join('');
  }

  function metaCell(label, value, copy = false) {
    if (copy) return `<div><dt>${esc(label)}</dt><dd><span class="wc">${esc(value || '—')}</span>${value ? ` <button type="button" class="copy-btn" data-act="copy" data-copy="${attr(value)}" aria-label="Copy ${attr(label)}">⧉</button>` : ''}</dd></div>`;
    return `<div><dt>${esc(label)}</dt><dd>${esc(value || '—')}</dd></div>`;
  }

  function detailMeta(collection, row) {
    if (collection === 'applications') return `<dl class="meta">${metaCell('WeChat', row.wc, true)}${metaCell('School / organization', row.org)}${metaCell('Applied', niceDate(row.created_at, { long: true }))}${metaCell('Last updated', niceDate(row.updated_at, { long: true }))}</dl>`;
    if (collection === 'pledges') return `<dl class="meta">${metaCell('Books', row.qty)}${metaCell('Genre', row.genre)}${metaCell('Pledged', niceDate(row.created_at, { long: true }))}${metaCell('Updated', niceDate(row.updated_at, { long: true }))}</dl>`;
    if (collection === 'reservations') return `<dl class="meta">${metaCell('WeChat', row.wc, true)}${metaCell('Trek', TREK_LABEL[row.trek] || row.trek)}${metaCell('Reserved', niceDate(row.created_at, { long: true }))}${metaCell('Updated', niceDate(row.updated_at, { long: true }))}</dl>`;
    return `<dl class="meta">${metaCell('Track', row.track)}${metaCell('Issued', niceDate(row.created_at, { long: true }))}${metaCell('Updated', niceDate(row.updated_at, { long: true }))}</dl>`;
  }

  function detailEditor(collection, row) {
    const input = (key, label, value, type = 'text') => `<div class="field"><label for="edit-${key}">${esc(label)}</label><input id="edit-${key}" name="${key}" value="${attr(value || '')}" type="${type}" /></div>`;
    let fields = '';
    if (collection === 'applications') {
      fields = `${input('name', 'Name', row.name)}${input('wc', 'WeChat ID', row.wc)}${input('org', 'School / organization', row.org)}
      <div class="field full"><label>Interests</label><div class="checks">${Object.entries(INTEREST_LABEL).map(([key, label]) => `<label class="check"><input type="checkbox" name="interests" value="${key}" ${(row.interests || []).includes(key) ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div></div>
      <div class="field full"><label for="edit-msg">Message</label><textarea id="edit-msg" name="msg">${esc(row.msg || '')}</textarea></div>`;
    } else if (collection === 'pledges') {
      fields = `${input('name', 'Donor', row.name)}<div class="field"><label for="edit-genre">Genre</label><select id="edit-genre" name="genre">${GENRES.map((g) => `<option ${g === row.genre ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>${input('qty', 'Quantity', row.qty, 'number')}`;
    } else if (collection === 'passes') {
      fields = `${input('name', 'Visitor', row.name)}<div class="field"><label for="edit-track">Track</label><select id="edit-track" name="track">${TRACKS.map((t) => `<option ${t === row.track ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
    } else {
      fields = `${input('name', 'Visitor', row.name)}${input('wc', 'WeChat ID', row.wc)}<div class="field full"><label for="edit-trek">Trek</label><select id="edit-trek" name="trek"><option value="alibaba" ${row.trek === 'alibaba' ? 'selected' : ''}>Alibaba HQ · Hangzhou</option><option value="refinery" ${row.trek === 'refinery' ? 'selected' : ''}>Refinery Island</option></select></div>`;
    }
    return `<details class="edit"><summary>Edit record details</summary><form data-form="edit-record" data-type="${collection}" data-id="${row.id}"><div class="form-grid">${fields}</div><div class="dialog-actions"><button type="submit" class="btn btn-ink btn-sm">Save details</button></div></form></details>`;
  }

  function renderDrawer(collection, item, events = []) {
    const title = item.name || 'Record';
    const typeLabel = collection === 'applications' ? 'Application' : collection === 'pledges' ? 'Book pledge' : collection === 'reservations' ? 'Trek reservation' : 'Visitor pass';
    let summary = '';
    if (collection === 'applications') {
      summary = `${(item.interests || []).map((i) => `<span class="pill st-reviewing">${esc(INTEREST_LABEL[i] || i)}</span>`).join(' ')}${item.msg ? `<h3>What they said</h3><blockquote class="quote">${esc(item.msg)}</blockquote>` : ''}`;
    } else if (collection === 'pledges') {
      summary = `<p class="lede">${nfmt(item.qty)} ${Number(item.qty) === 1 ? 'book' : 'books'} · ${esc(item.genre)}</p>`;
    } else if (collection === 'reservations') {
      summary = `<p class="lede">${esc(TREK_LABEL[item.trek] || item.trek)} · ${esc(item.status === 'checked-in' ? 'Checked in' : item.status === 'waitlisted' ? 'On waitlist' : 'Field roster')}</p>`;
    } else {
      summary = `<p class="lede">${esc(item.track)} track</p>`;
    }
    const eventHtml = events.length
      ? `<ul class="timeline">${events.map((e) => `<li><strong>${esc(e.summary)}</strong><span class="sub">${esc(niceDate(e.created_at, { long: true }))}</span></li>`).join('')}</ul>`
      : '<p class="kpi-sub">No earlier changes.</p>';
    const statusSelectHtml = `<div class="field"><label for="drawerStatus">Status</label><select id="drawerStatus" class="pill-select ${classStatus(item.status)}" data-act="detail-status" data-type="${collection}" data-id="${item.id}">${statusOptionsHtml(collection, item.status)}</select></div>`;
    els.drawer.innerHTML = `<div class="drawer-head"><p class="eyebrow">${esc(typeLabel)} · #${item.id}</p><h2 id="drawerTitle">${esc(title)}</h2><button class="icon-btn drawer-x" type="button" data-act="close-drawer" aria-label="Close details">×</button></div>
      <div class="drawer-body">${statusSelectHtml}${detailMeta(collection, item)}${summary}${detailEditor(collection, item)}
        <form data-form="save-notes" data-type="${collection}" data-id="${item.id}"><div class="field"><label for="notes">Private desk notes</label><textarea id="notes" name="notes" maxlength="2000" placeholder="Keep useful context for the next person…">${esc(item.notes || '')}</textarea></div><button type="submit" class="btn btn-ink btn-sm">Save note</button></form>
        <h3>Record history</h3>${eventHtml}
        <div class="danger-zone"><button type="button" class="btn btn-sm btn-danger" data-act="delete" data-type="${collection}" data-id="${item.id}">Remove this record</button></div>
      </div>`;
    els.drawer.hidden = false;
    els.drawerScrim.hidden = false;
    requestAnimationFrame(() => {
      els.drawer.classList.add('open');
      els.drawerScrim.classList.add('open');
    });
    syncBodyLock();
    const x = $('.drawer-x', els.drawer);
    x?.focus({ preventScroll: true });
  }

  async function openDrawer(collection, id, options = {}) {
    if (!COLLECTIONS.includes(collection)) return;
    closeNav();
    state.previousFocus = document.activeElement;
    state.detail = { collection, id: Number(id) };
    if (!options.noHash) {
      const route = cleanHash();
      const baseView = route.view === 'activity' ? (collection === 'reservations' ? 'treks' : collection) : route.view;
      location.hash = hashFor(baseView, route.params, Number(id));
    }
    els.drawer.hidden = false;
    els.drawer.innerHTML = `<div class="drawer-head"><p class="eyebrow">Loading record</p><h2 id="drawerTitle">One moment…</h2><button class="icon-btn drawer-x" type="button" data-act="close-drawer" aria-label="Close details">×</button></div><div class="drawer-body"><i class="skel" style="width:70%;height:18px"></i></div>`;
    els.drawerScrim.hidden = false;
    requestAnimationFrame(() => {
      els.drawer.classList.add('open');
      els.drawerScrim.classList.add('open');
    });
    syncBodyLock();
    try {
      const result = await api(`/api/admin/${collection}/${id}`);
      if (!state.detail || state.detail.id !== Number(id) || state.detail.collection !== collection) return;
      renderDrawer(collection, result.item, result.activity);
    } catch (err) {
      if (err.status === 404) {
        toast('That record is no longer on the desk.');
        closeDrawer();
      } else {
        els.drawer.innerHTML = `<div class="drawer-head"><p class="eyebrow">${esc(collection)}</p><h2 id="drawerTitle">Could not open</h2><button class="icon-btn drawer-x" type="button" data-act="close-drawer" aria-label="Close details">×</button></div><div class="drawer-body"><p>${esc(err.message)}</p></div>`;
      }
    }
  }

  function closeDrawer(options = {}) {
    if (!state.detail && els.drawer.hidden) return;
    state.detail = null;
    els.drawer.classList.remove('open');
    els.drawerScrim.classList.remove('open');
    syncBodyLock();
    setTimeout(() => {
      if (!els.drawer.classList.contains('open')) {
        els.drawer.hidden = true;
        els.drawerScrim.hidden = true;
      }
    }, 320);
    if (!options.noHash) {
      const route = cleanHash();
      if (route.id) location.hash = hashFor(route.view, route.params);
    }
    if (state.previousFocus && typeof state.previousFocus.focus === 'function') state.previousFocus.focus({ preventScroll: true });
  }

  function statusTag(status) {
    return `<span class="pill ${classStatus(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
  }

  function addModal(collection) {
    const titles = { applications: 'Add an applicant', pledges: 'Record a book pledge', passes: 'Issue a visitor pass', reservations: 'Add a trek visitor' };
    const heading = titles[collection];
    let fields = '';
    if (collection === 'applications') {
      fields = `<div class="field"><label for="add-name">Name *</label><input id="add-name" name="name" required maxlength="80" /></div>
        <div class="field"><label for="add-wc">WeChat ID *</label><input id="add-wc" name="wc" required maxlength="60" /></div>
        <div class="field full"><label for="add-org">School / organization</label><input id="add-org" name="org" maxlength="120" /></div>
        <div class="field full"><label>Interests</label><div class="checks">${Object.entries(INTEREST_LABEL).map(([key, label]) => `<label class="check"><input type="checkbox" name="interests" value="${key}"><span>${esc(label)}</span></label>`).join('')}</div></div>
        <div class="field full"><label for="add-msg">Message</label><textarea id="add-msg" name="msg" maxlength="2000"></textarea></div>
        <div class="field"><label for="add-status">Status</label><select id="add-status" name="status">${statusOptionsHtml(collection, 'new')}</select></div>`;
    } else if (collection === 'pledges') {
      fields = `<div class="field"><label for="add-name">Donor name</label><input id="add-name" name="name" maxlength="40" placeholder="Anonymous" /></div>
        <div class="field"><label for="add-qty">Quantity *</label><input id="add-qty" name="qty" type="number" min="1" max="20" step="1" required value="1" /></div>
        <div class="field full"><label for="add-genre">Book genre *</label><select id="add-genre" name="genre" required>${GENRES.map((g) => `<option>${esc(g)}</option>`).join('')}</select></div>
        <div class="field"><label for="add-status">Status</label><select id="add-status" name="status">${statusOptionsHtml(collection, 'pledged')}</select></div>`;
    } else if (collection === 'passes') {
      fields = `<div class="field"><label for="add-name">Visitor name *</label><input id="add-name" name="name" required maxlength="28" /></div>
        <div class="field"><label for="add-track">Track *</label><select id="add-track" name="track" required>${TRACKS.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div class="field"><label for="add-status">Status</label><select id="add-status" name="status">${statusOptionsHtml(collection, 'active')}</select></div>`;
    } else {
      fields = `<div class="field"><label for="add-name">Visitor name *</label><input id="add-name" name="name" required maxlength="80" /></div>
        <div class="field"><label for="add-wc">WeChat ID *</label><input id="add-wc" name="wc" required maxlength="60" /></div>
        <div class="field"><label for="add-trek">Trek *</label><select id="add-trek" name="trek"><option value="alibaba">Alibaba HQ · Hangzhou</option><option value="refinery">Refinery Island</option></select></div>
        <div class="field"><label for="add-status">Status</label><select id="add-status" name="status">${statusOptionsHtml(collection, 'confirmed')}</select><small class="sub">If the trek is full, add them to the waitlist.</small></div>`;
    }
    els.modalCard.innerHTML = `<p class="eyebrow">Club desk · manual entry</p><h2>${esc(heading)}</h2><p class="dialog-lead">Manual records use the same validation, audit trail, and capacity rules as the public forms.</p>
      <form data-form="add-record" data-type="${collection}" novalidate><div class="form-grid">${fields}
      <div class="field full"><label for="add-notes">Private desk note</label><textarea id="add-notes" name="notes" maxlength="2000" placeholder="Optional context for the team"></textarea></div></div><p class="form-err" data-form-error hidden></p><div class="dialog-actions"><button class="btn" type="button" data-act="close-modal">Cancel</button><button class="btn btn-ink" type="submit">Save record</button></div></form>`;
    openModal();
    $('#add-name', els.modalCard)?.focus({ preventScroll: true });
  }

  function openModal() {
    els.modal.hidden = false;
    requestAnimationFrame(() => { els.modal.classList.add('open'); syncBodyLock(); });
  }

  function closeModal() {
    els.modal.classList.remove('open');
    syncBodyLock();
    setTimeout(() => { if (!els.modal.classList.contains('open')) els.modal.hidden = true; }, 220);
  }

  function askConfirm(title, message, confirmText = 'Confirm', danger = false) {
    $('#confirmTitle').textContent = title;
    $('#confirmBody').textContent = message;
    $('#confirmYes').textContent = confirmText;
    $('#confirmYes').classList.toggle('btn-danger', danger);
    $('#confirmYes').classList.toggle('btn-ink', !danger);
    els.confirm.hidden = false;
    requestAnimationFrame(() => { els.confirm.classList.add('open'); syncBodyLock(); });
    $('#confirmYes').focus();
    return new Promise((resolve) => { state.confirmResolve = resolve; });
  }

  function resolveConfirm(value) {
    els.confirm.classList.remove('open');
    syncBodyLock();
    setTimeout(() => { if (!els.confirm.classList.contains('open')) els.confirm.hidden = true; }, 220);
    if (state.confirmResolve) state.confirmResolve(value);
    state.confirmResolve = null;
  }

  function formToData(form) {
    const fd = new FormData(form);
    const data = {};
    for (const [key, value] of fd.entries()) {
      if (key === 'interests') (data.interests ||= []).push(value);
      else data[key] = value;
    }
    return data;
  }

  function showFormError(form, message) {
    const node = $('[data-form-error]', form);
    if (node) {
      node.textContent = message;
      node.hidden = false;
    } else toast(message);
  }

  async function submitAdd(form) {
    const collection = form.dataset.type;
    const payload = formToData(form);
    if (collection === 'pledges' || collection === 'reservations') payload.qty = Number(payload.qty);
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    try {
      await api(`/api/admin/${collection}`, { method: 'POST', body: payload });
      closeModal();
      toast('Record added to the desk.');
      await renderRoute();
      updateBadges().catch(() => {});
    } catch (err) {
      showFormError(form, err.message);
      button.disabled = false;
    }
  }

  async function submitEdit(form) {
    const collection = form.dataset.type;
    const id = form.dataset.id;
    const payload = formToData(form);
    if (collection === 'pledges') payload.qty = Number(payload.qty);
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    try {
      await api(`/api/admin/${collection}/${id}`, { method: 'PATCH', body: payload });
      toast('Record updated.');
      await openDrawer(collection, id, { noHash: true });
      await renderRoute({ quiet: true });
    } catch (err) {
      toast(err.message);
      button.disabled = false;
    }
  }

  async function submitNotes(form) {
    const collection = form.dataset.type;
    const id = form.dataset.id;
    const payload = formToData(form);
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    try {
      await api(`/api/admin/${collection}/${id}`, { method: 'PATCH', body: payload });
      toast('Private note saved.');
      await openDrawer(collection, id, { noHash: true });
      await renderRoute({ quiet: true });
    } catch (err) {
      toast(err.message);
      button.disabled = false;
    }
  }

  async function updateStatus(collection, id, status, detail = false) {
    const sel = detail ? $('#drawerStatus') : $(`[data-act="status-change"][data-type="${collection}"][data-id="${id}"]`);
    const old = sel?.dataset.old || sel?.getAttribute('data-current') || '';
    if (sel) sel.disabled = true;
    try {
      await api(`/api/admin/${collection}/${id}`, { method: 'PATCH', body: { status } });
      toast(`Status changed to ${STATUS_LABEL[status] || status}.`);
      if (detail) await openDrawer(collection, id, { noHash: true });
      await renderRoute({ quiet: true });
      updateBadges().catch(() => {});
    } catch (err) {
      toast(err.message);
      if (sel && old) sel.value = old;
      if (sel) sel.disabled = false;
    }
  }

  async function deleteRecord(collection, id) {
    const ok = await askConfirm('Remove this record?', 'This permanently removes the record and frees any trek seat. Its removal will remain in the activity log.', 'Remove record', true);
    if (!ok) return;
    try {
      await api(`/api/admin/${collection}/${id}`, { method: 'DELETE' });
      closeDrawer();
      toast('Record removed.');
      await renderRoute({ quiet: true });
      updateBadges().catch(() => {});
    } catch (err) { toast(err.message); }
  }

  async function bulkStatus(status) {
    const collection = collectionForView(cleanHash().view);
    const ids = [...state.selected];
    if (!ids.length) return;
    if (collection === 'reservations' && ['confirmed', 'checked-in'].includes(status)) {
      const ok = await askConfirm('Assign trek seats?', `Try to assign ${ids.length} selected visitors. Any record without available capacity will be skipped.`, 'Assign seats');
      if (!ok) return;
    }
    try {
      const result = await api('/api/admin/bulk', { method: 'POST', body: { type: collection, ids, status } });
      state.selected.clear();
      toast(`${result.updated.length} updated${result.skipped.length ? ` · ${result.skipped.length} skipped (capacity or removed)` : ''}.`);
      await renderRoute({ quiet: true });
      updateBadges().catch(() => {});
    } catch (err) { toast(err.message); }
  }

  async function exportCsv(collection) {
    const route = cleanHash();
    const params = new URLSearchParams(route.params);
    params.delete('page');
    params.delete('limit');
    params.set('type', collection);
    try {
      const headers = new Headers({ 'x-admin-token': state.token });
      const response = await fetch(`/api/admin/export.csv?${params.toString()}`, { headers, cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not export the CSV.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hiworld-${collection}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('CSV downloaded.');
    } catch (err) { toast(err.message); }
  }

  async function exportActivity() {
    try {
      const route = cleanHash();
      const params = new URLSearchParams(route.params);
      params.set('limit', '100');
      params.delete('page');
      const first = await api(`/api/admin/activity?${params.toString()}`);
      const rows = [...(first.items || [])];
      for (let page = 2; page <= first.pages; page++) {
        params.set('page', String(page));
        const next = await api(`/api/admin/activity?${params.toString()}`);
        rows.push(...(next.items || []));
      }
      const cell = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
      const text = ['id,created_at,type,action,summary,ref_id', ...rows.map((r) => [r.id, r.created_at, r.type, r.action, r.summary, r.ref_id].map(cell).join(','))].join('\n');
      const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'hiworld-activity.csv'; a.click(); URL.revokeObjectURL(url);
      toast(`${rows.length} activity events exported.`);
    } catch (err) { toast(err.message); }
  }

  async function globalSearch(q) {
    state.searchIndex = -1;
    if (q.trim().length < 2) {
      els.searchPop.hidden = true;
      return;
    }
    try {
      const data = await api(`/api/admin/search?q=${encodeURIComponent(q.trim())}`);
      if (els.search.value.trim() !== q.trim()) return;
      state.searchResults = data.results || [];
      if (!state.searchResults.length) {
        els.searchPop.innerHTML = '<p class="search-hint">No names, schools, WeChat IDs, or notes found.</p>';
      } else {
        els.searchPop.innerHTML = state.searchResults.map((r, i) => `<a class="search-hit" role="option" aria-selected="false" href="${attr(r.href)}" data-search-index="${i}"><span class="feed-dot ty-${attr(r.type)}"></span><span><strong>${esc(r.title)}</strong><em>${esc(r.subtitle || '')} · ${esc(r.status || '')}</em></span></a>`).join('');
      }
      els.searchPop.hidden = false;
    } catch {
      els.searchPop.hidden = true;
    }
  }

  function chooseSearch(index) {
    const result = state.searchResults[index];
    if (!result) return;
    els.search.value = '';
    els.searchPop.hidden = true;
    location.hash = result.href;
  }

  function openNav() {
    els.nav.classList.add('open');
    els.navScrim.hidden = false;
    requestAnimationFrame(() => els.navScrim.classList.add('open'));
    els.burger.setAttribute('aria-expanded', 'true');
    syncBodyLock();
  }
  function closeNav() {
    els.nav.classList.remove('open');
    els.navScrim.classList.remove('open');
    els.navScrim.hidden = true;
    els.burger.setAttribute('aria-expanded', 'false');
    syncBodyLock();
  }

  async function resetDemo() {
    if (!state.demo) return;
    const ok = await askConfirm('Reset sample data?', 'Every current record in this sample desk will be replaced with the original demo set. This action cannot be undone.', 'Reset sample', true);
    if (!ok) return;
    try {
      await api('/api/admin/reset-demo', { method: 'POST', body: { confirm: 'RESET SAMPLE' } });
      state.selected.clear();
      closeDrawer({ noHash: true });
      closeModal();
      toast('Sample data reset.');
      await renderRoute({ quiet: true });
      updateBadges().catch(() => {});
    } catch (err) { toast(err.message); }
  }

  function focusable(root) {
    return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root).filter((el) => el.getClientRects().length);
  }

  // ---- delegated events ----
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-act]');
    if (!target) {
      if (!els.searchPop.contains(event.target) && event.target !== els.search) els.searchPop.hidden = true;
      if (event.target === els.modal) closeModal();
      if (event.target === els.confirm) resolveConfirm(false);
      return;
    }
    const action = target.dataset.act;
    if (action === 'open') {
      event.preventDefault();
      openDrawer(target.dataset.type, Number(target.dataset.id));
    } else if (action === 'close-drawer') {
      closeDrawer();
    } else if (action === 'toggle-nav') {
      els.nav.classList.contains('open') ? closeNav() : openNav();
    } else if (action === 'refresh') {
      setLive('sync');
      await renderRoute();
      updateBadges().catch(() => {});
    } else if (action === 'add') {
      addModal(target.dataset.type);
    } else if (action === 'close-modal') {
      closeModal();
    } else if (action === 'filter') {
      setQuery(target.dataset.key, target.dataset.value);
    } else if (action === 'page') {
      setQuery('page', target.dataset.page, false);
    } else if (action === 'sort') {
      const route = cleanHash();
      const params = route.params;
      const key = target.dataset.sort;
      const old = params.get('sort') || 'created_at';
      const dir = params.get('dir') || 'desc';
      params.set('sort', key);
      params.set('dir', old === key && dir === 'desc' ? 'asc' : 'desc');
      params.delete('page');
      routeTo(route.view, params);
    } else if (action === 'select-row') {
      const id = Number(target.dataset.id);
      if (target.checked) state.selected.add(id); else state.selected.delete(id);
      syncBulk();
    } else if (action === 'select-page') {
      const rowChecks = $$('[data-act="select-row"]', els.view);
      rowChecks.forEach((checkbox) => {
        checkbox.checked = target.checked;
        const id = Number(checkbox.dataset.id);
        target.checked ? state.selected.add(id) : state.selected.delete(id);
      });
      syncBulk();
    } else if (action === 'bulk-status') {
      await bulkStatus(target.dataset.status);
    } else if (action === 'bulk-clear') {
      state.selected.clear();
      $$('[data-act="select-row"], [data-act="select-page"]', els.view).forEach((x) => { x.checked = false; });
      syncBulk();
    } else if (action === 'copy') {
      try { await navigator.clipboard.writeText(target.dataset.copy || ''); toast('Copied to clipboard.'); }
      catch { toast(`WeChat ID: ${target.dataset.copy || ''}`); }
    } else if (action === 'delete') {
      await deleteRecord(target.dataset.type, Number(target.dataset.id));
    } else if (action === 'confirm-no') {
      resolveConfirm(false);
    } else if (action === 'confirm-yes') {
      resolveConfirm(true);
    } else if (action === 'export') {
      await exportCsv(target.dataset.type);
    } else if (action === 'export-activity') {
      await exportActivity();
    } else if (action === 'print') {
      window.print();
    } else if (action === 'sign-out') {
      storeToken('', false);
      state.token = '';
      closeDrawer({ noHash: true });
      showGate();
      toast('Signed out.');
    } else if (action === 'dismiss-demo') {
      sessionStorage.setItem('hw_demo_dismissed', '1');
      els.demoBanner.hidden = true;
    } else if (action === 'reset-demo') {
      await resetDemo();
    }
  });

  $('#useDefault')?.addEventListener('click', () => {
    els.gateInput.value = 'hiworld-admin';
    els.gateInput.focus();
    signIn('hiworld-admin', els.remember.checked);
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-act="select-filter"]')) {
      setQuery(event.target.dataset.key, event.target.value);
    } else if (event.target.matches('[data-act="status-change"], [data-act="detail-status"]')) {
      const el = event.target;
      // The select's current value is sent; on failure it is restored by updateStatus.
      updateStatus(el.dataset.type, Number(el.dataset.id), el.value, el.dataset.act === 'detail-status');
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (form === els.gateForm) {
      event.preventDefault();
      await signIn(els.gateInput.value, els.remember.checked);
      return;
    }
    if (form.matches('[data-form="add-record"]')) {
      event.preventDefault();
      await submitAdd(form);
    } else if (form.matches('[data-form="edit-record"]')) {
      event.preventDefault();
      await submitEdit(form);
    } else if (form.matches('[data-form="save-notes"]')) {
      event.preventDefault();
      await submitNotes(form);
    }
  });

  els.gateForm.addEventListener('submit', (event) => event.preventDefault());

  els.search.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    const q = els.search.value;
    if (q.trim().length < 2) { els.searchPop.hidden = true; return; }
    state.searchTimer = setTimeout(() => globalSearch(q), 220);
  });
  els.search.addEventListener('keydown', (event) => {
    if (els.searchPop.hidden) return;
    const hits = $$('[data-search-index]', els.searchPop);
    if (event.key === 'ArrowDown') {
      event.preventDefault(); state.searchIndex = Math.min(hits.length - 1, state.searchIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault(); state.searchIndex = Math.max(0, state.searchIndex - 1);
    } else if (event.key === 'Enter' && state.searchIndex >= 0) {
      event.preventDefault(); chooseSearch(state.searchIndex); return;
    } else if (event.key === 'Escape') {
      els.searchPop.hidden = true; return;
    } else return;
    hits.forEach((hit, i) => {
      hit.classList.toggle('active', i === state.searchIndex);
      hit.setAttribute('aria-selected', i === state.searchIndex ? 'true' : 'false');
    });
  });

  els.view.addEventListener('input', (event) => {
    if (event.target.id === 'listSearch') {
      clearTimeout(state.viewTimer);
      const q = event.target.value;
      state.restoreFocus = { id: 'listSearch', start: event.target.selectionStart, end: event.target.selectionEnd };
      state.viewTimer = setTimeout(() => setQuery('q', q), 260);
    } else if (event.target.id === 'activitySearch') {
      clearTimeout(state.viewTimer);
      const q = event.target.value;
      state.restoreFocus = { id: 'activitySearch', start: event.target.selectionStart, end: event.target.selectionEnd };
      state.viewTimer = setTimeout(() => setQuery('q', q), 260);
    }
  });

  function syncBulk() {
    const bar = $('[data-bulk]', els.view);
    if (!bar) return;
    bar.hidden = state.selected.size === 0;
    const count = $('[data-selected-count]', bar);
    if (count) count.textContent = state.selected.size;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!els.confirm.hidden) resolveConfirm(false);
      else if (!els.modal.hidden) closeModal();
      else if (state.detail) closeDrawer();
      else if (els.nav.classList.contains('open')) closeNav();
      else els.searchPop.hidden = true;
    }
    if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && els.shell && !els.shell.hidden) {
      event.preventDefault();
      els.search.focus();
    }
    if (event.key === 'Tab' && state.detail) {
      const focusables = focusable(els.drawer);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  window.addEventListener('hashchange', () => {
    els.searchPop.hidden = true;
    els.search.value = '';
    if (state.token && !els.shell.hidden) renderRoute();
  });
  window.addEventListener('online', () => { setLive('live'); renderRoute({ quiet: true }); });
  window.addEventListener('offline', () => setLive('off'));

  // Fix status selects so failed requests restore the last server value.
  const statusObserver = new MutationObserver(() => {
    $$('[data-act="status-change"], [data-act="detail-status"]').forEach((el) => {
      if (!el.dataset.old) el.dataset.old = el.value;
    });
  });
  statusObserver.observe(els.view, { childList: true, subtree: true });
  statusObserver.observe(els.drawer, { childList: true, subtree: true });

  boot();
})();
