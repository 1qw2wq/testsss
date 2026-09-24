/* ==========================================================================
   Hi World Club — frontend app v2
   All original poster interactions + live backend API (with offline fallback),
   gallery lightbox, trek reservations, live stats.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  /* ---------------- offline-safe storage ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  /* ---------------- tiny API client ---------------- */
  const api = {
    online: true,
    async req(path, opts = {}) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(path, {
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          cache: 'no-store',
          ...opts,
        });
        const data = await res.json().catch(() => ({}));
        this.online = true;
        document.body.classList.remove('is-offline');
        const chip = $('#netChip');
        if (chip) {
          chip.classList.remove('offline');
          chip.querySelector('span:last-child').textContent = 'Live from the club server';
        }
        if (!res.ok) {
          const error = new Error(data.error || `Request failed (${res.status})`);
          error.status = res.status;
          error.code = data.code;
          error.data = data;
          throw error;
        }
        return data;
      } catch (err) {
        if (err.name === 'AbortError') {
          markOffline();
          const timeoutError = new Error('Request timed out. Please try again.');
          timeoutError.isNetwork = true;
          throw timeoutError;
        }
        if (!err.status) {
          markOffline();
          err.isNetwork = true;
        }
        throw err;
      } finally {
        clearTimeout(t);
      }
    },
    get: (p) => api.req(p),
    post: (p, body) => api.req(p, { method: 'POST', body: JSON.stringify(body) }),
  };

  function markOffline() {
    api.online = false;
    document.body.classList.add('is-offline');
    const chip = $('#netChip');
    if (chip) { chip.classList.add('offline'); chip.querySelector('span:last-child').textContent = 'Offline mode'; }
  }

  /* ---------------- scale compositions to fit ---------------- */
  function fitAll() {
    $$('.fit').forEach((el) => {
      const w = +el.dataset.w, h = +el.dataset.h, wrap = el.parentElement;
      if (!w || !h || !wrap) return;
      const s = Math.min(1, wrap.clientWidth / w);
      el.style.transform = `scale(${s})`;
      wrap.style.height = h * s + 'px';
    });
    const grid = $('#pillarGrid'), q3 = $('.q3');
    if (grid && q3) grid.style.setProperty('--hy', q3.offsetTop + 'px');
  }
  addEventListener('resize', fitAll, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);

  /* ---------------- nav ---------------- */
  const nav = $('#nav'), burger = $('#burger');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 10);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  burger.addEventListener('click', () => {
    const o = nav.classList.toggle('menu-open');
    burger.setAttribute('aria-expanded', String(o));
    burger.setAttribute('aria-label', o ? 'Close menu' : 'Open menu');
  });
  $$('#navLinks a, #navLinks button').forEach((a) =>
    a.addEventListener('click', () => {
      nav.classList.remove('menu-open');
      burger.setAttribute('aria-expanded', 'false');
    })
  );

  /* ---------------- toast ---------------- */
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2800);
  }

  /* ---------------- copy to clipboard ---------------- */
  async function copy(text) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
    }
    toast(ok ? `Copied “${text}”. Paste it in WeChat › Add Contacts.` : `WeChat ID: ${text}`);
  }

  /* ---------------- tabs ---------------- */
  function setTab(root, key) {
    if (!root) return;
    $$('[data-tab-btn]', root).forEach((b) => {
      const on = b.dataset.tabBtn === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    $$('[data-panel]', root).forEach((p) => { p.hidden = p.dataset.panel !== key; });
  }
  $$('[data-tabs]').forEach((root) =>
    $$('[data-tab-btn]', root).forEach((b) => b.addEventListener('click', () => {
      setTab(root, b.dataset.tabBtn);
      if (root.closest('#m-treks')) syncReserveTrek();
    }))
  );

  /* ---------------- modals ---------------- */
  let openM = null, lastFocus = null;
  const hooks = {
    treks(o) {
      if (o.tab) setTab($('#m-treks [data-tabs]'), o.tab);
      syncReserveTrek();
      loadTrekSeats();
      loadPublicEvents();
    },
    craft() { go(0); },
    impact(o) {
      const root = $('#m-impact [data-tabs]');
      setTab(root, o.tab || 'drive');
      $$('.shelf-book').forEach((b) => b.classList.remove('hl-on'));
      if (o.book) {
        const b = $('#book-' + o.book);
        if (b) {
          b.classList.add('hl-on');
          setTimeout(() => b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 150);
        }
      }
      loadPledges();
    },
    cohort() { renderPreview(); loadRecentPasses(); },
    join(o) {
      // Always show the form (not a stale success screen) when reopened.
      $('#joinFormWrap').hidden = false;
      $('#joinDone').hidden = true;
      if (o.interest) {
        const cb = $(`#joinForm input[value="${CSS.escape(o.interest)}"]`);
        if (cb) cb.checked = true;
      }
    },
  };

  function openModal(name, opts = {}) {
    const m = $('#m-' + name);
    if (!m) return;
    if (openM && openM !== m) closeModal(false);
    if (!openM) lastFocus = document.activeElement;
    m.hidden = false;
    void m.offsetWidth;
    m.classList.add('open');
    openM = m;
    document.body.classList.add('lock');
    if (hooks[name]) hooks[name](opts);
    m.querySelector('.m-card').scrollTop = 0;
    setTimeout(() => { const f = $('.m-close', m); if (f) f.focus({ preventScroll: true }); }, 60);
  }

  function closeModal(restore = true) {
    if (!openM) return;
    const m = openM;
    m.classList.remove('open');
    openM = null;
    setTimeout(() => { if (!m.classList.contains('open')) m.hidden = true; }, 260);
    document.body.classList.remove('lock');
    if (restore && lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus({ preventScroll: true }); } catch {}
    }
  }

  /* ---------------- global click delegation ---------------- */
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { e.preventDefault(); copy(c.dataset.copy); return; }
    const o = e.target.closest('[data-open]');
    if (o) {
      e.preventDefault();
      if (o.id === 'nfcBadge') return; // handled separately
      openModal(o.dataset.open, { tab: o.dataset.tab, interest: o.dataset.interest, book: o.dataset.book });
      return;
    }
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    if (openM && e.target === openM) closeModal();
  });

  /* ---------------- keyboard for custom role=button elements ---------------- */
  $$('.q, .letter').forEach((el) =>
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); el.click(); }
    })
  );

  /* ---------------- HI interactions ---------------- */
  $$('.hi-art .vial').forEach((v) =>
    v.addEventListener('click', () => {
      v.classList.remove('tip');
      void v.offsetWidth;
      v.classList.add('tip');
    })
  );
  const nfc = $('#nfcBadge');
  if (nfc) {
    nfc.addEventListener('click', () => {
      nfc.classList.remove('tapped');
      void nfc.offsetWidth;
      nfc.classList.add('tapped');
      toast('NFC tap detected. Opening the join form…');
      setTimeout(() => openModal('join'), 450);
    });
  }

  /* ---------------- WORLD letters ---------------- */
  $$('.letter').forEach((l) =>
    l.addEventListener('click', () => {
      l.classList.remove('jump');
      void l.offsetWidth;
      l.classList.add('jump');
      if ($('.tube', l)) l.classList.toggle('slosh');
      toast(l.dataset.info || 'Explore well.');
    })
  );

  /* ---------------- presenter remote ---------------- */
  const quads = $$('.q');
  let spotI = -1, spotT;
  function spot(i) {
    if (!quads.length) return;
    spotI = (i + quads.length) % quads.length;
    $('#pillarGrid').classList.add('presenting');
    quads.forEach((q, j) => q.classList.toggle('spot', j === spotI));
    quads[spotI].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast(`Slide ${spotI + 1} / 4 — ${quads[spotI].dataset.title || ''}`);
    clearTimeout(spotT);
    spotT = setTimeout(clearSpot, 6000);
  }
  function clearSpot() {
    const grid = $('#pillarGrid');
    if (grid) grid.classList.remove('presenting');
    quads.forEach((q) => q.classList.remove('spot'));
    spotI = -1;
  }

  let laserOn = false;
  const laser = $('#laser');
  function setLaser(on) {
    laserOn = on;
    document.body.classList.toggle('laser-on', on);
    const btn = $('.r-laser');
    if (btn) btn.classList.toggle('on', on);
    toast(on ? 'Laser pointer on. Press Esc or the top button to turn it off.' : 'Laser pointer off');
  }
  addEventListener('pointermove', (e) => {
    if (laserOn) laser.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
  }, { passive: true });

  const blackout = $('#blackout');
  function blank(on) { blackout.classList.toggle('on', on); }
  blackout.addEventListener('click', () => blank(false));

  $$('[data-remote]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      b.classList.add('press');
      setTimeout(() => b.classList.remove('press'), 150);
      switch (b.dataset.remote) {
        case 'laser': setLaser(!laserOn); break;
        case 'home': clearSpot(); scrollTo({ top: 0, behavior: 'smooth' }); break;
        case 'prev': spot(spotI < 0 ? quads.length - 1 : spotI - 1); break;
        case 'next': spot(spotI + 1); break;
        case 'screen': openModal('craft'); break;
        case 'blank': blank(true); break;
      }
    })
  );

  /* ---------------- workshop deck ---------------- */
  const deck = $('#deck');
  const slides = deck ? $$('.slide', deck) : [];
  const dots = $('#deckDots');
  let di = 0;
  if (deck && dots) {
    slides.forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      b.addEventListener('click', () => go(i));
      dots.appendChild(b);
    });
    $('#deckPrev').addEventListener('click', () => go(di - 1));
    $('#deckNext').addEventListener('click', () => go(di + 1));
    $('#deckBlank').addEventListener('click', () => blank(true));
    let sx = null;
    deck.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    deck.addEventListener('pointerup', (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 40) go(di + (dx < 0 ? 1 : -1));
      sx = null;
    });
    deck.addEventListener('pointercancel', () => { sx = null; });
    go(0);
  }
  function go(i) {
    if (!slides.length) return;
    di = Math.max(0, Math.min(slides.length - 1, i));
    $('.slides', deck).style.transform = `translateX(-${di * 100}%)`;
    $('#deckCount').textContent = `${di + 1} / ${slides.length}`;
    $$('button', dots).forEach((b, j) => b.classList.toggle('active', j === di));
    $('#deckPrev').disabled = di === 0;
    $('#deckNext').disabled = di === slides.length - 1;
    $('#deckBar').style.width = ((di + 1) / slides.length) * 100 + '%';
  }

  /* ---------------- live stats band ---------------- */
  async function loadStats() {
    try {
      const s = await api.get('/api/stats');
      $('#statBooks').textContent = Number(s.books.pledged).toLocaleString('en-US');
      const baseline = Number(s.books.base);
      rememberDataEpoch(s.books.epoch);
      $('#statBooksGoal').textContent = `of ${Number(s.books.goal).toLocaleString('en-US')} · ${baseline > 0 ? 'includes historical baseline' : 'desk pledges only'}`;
      bookGoal = Number(s.books.goal) || bookGoal;
      bookBaseline = Number.isFinite(baseline) && baseline >= 0 ? baseline : bookBaseline;
      store.set('hw_book_baseline', bookBaseline);
      $('#statMembers').textContent = s.passes + s.applications;
      $('#statSeats').textContent =
        (s.reservations.alibaba + s.reservations.refinery) + ' reserved';
    } catch {
      markOffline();
      const saved = store.get('hw_pledges', []);
      const local = Array.isArray(saved) ? saved : [];
      const total = bookBaseline + local.reduce((sum, pledge) => sum + (Number(pledge.qty) || 0), 0);
      $('#statBooks').textContent = total.toLocaleString('en-US');
      $('#statBooksGoal').textContent = `of ${Number(bookGoal).toLocaleString('en-US')} · offline estimate`;
    }
  }

  /* ---------------- trek seats + reservations ---------------- */
  let trekData = [];
  async function loadTrekSeats() {
    try {
      const d = await api.get('/api/treks');
      trekData = d.treks;
      for (const t of trekData) {
        const leftEl = $(`[data-seats-left="${t.id}"]`);
        const barEl = $(`[data-seats-bar="${t.id}"]`);
        if (leftEl) leftEl.textContent = t.left <= 0 ? 'Full — waitlist open' : `${t.left} of ${t.seats} seats left`;
        if (barEl) barEl.style.width = Math.min(100, (t.reserved / t.seats) * 100) + '%';
        const chip = $(`[data-seats-chip="${t.id}"]`);
        if (chip) chip.textContent = t.left <= 0 ? 'Waitlist' : `~${t.left} seats`;
      }
    } catch {
      markOffline();
    }
  }

  function syncReserveTrek() {
    const active = $('#m-treks .tab.active');
    const sel = $('#resTrek');
    if (active && sel) sel.value = active.dataset.tabBtn === 'refinery' ? 'refinery' : 'alibaba';
  }

  const resForm = $('#reserveForm');
  if (resForm) {
    resForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = resForm.querySelector('[type="submit"]');
      const name = $('#resName').value.trim();
      const wc = $('#resWc').value.trim();
      const trek = $('#resTrek').value;
      if (!name || !wc) { toast('Please enter your name and WeChat ID.'); return; }
      btn.classList.add('btn-busy');
      btn.disabled = true;
      try {
        const d = await api.post('/api/reservations', { name, wc, trek });
        toast(d.waitlisted
          ? 'This trek is full. You are on the waitlist — we will reach out.'
          : `Reserved! ${d.left} seat${d.left === 1 ? '' : 's'} left on this trek.`);
        resForm.reset();
        syncReserveTrek();
        loadTrekSeats();
        loadStats();
        loadPublicActivity();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.classList.remove('btn-busy');
        btn.disabled = false;
      }
    });
  }

  /* ---------------- book drive (live API + offline fallback) ---------------- */
  const DEFAULT_BASELINE = 347, DEFAULT_GOAL = 500;
  const cachedBaseline = Number(store.get('hw_book_baseline', DEFAULT_BASELINE));
  let bookBaseline = Number.isInteger(cachedBaseline) && cachedBaseline >= 0 && cachedBaseline <= 100000
    ? cachedBaseline : DEFAULT_BASELINE;
  let bookGoal = DEFAULT_GOAL;
  let bookEpoch = store.get('hw_book_epoch', '__unknown__');
  let syncingOfflinePledges = false;
  let syncingOfflineApplications = false;

  function rememberDataEpoch(value) {
    const next = value == null ? '' : String(value);
    const resetDetected = (bookEpoch !== '__unknown__' && bookEpoch !== next)
      || (bookEpoch === '__unknown__' && next !== '');
    let discarded = 0;
    if (resetDetected) {
      for (const key of ['hw_pledges', 'hw_apps']) {
        const pending = store.get(key, []);
        if (Array.isArray(pending) && pending.length) {
          discarded += pending.length;
          store.set(key, []);
        }
      }
      if (store.get('hw_pass', null)) {
        store.set('hw_pass', null);
        applyPass(null);
      }
      if (discarded) {
        toast('Pending offline submissions were cleared because the club data was reset.');
        const lead = $('#joinDoneLead');
        if (lead && !$('#joinDone').hidden) lead.textContent = 'The club data was reset before this application could be sent. Please submit it again when you are ready.';
      }
    }
    bookEpoch = next;
    store.set('hw_book_epoch', bookEpoch);
  }

  function newPledgeId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
  }

  function paintMeter(total, goal = bookGoal, animate = false, base = bookBaseline) {
    const cnt = $('#bookCount');
    const safeGoal = Number(goal) || DEFAULT_GOAL;
    const suppliedBase = Number(base);
    const safeBase = Number.isFinite(suppliedBase) && suppliedBase >= 0 ? suppliedBase : bookBaseline;
    const numericTotal = Number(total) || 0;
    bookGoal = safeGoal;
    bookBaseline = safeBase;
    store.set('hw_book_baseline', safeBase);
    const pledges = Math.max(0, numericTotal - safeBase);
    const display = (value) => Math.round(value).toLocaleString('en-US');
    if (animate) {
      const from = Number(String(cnt.textContent).replace(/,/g, '')) || safeBase;
      const start = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - start) / 700);
        cnt.textContent = display(from + (numericTotal - from) * k);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else {
      cnt.textContent = display(numericTotal);
    }
    $('#bookGoalLabel').textContent = `/ ${display(safeGoal)} books`;
    $('#bookBreakdown').textContent = `${display(safeBase)} books in the historical baseline + ${display(pledges)} saved desk pledges. Only saved pledges are listed below.`;
    requestAnimationFrame(() => {
      $('#bookBar').style.width = Math.min(100, (numericTotal / safeGoal) * 100) + '%';
    });
    $('#bookLeft').textContent = numericTotal >= safeGoal ? 'Goal reached — thank you!' : `${display(Math.max(0, safeGoal - numericTotal))} to go`;
  }

  function paintPledges(rows) {
    const list = $('#pledgeList');
    list.innerHTML = '';
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No pledges yet. Be the first to add one.';
      list.appendChild(li);
      return;
    }
    rows.slice(0, 8).forEach((p) => {
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = `${p.name} · ${p.genre}`;
      const b = document.createElement('span');
      b.textContent = `${p.qty} book${p.qty > 1 ? 's' : ''}`;
      li.append(a, b);
      list.appendChild(li);
    });
  }

  async function loadPledges(animate = false) {
    try {
      const d = await api.get('/api/pledges?limit=8');
      rememberDataEpoch(d.epoch);
      paintMeter(d.total, d.goal, animate, d.base);
      paintPledges(d.pledges);
    } catch {
      markOffline();
      const local = store.get('hw_pledges', []);
      const rows = Array.isArray(local) ? local : [];
      const total = bookBaseline + rows.reduce((sum, pledge) => sum + (Number(pledge.qty) || 0), 0);
      paintMeter(total, bookGoal, animate, bookBaseline);
      paintPledges([...rows].reverse());
    }
  }

  async function syncOfflinePledges() {
    if (syncingOfflinePledges || !navigator.onLine || !api.online) return 0;
    const pending = store.get('hw_pledges', []);
    if (!Array.isArray(pending) || !pending.length) return 0;
    syncingOfflinePledges = true;
    let synced = 0, discarded = 0;
    try {
      let index = 0;
      while (index < pending.length) {
        const pledge = pending[index];
        if (!pledge || !Number.isInteger(Number(pledge.qty)) || Number(pledge.qty) < 1 || Number(pledge.qty) > 20) {
          pending.splice(index, 1);
          store.set('hw_pledges', pending);
          discarded++;
          continue;
        }
        const clientId = pledge.client_id || newPledgeId();
        const clientEpoch = pledge.client_epoch == null
          ? (bookEpoch === '__unknown__' ? '' : bookEpoch)
          : String(pledge.client_epoch);
        pending[index] = { ...pledge, client_id: clientId, client_epoch: clientEpoch };
        store.set('hw_pledges', pending);
        try {
          const result = await api.post('/api/pledges', {
            name: pledge.name, genre: pledge.genre, qty: Number(pledge.qty),
            client_id: clientId, client_epoch: clientEpoch,
          });
          rememberDataEpoch(result.epoch);
          pending.splice(index, 1);
          store.set('hw_pledges', pending);
          synced++;
        } catch (error) {
          if (error.code === 'STALE_CLIENT_EPOCH') {
            pending.splice(index, 1);
            store.set('hw_pledges', pending);
            discarded++;
            continue;
          }
          if (error.status >= 400 && error.status < 500 && error.status !== 429) {
            pending.splice(index, 1);
            store.set('hw_pledges', pending);
            discarded++;
            continue;
          }
          break;
        }
      }
    } finally {
      syncingOfflinePledges = false;
    }
    if (synced || discarded) {
      const notice = [synced ? `${synced} offline pledge${synced === 1 ? '' : 's'} synced` : '', discarded ? `${discarded} outdated pledge${discarded === 1 ? '' : 's'} removed` : '']
        .filter(Boolean).join('; ');
      toast(`${notice}.`);
    }
    if (synced) {
      await Promise.all([loadPledges(), loadStats()]);
      loadPublicActivity();
    }
    return synced;
  }

  async function syncOfflineApplications() {
    if (syncingOfflineApplications || !navigator.onLine || !api.online) return 0;
    const pending = store.get('hw_apps', []);
    if (!Array.isArray(pending) || !pending.length) return 0;
    syncingOfflineApplications = true;
    let synced = 0, discarded = 0;
    try {
      let index = 0;
      while (index < pending.length) {
        const application = pending[index];
        if (!application || !String(application.name || '').trim() || !String(application.wc || '').trim()) {
          pending.splice(index, 1);
          store.set('hw_apps', pending);
          discarded++;
          continue;
        }
        const clientId = application.client_id || newPledgeId();
        const clientEpoch = application?.client_epoch == null
          ? (bookEpoch === '__unknown__' ? '' : bookEpoch)
          : String(application.client_epoch);
        pending[index] = { ...application, client_id: clientId, client_epoch: clientEpoch };
        store.set('hw_apps', pending);
        try {
          const result = await api.post('/api/applications', {
            name: application.name, wc: application.wc, org: application.org || '',
            interests: Array.isArray(application.interests) ? application.interests : [],
            msg: application.msg || '', client_id: clientId, client_epoch: clientEpoch,
          });
          rememberDataEpoch(result.epoch);
          pending.splice(index, 1);
          store.set('hw_apps', pending);
          synced++;
        } catch (error) {
          if (error.code === 'STALE_CLIENT_EPOCH' || (error.status >= 400 && error.status < 500 && error.status !== 429)) {
            pending.splice(index, 1);
            store.set('hw_apps', pending);
            discarded++;
            continue;
          }
          break;
        }
      }
    } finally {
      syncingOfflineApplications = false;
    }
    if (synced) {
      toast(`${synced === 1 ? 'Your offline application was' : `${synced} offline applications were`} sent to the club.`);
      const lead = $('#joinDoneLead');
      if (lead && !$('#joinDone').hidden) lead.textContent = 'Your application is in. To speed things up, add us on WeChat and mention “Hi World Club”.';
    }
    if (discarded) {
      toast(`${discarded} outdated offline application${discarded === 1 ? '' : 's'} removed.`);
      const lead = $('#joinDoneLead');
      if (lead && !$('#joinDone').hidden) lead.textContent = 'An outdated offline application was not sent. Please submit it again when you are ready.';
    }
    return synced;
  }

  let qty = 1;
  const qOut = $('#qOut');
  $('#qMinus').addEventListener('click', () => { qty = Math.max(1, qty - 1); qOut.textContent = qty; });
  $('#qPlus').addEventListener('click', () => { qty = Math.min(20, qty + 1); qOut.textContent = qty; });

  $('#pledgeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    const name = $('#plName').value.trim() || 'Anonymous';
    const genre = $('#plGenre').value;
    const clientId = newPledgeId();
    const clientEpoch = bookEpoch === '__unknown__' ? '' : bookEpoch;
    btn.classList.add('btn-busy');
    btn.disabled = true;
    try {
      const d = await api.post('/api/pledges', { name, genre, qty, client_id: clientId, client_epoch: clientEpoch });
      rememberDataEpoch(d.epoch);
      paintMeter(d.total, d.goal, true, d.base);
      loadPledges();
      loadPublicActivity();
      toast(`Thank you, ${name}! ${qty} book${qty > 1 ? 's' : ''} pledged.`);
    } catch (err) {
      if (err.isNetwork) {
        const saved = store.get('hw_pledges', []);
        const local = Array.isArray(saved) ? saved : [];
        local.push({ name, genre, qty, client_id: clientId, client_epoch: clientEpoch, t: Date.now() });
        store.set('hw_pledges', local);
        const total = bookBaseline + local.reduce((sum, pledge) => sum + (Number(pledge.qty) || 0), 0);
        paintMeter(total, bookGoal, true, bookBaseline);
        paintPledges([...local].reverse());
        toast(`Saved offline. It will sync when you reconnect, ${name}.`);
        markOffline();
      } else {
        toast(err.message);
      }
    } finally {
      qty = 1; qOut.textContent = 1;
      $('#plName').value = '';
      btn.classList.remove('btn-busy');
      btn.disabled = false;
      loadStats();
    }
  });

  /* ---------------- cohort pass ---------------- */
  const pName = $('#passName'), pTrack = $('#passTrack');
  function renderPreview() {
    $('#pvName').textContent = pName.value.trim() || 'Your Name';
    $('#pvTrack').textContent = pTrack.value;
  }
  function applyPass(p) {
    const el = $('#passIssued');
    if (p) {
      el.textContent = `ISSUED TO: ${p.name.toUpperCase()} · ${p.track.toUpperCase()}`;
      el.hidden = false;
      $('#badgeName').textContent = p.name;
    } else {
      el.hidden = true;
      $('#badgeName').textContent = 'Club Member';
    }
  }
  async function loadRecentPasses() {
    const box = $('#recentPasses');
    if (!box) return;
    try {
      const d = await api.get('/api/passes/latest?limit=6');
      box.innerHTML = '';
      if (!d.passes.length) { box.innerHTML = '<span class="chip">Be the first to get a pass</span>'; return; }
      d.passes.forEach((p) => {
        const s = document.createElement('span');
        s.className = 'chip';
        s.textContent = `${p.name} · ${p.track}`;
        box.appendChild(s);
      });
    } catch {
      box.innerHTML = '';
    }
  }
  if (pName) {
    pName.addEventListener('input', () => { renderPreview(); $('#pnField').classList.remove('err'); });
    pTrack.addEventListener('change', renderPreview);
    $('#issuePass').addEventListener('click', async () => {
      const name = pName.value.trim();
      if (!name) {
        const f = $('#pnField');
        f.classList.add('err');
        pName.classList.remove('shake');
        void pName.offsetWidth;
        pName.classList.add('shake');
        pName.focus();
        return;
      }
      const btn = $('#issuePass');
      btn.classList.add('btn-busy');
      btn.disabled = true;
      try {
        const d = await api.post('/api/passes', { name, track: pTrack.value });
        store.set('hw_pass', d.pass);
        applyPass(d.pass);
        loadRecentPasses();
        loadStats();
        loadPublicActivity();
        toast(`Pass issued to ${name}. It's on your lanyard now.`);
      } catch (err) {
        if (err.isNetwork) {
          const p = { name, track: pTrack.value };
          store.set('hw_pass', p);
          applyPass(p);
          markOffline();
          toast(`Pass issued offline to ${name}.`);
        } else {
          toast(err.message);
        }
      } finally {
        btn.classList.remove('btn-busy');
        btn.disabled = false;
      }
    });
    $('#resetPass').addEventListener('click', () => {
      pName.value = '';
      pTrack.value = 'All-rounder';
      renderPreview();
      store.set('hw_pass', null);
      applyPass(null);
      toast('Pass reset');
    });
    const savedPass = store.get('hw_pass', null);
    if (savedPass && savedPass.name) {
      pName.value = savedPass.name;
      if ([...pTrack.options].some((o) => o.value === savedPass.track)) pTrack.value = savedPass.track;
      applyPass({ name: savedPass.name, track: pTrack.value });
    }
    renderPreview();
  }

  /* ---------------- join form (live API + offline queue) ---------------- */
  const joinForm = $('#joinForm');
  if (joinForm) {
    joinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      let ok = true, firstBad = null;
      ['jName', 'jWc'].forEach((id) => {
        const el = $('#' + id);
        const bad = !el.value.trim();
        el.closest('.field').classList.toggle('err', bad);
        if (bad) { ok = false; firstBad = firstBad || el; }
      });
      if (!ok) { firstBad.focus(); toast('Please fill in the required fields.'); return; }
      const btn = joinForm.querySelector('[type="submit"]');
      btn.classList.add('btn-busy');
      btn.disabled = true;
      const data = {
        name: $('#jName').value.trim(),
        wc: $('#jWc').value.trim(),
        org: $('#jOrg').value.trim(),
        interests: $$('#joinForm input[name=interest]:checked').map((i) => i.value),
        msg: $('#jMsg').value.trim(),
      };
      const clientId = newPledgeId();
      const clientEpoch = bookEpoch === '__unknown__' ? '' : bookEpoch;
      try {
        const d = await api.post('/api/applications', { ...data, client_id: clientId, client_epoch: clientEpoch });
        rememberDataEpoch(d.epoch);
        $('#joinDoneName').textContent = d.name || data.name.split(' ')[0];
        $('#joinDoneLead').textContent = 'Your application is in. To speed things up, add us on WeChat and mention “Hi World Club”.';
        $('#joinFormWrap').hidden = true;
        $('#joinDone').hidden = false;
        loadStats();
        loadPublicActivity();
      } catch (err) {
        if (err.isNetwork) {
          const saved = store.get('hw_apps', []);
          const apps = Array.isArray(saved) ? saved : [];
          apps.push({ ...data, client_id: clientId, client_epoch: clientEpoch, t: Date.now() });
          store.set('hw_apps', apps);
          markOffline();
          $('#joinDoneName').textContent = data.name.split(' ')[0];
          $('#joinDoneLead').textContent = 'Saved on this device while you are offline. It will be sent to the club automatically once you reconnect.';
          $('#joinFormWrap').hidden = true;
          $('#joinDone').hidden = false;
          toast('Saved offline — it will sync when you reconnect.');
        } else {
          toast(err.message);
          if (err.message.includes('WeChat')) $('#jWc').closest('.field').classList.add('err');
          if (err.message.includes('Name')) $('#jName').closest('.field').classList.add('err');
        }
      } finally {
        btn.classList.remove('btn-busy');
        btn.disabled = false;
      }
    });
    $$('#jName, #jWc').forEach((el) =>
      el.addEventListener('input', () => el.closest('.field').classList.remove('err'))
    );
    $('#joinAgain').addEventListener('click', () => {
      joinForm.reset();
      $('#joinDoneLead').textContent = 'Your application is in. To speed things up, add us on WeChat and mention “Hi World Club”.';
      $('#joinDone').hidden = true;
      $('#joinFormWrap').hidden = false;
      $('#jName').focus();
    });
  }

  /* ---------------- gallery lightbox ---------------- */
  const lb = $('#lightbox');
  if (lb) {
    const lbImg = $('#lbImg'), lbCap = $('#lbCap');
    let lbLast = null;
    function openLb(item) {
      const img = $('img', item);
      lbLast = document.activeElement;
      lbImg.src = img.currentSrc || img.src;
      lbImg.alt = img.alt;
      lbCap.textContent = item.dataset.caption || img.alt;
      lb.hidden = false;
      void lb.offsetWidth;
      lb.classList.add('open');
      document.body.classList.add('lock');
      $('.m-close', lb).focus({ preventScroll: true });
    }
    function closeLb() {
      lb.classList.remove('open');
      setTimeout(() => { if (!lb.classList.contains('open')) { lb.hidden = true; lbImg.src = ''; } }, 220);
      if (!openM) document.body.classList.remove('lock');
      if (lbLast && typeof lbLast.focus === 'function') { try { lbLast.focus({ preventScroll: true }); } catch {} }
    }
    $$('.g-item').forEach((g) => {
      g.addEventListener('click', () => openLb(g));
      g.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === g) { e.preventDefault(); openLb(g); }
      });
    });
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('[data-close-lb]')) closeLb(); });
    document.addEventListener('keydown', (e) => {
      if (!lb.hidden && e.key === 'Escape') { e.stopPropagation(); closeLb(); }
    }, true);
  }

  /* ---------------- global keyboard ---------------- */
  document.addEventListener('keydown', (e) => {
    if (blackout.classList.contains('on')) { e.preventDefault(); blank(false); return; }
    if (e.key === 'Escape') {
      if (openM) closeModal();
      else if (laserOn) setLaser(false);
      else clearSpot();
      return;
    }
    if (openM && openM.id === 'm-craft' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(di + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(di - 1); }
      if (e.key.toLowerCase() === 'b') { e.preventDefault(); blank(true); }
    }
    if (e.key === 'Tab' && openM) {
      const f = $$(
        'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
        openM
      ).filter((el) => el.getClientRects().length > 0);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------------- reveal on scroll ---------------- */
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }),
    { threshold: 0.15 }
  );
  $$('.reveal, #pillarGrid').forEach((el) => io.observe(el));

  /* ---------------- hero pointer parallax ---------------- */
  const poster = $('#top');
  if (
    poster &&
    matchMedia('(pointer:fine)').matches &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    poster.addEventListener('pointermove', (e) => {
      const r = poster.getBoundingClientRect();
      poster.style.setProperty('--px', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      poster.style.setProperty('--py', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
      poster.classList.add('parallax');
    }, { passive: true });
    poster.addEventListener('pointerleave', () => poster.classList.remove('parallax'));
  }

  /* ---------------- privacy-safe live club activity ---------------- */
  let publicActivitySignature = null;
  function formatPublicTime(value) {
    const raw = String(value || '');
    const date = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
  }

  async function loadPublicActivity() {
    const list = $('#clubPulseList');
    if (!list) return;
    try {
      const result = await api.get('/api/public/activity?limit=5');
      const items = Array.isArray(result.activity) ? result.activity : [];
      const signature = JSON.stringify(items.map((item) => [item.message, item.created_at, item.type]));
      if (signature === publicActivitySignature) return;
      publicActivitySignature = signature;
      list.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('li');
        empty.className = 'club-pulse-item empty';
        empty.textContent = 'No recent updates yet — check back soon.';
        list.appendChild(empty);
        return;
      }
      items.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'club-pulse-item';
        const dot = document.createElement('i');
        dot.className = `club-pulse-dot type-${['application', 'pledge', 'pass', 'reservation', 'event'].includes(item.type) ? item.type : 'reservation'}`;
        dot.setAttribute('aria-hidden', 'true');
        const message = document.createElement('span');
        message.textContent = item.message;
        li.append(dot, message);
        const timestamp = formatPublicTime(item.created_at);
        if (timestamp) {
          const time = document.createElement('time');
          time.dateTime = item.created_at.includes('T') ? item.created_at : `${item.created_at.replace(' ', 'T')}Z`;
          time.textContent = timestamp;
          li.appendChild(time);
        }
        list.appendChild(li);
      });
    } catch {
      markOffline();
    }
  }

  /* ---------------- public event calendar ---------------- */
  let publicEventsSignature = null;
  function eventDateParts(value) {
    const date = new Date(`${String(value || '')}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return { month: 'Date', day: 'TBA', full: value || 'Date to be announced' };
    return {
      month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date).toUpperCase(),
      day: new Intl.DateTimeFormat('en-US', { day: '2-digit', timeZone: 'UTC' }).format(date),
      full: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date),
    };
  }

  const TREK_EVENT_NAMES = { alibaba: 'Alibaba HQ · Hangzhou', refinery: 'Private Refinery Island' };

  function renderTrekEvents(events, failed = false) {
    $$('[data-trek-events]').forEach((root) => {
      const list = $('.trek-event-list', root);
      if (!list) return;
      list.replaceChildren();
      const matches = (events || []).filter((event) => event.trek === root.dataset.trekEvents).slice(0, 3);
      if (failed || !matches.length) {
        const empty = document.createElement('p');
        empty.className = 'trek-events-empty';
        empty.textContent = failed ? 'Trek dates are temporarily unavailable.' : 'No upcoming dates have been announced yet.';
        list.appendChild(empty);
        return;
      }
      matches.forEach((event) => {
        const date = eventDateParts(event.date);
        const item = document.createElement('article');
        item.className = 'trek-event-item';
        const title = document.createElement('h5');
        title.textContent = event.title || 'Upcoming trek';
        const meta = document.createElement('p');
        meta.className = 'trek-event-meta';
        const when = document.createElement('time');
        when.dateTime = event.date || '';
        when.textContent = date.full;
        meta.appendChild(when);
        if (event.time) meta.append(` · ${event.time} Hangzhou time`);
        if (event.location) meta.append(` · ${event.location}`);
        item.append(title, meta);
        if (event.description) {
          const description = document.createElement('p');
          description.className = 'trek-event-description';
          description.textContent = event.description;
          item.appendChild(description);
        }
        if (event.url) {
          const link = document.createElement('a');
          link.className = 'trek-event-link';
          link.href = event.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Event details ↗';
          item.appendChild(link);
        }
        list.appendChild(item);
      });
    });
  }

  async function loadPublicEvents() {
    const grid = $('#publicEvents');
    if (!grid) return;
    try {
      const result = await api.get('/api/events?limit=100');
      const events = Array.isArray(result.events) ? result.events : [];
      renderTrekEvents(events);
      const signature = JSON.stringify(events);
      const previewEvents = events.slice(0, 3);
      if (signature === publicEventsSignature) return;
      publicEventsSignature = signature;
      grid.replaceChildren();
      if (!events.length) {
        const empty = document.createElement('p');
        empty.className = 'public-events-empty';
        empty.textContent = 'No upcoming events are on the calendar yet. Check back soon.';
        grid.appendChild(empty);
        return;
      }
      previewEvents.forEach((event) => {
        const date = eventDateParts(event.date);
        const card = document.createElement('article');
        card.className = 'public-event-card';
        const dateBadge = document.createElement('div');
        dateBadge.className = 'public-event-date';
        dateBadge.setAttribute('aria-hidden', 'true');
        const month = document.createElement('span');
        month.textContent = date.month;
        const day = document.createElement('strong');
        day.textContent = date.day;
        dateBadge.append(month, day);
        const content = document.createElement('div');
        content.className = 'public-event-content';
        const kicker = document.createElement('p');
        kicker.className = 'public-event-kicker';
        kicker.textContent = `Hi World Club · ${TREK_EVENT_NAMES[event.trek] || 'Upcoming'}`;
        const title = document.createElement('h3');
        title.textContent = event.title;
        const time = document.createElement('p');
        time.className = 'public-event-time';
        const when = document.createElement('time');
        when.dateTime = event.date;
        when.textContent = date.full;
        time.appendChild(when);
        if (event.time) time.append(` · ${event.time} Hangzhou time`);
        const location = document.createElement('p');
        location.className = 'public-event-location';
        location.textContent = event.location || 'Location to be announced';
        content.append(kicker, title, time, location);
        if (event.description) {
          const description = document.createElement('p');
          description.className = 'public-event-description';
          description.textContent = event.description;
          content.appendChild(description);
        }
        if (event.url) {
          const link = document.createElement('a');
          link.className = 'public-event-link';
          link.href = event.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Event details ↗';
          content.appendChild(link);
        }
        card.append(dateBadge, content);
        grid.appendChild(card);
      });
    } catch {
      markOffline();
      publicEventsSignature = null;
      renderTrekEvents([], true);
      const unavailable = document.createElement('p');
      unavailable.className = 'public-events-empty';
      unavailable.textContent = 'The event calendar is temporarily unavailable.';
      grid.replaceChildren(unavailable);
    }
  }

  let publicRefreshPromise = null;
  function refreshPublicData() {
    if (document.hidden) return Promise.resolve();
    if (publicRefreshPromise) return publicRefreshPromise;
    publicRefreshPromise = (async () => {
      await Promise.all([
        loadStats(), loadPledges(), loadTrekSeats(), loadRecentPasses(), loadPublicActivity(), loadPublicEvents(),
      ]);
      await syncOfflinePledges();
      await syncOfflineApplications();
    })().finally(() => { publicRefreshPromise = null; });
    return publicRefreshPromise;
  }

  /* ---------------- boot ---------------- */
  fitAll();
  setTimeout(fitAll, 300);
  refreshPublicData();
  setInterval(refreshPublicData, 45_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPublicData(); });
  addEventListener('online', refreshPublicData);
})();
