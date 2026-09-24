'use strict';

const { stmts, store } = require('./db');

const COLLECTIONS = ['applications', 'pledges', 'passes', 'reservations'];
const TYPE_OF = { applications: 'application', pledges: 'pledge', passes: 'pass', reservations: 'reservation' };
const STATUSES = {
  applications: ['new', 'reviewing', 'accepted', 'waitlisted', 'declined'],
  pledges: ['pledged', 'received', 'cancelled'],
  passes: ['active', 'revoked'],
  reservations: ['confirmed', 'checked-in', 'waitlisted', 'cancelled'],
};
const TAKES_SEAT = new Set(['confirmed', 'checked-in']);
const STATUS_ORDER = Object.fromEntries(Object.values(STATUSES).flat().map((s, i) => [s, i]));

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
}

function dateValue(value) {
  if (!value) return null;
  const raw = String(value);
  const normalized = /(?:Z|[+-]\d\d:?\d\d)$/i.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateKey(value) {
  return String(value || '').slice(0, 10);
}

function searchText(row) {
  return [row.name, row.wc, row.org, row.msg, row.notes, row.genre, row.track, row.trek, row.status, ...(row.interests || [])]
    .filter(Boolean).join(' ').toLowerCase();
}

function countStatuses(rows, collection) {
  const counts = Object.fromEntries(STATUSES[collection].map((s) => [s, 0]));
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

function sortRows(rows, sort, direction) {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (sort === 'status') cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    else if (sort === 'qty') cmp = (Number(a.qty) || 0) - (Number(b.qty) || 0);
    else cmp = String(a[sort] || '').localeCompare(String(b[sort] || ''), 'en', { sensitivity: 'base' });
    return cmp ? direction * cmp : direction * ((Number(a.id) || 0) - (Number(b.id) || 0));
  });
}

function csvCell(value) {
  let text = Array.isArray(value) ? value.join('; ') : value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function makeCsv(headers, rows) {
  return `\uFEFF${[headers.join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\n')}\n`;
}

function trendDays(count) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => new Date(start.getTime() - (count - i - 1) * 86400000).toISOString().slice(0, 10));
}

function buildOverview(snap, ctx) {
  const { TREKS, GENRES, INTERESTS, TRACKS } = ctx;
  const BASE_BOOKS = store.bookBaseline();
  const BOOK_GOAL = store.bookGoal();
  const { applications, pledges, passes, reservations, activity } = snap;
  const livePledges = pledges.filter((p) => p.status !== 'cancelled');
  const siteQty = livePledges.reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
  const receivedQty = pledges.filter((p) => p.status === 'received').reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
  const openQty = pledges.filter((p) => p.status === 'pledged').reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
  const totalBooks = BASE_BOOKS + siteQty;
  const now = Date.now();
  const day = 86400000;
  const since = (row, from, to) => {
    const d = dateValue(row.created_at);
    return d && d.getTime() >= from && d.getTime() < to;
  };
  const countWindow = (rows, from, to) => rows.filter((r) => since(r, from, to)).length;
  const pledgeWindow = (from, to) => livePledges.filter((r) => since(r, from, to)).reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
  const last7 = now - 7 * day;
  const prior7 = now - 14 * day;

  const days = trendDays(14);
  const series = { days, applications: [], pledges: [], pledgeCount: [], reservations: [], passes: [] };
  for (const date of days) {
    const dailyPledges = livePledges.filter((r) => dateKey(r.created_at) === date);
    series.applications.push(applications.filter((r) => dateKey(r.created_at) === date).length);
    series.pledges.push(dailyPledges.reduce((sum, p) => sum + (Number(p.qty) || 0), 0));
    series.pledgeCount.push(dailyPledges.length);
    series.reservations.push(reservations.filter((r) => dateKey(r.created_at) === date && r.status !== 'cancelled').length);
    series.passes.push(passes.filter((r) => dateKey(r.created_at) === date && r.status !== 'revoked').length);
  }

  const genres = [...GENRES].map((genre) => ({
    genre,
    qty: livePledges.filter((p) => p.genre === genre).reduce((sum, p) => sum + (Number(p.qty) || 0), 0),
    received: pledges.filter((p) => p.genre === genre && p.status === 'received').reduce((sum, p) => sum + (Number(p.qty) || 0), 0),
    open: pledges.filter((p) => p.genre === genre && p.status === 'pledged').reduce((sum, p) => sum + (Number(p.qty) || 0), 0),
  }));

  const interests = Object.fromEntries([...INTERESTS].map((interest) => [interest, 0]));
  for (const app of applications) {
    if (app.status === 'declined') continue;
    for (const interest of app.interests || []) if (interests[interest] != null) interests[interest]++;
  }
  const tracks = Object.fromEntries([...TRACKS].map((track) => [track, 0]));
  for (const pass of passes) if (pass.status !== 'revoked' && tracks[pass.track] != null) tracks[pass.track]++;

  const treks = TREKS.map((trek) => {
    const rows = reservations.filter((r) => r.trek === trek.id);
    const taken = rows.filter((r) => TAKES_SEAT.has(r.status)).length;
    return {
      id: trek.id, name: trek.name, days: trek.days, location: trek.location,
      seats: trek.seats, image: trek.image, taken, left: Math.max(0, trek.seats - taken),
      waitlisted: rows.filter((r) => r.status === 'waitlisted').length,
      confirmed: rows.filter((r) => r.status === 'confirmed').length,
      checkedIn: rows.filter((r) => r.status === 'checked-in').length,
    };
  });

  const appStatus = countStatuses(applications, 'applications');
  const olderThan = (row, daysAgo) => {
    const d = dateValue(row.created_at);
    return d && d.getTime() < now - daysAgo * day;
  };
  const staleApps = applications.filter((a) => a.status === 'new' && olderThan(a, 3));
  const oldPledges = pledges.filter((p) => p.status === 'pledged' && olderThan(p, 10));
  const wcNames = new Map();
  for (const app of applications) {
    const wc = String(app.wc || '').trim().toLowerCase();
    if (wc) wcNames.set(wc, [...(wcNames.get(wc) || []), app.name]);
  }

  const attention = [];
  const duplicates = [...wcNames].filter(([, names]) => names.length > 1);
  if (duplicates.length) attention.push({ tone: 'hot', title: `${duplicates.length} duplicate WeChat ${duplicates.length === 1 ? 'ID' : 'IDs'}`, detail: duplicates.map(([wc, names]) => `${wc} (${names.join(', ')})`).join(' · '), href: '#/applications' });
  const promotable = treks.filter((t) => t.waitlisted && t.left);
  if (promotable.length) attention.push({ tone: 'hot', title: 'Waitlist can move', detail: promotable.map((t) => `${t.name}: ${t.waitlisted} waiting, ${t.left} open`).join(' · '), href: '#/treks' });
  for (const trek of treks.filter((t) => t.seats && t.taken / t.seats >= 0.75)) {
    attention.push({ tone: 'warn', title: `${trek.name.split('·')[0].trim()} is ${Math.round(trek.taken / trek.seats * 100)}% full`, detail: `${trek.left} seat${trek.left === 1 ? '' : 's'} left · ${trek.waitlisted} on the waitlist`, href: `#/treks?trek=${trek.id}` });
  }
  if (appStatus.new) attention.push({ tone: staleApps.length ? 'warn' : 'info', title: `${appStatus.new} new application${appStatus.new === 1 ? '' : 's'}`, detail: staleApps.length ? `${staleApps.length} waiting more than 3 days — ${staleApps.map((a) => a.name).join(', ')}` : 'None have been sitting more than 3 days.', href: '#/applications?status=new' });
  if (oldPledges.length) {
    const qty = oldPledges.reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
    attention.push({ tone: 'info', title: `${qty} book${qty === 1 ? '' : 's'} pledged over 10 days ago`, detail: oldPledges.map((p) => `${p.name} · ${p.qty}`).join(' · '), href: '#/pledges?status=pledged' });
  }
  attention.push({ tone: 'ok', title: totalBooks >= BOOK_GOAL ? 'Book-drive goal reached' : `${Math.max(0, BOOK_GOAL - totalBooks)} books to the goal`, detail: `${totalBooks} toward ${BOOK_GOAL} · ${BASE_BOOKS} historical (not saved) + ${siteQty} saved desk pledges`, href: '#/pledges' });

  const recent = [...activity].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id).slice(0, 8);
  const activeReservations = reservations.filter((r) => TAKES_SEAT.has(r.status)).length;
  const activePasses = passes.filter((p) => p.status === 'active').length;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    demo: !!snap.meta.demo,
    kpis: {
      books: { pledged: totalBooks, goal: BOOK_GOAL, toGo: Math.max(0, BOOK_GOAL - totalBooks), base: BASE_BOOKS, siteQty, receivedQty, openQty, delta: pledgeWindow(last7, now) - pledgeWindow(prior7, last7), last7: pledgeWindow(last7, now) },
      applications: { ...appStatus, total: applications.length, open: appStatus.new + appStatus.reviewing, delta: countWindow(applications, last7, now) - countWindow(applications, prior7, last7), last7: countWindow(applications, last7, now) },
      passes: { total: passes.length, active: activePasses, revoked: passes.length - activePasses, byTrack: tracks, delta: countWindow(passes.filter((p) => p.status !== 'revoked'), last7, now) - countWindow(passes.filter((p) => p.status !== 'revoked'), prior7, last7) },
      reservations: { total: reservations.length, active: activeReservations, waitlisted: reservations.filter((r) => r.status === 'waitlisted').length, seatsLeft: treks.reduce((sum, t) => sum + t.left, 0), seats: treks.reduce((sum, t) => sum + t.seats, 0) },
    },
    series, genres, interests, tracks, treks, attention: attention.slice(0, 5), recent,
  };
}

function listCollection(collection, req) {
  const snap = store.snapshot();
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
  const status = String(req.query.status || '');
  const interest = String(req.query.interest || '');
  const trek = String(req.query.trek || '');
  const track = String(req.query.track || '');
  const genre = String(req.query.genre || '');
  let rows = snap[collection].filter((row) => !q || searchText(row).includes(q));
  const searched = rows;
  rows = rows.filter((row) => {
    if (trek && trek !== 'all' && row.trek !== trek) return false;
    if (track && track !== 'all' && row.track !== track) return false;
    if (genre && genre !== 'all' && row.genre !== genre) return false;
    if (interest && interest !== 'all' && !(row.interests || []).includes(interest)) return false;
    return true;
  });
  const facets = { status: countStatuses(rows, collection) };
  if (collection === 'applications') {
    facets.interest = { treks: 0, workshops: 0, csr: 0 };
    for (const row of rows) for (const item of row.interests || []) if (facets.interest[item] != null) facets.interest[item]++;
  }
  if (collection === 'reservations') {
    facets.trek = { alibaba: 0, refinery: 0 };
    for (const row of searched) if (facets.trek[row.trek] != null) facets.trek[row.trek]++;
  }
  if (collection === 'passes') {
    facets.track = {};
    for (const row of rows) facets.track[row.track] = (facets.track[row.track] || 0) + 1;
  }
  if (collection === 'pledges') {
    facets.genre = {};
    for (const row of rows) facets.genre[row.genre] = (facets.genre[row.genre] || 0) + 1;
  }
  if (status && status !== 'all') rows = rows.filter((row) => row.status === status);
  const allowed = new Set(['created_at', 'updated_at', 'name', 'status', 'qty', 'org', 'genre', 'track', 'trek', 'wc']);
  const sort = allowed.has(String(req.query.sort)) ? String(req.query.sort) : 'created_at';
  const direction = req.query.dir === 'asc' ? 1 : -1;
  rows = sortRows(rows, sort, direction);
  const limit = clamp(req.query.limit, 1, 100, 12);
  const page = clamp(req.query.page, 1, 10000, 1);
  return { ok: true, total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / limit)), limit, sort, dir: direction > 0 ? 'asc' : 'desc', facets, items: rows.slice((page - 1) * limit, page * limit) };
}

function activityFor(collection, row, previous, patch) {
  const name = row.name || 'Record';
  if (patch.status != null && previous && patch.status !== previous.status) {
    if (collection === 'applications') return { action: 'status', summary: `${name} marked ${patch.status}` };
    if (collection === 'pledges') {
      if (patch.status === 'received') return { action: 'status', summary: `${name}'s ${row.qty} books marked received` };
      return { action: 'status', summary: `${name}'s pledge marked ${patch.status}` };
    }
    if (collection === 'passes') return { action: 'status', summary: patch.status === 'revoked' ? `${name}'s visitor pass revoked` : `${name}'s visitor pass restored` };
    const label = store.trekLabel(row.trek);
    if (patch.status === 'cancelled') return { action: 'status', summary: `${name} released their ${label} seat` };
    if (patch.status === 'checked-in') return { action: 'status', summary: `${name} checked in for ${label}` };
    return { action: 'status', summary: `${name} marked ${patch.status} for ${label}` };
  }
  if (patch.notes != null && previous && patch.notes !== previous.notes) return { action: 'updated', summary: `Note updated on ${name}` };
  return { action: 'updated', summary: `${name} updated` };
}

function registerAdmin(app, ctx) {
  const { requireAdmin, clean, isNonEmpty, TREKS, GENRES, TRACKS, INTERESTS } = ctx;
  const asyncRoute = ctx.asyncRoute || ((handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next));
  const overviewCtx = { TREKS, GENRES, TRACKS, INTERESTS };
  const notFound = (res) => res.status(404).json({ ok: false, error: 'Not found' });
  const rowFor = (collection, id) => store.snapshot()[collection].find((row) => row.id === Number(id));

  app.get('/api/admin/badges', requireAdmin, (req, res) => {
    const data = buildOverview(store.snapshot(), overviewCtx);
    res.json({ ok: true, demo: data.demo, newApplications: data.kpis.applications.new, openApplications: data.kpis.applications.open, attention: data.attention.filter((item) => item.tone === 'hot' || item.tone === 'warn').length, waitlisted: data.kpis.reservations.waitlisted });
  });
  app.get('/api/admin/overview', requireAdmin, (req, res) => res.json(buildOverview(store.snapshot(), overviewCtx)));

  app.patch('/api/admin/book-goal', requireAdmin, asyncRoute(async (req, res) => {
    const goal = Number(req.body.goal);
    if (!Number.isInteger(goal) || goal < 1 || goal > 100000) {
      return res.status(400).json({ ok: false, error: 'The goal must be a whole number from 1 to 100,000.' });
    }
    await store.setBookGoal(goal);
    res.json({ ok: true, goal });
  }));

  app.get('/api/admin/events', requireAdmin, (req, res) => {
    const events = store.snapshot().events
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')) || a.id - b.id);
    res.json({ ok: true, total: events.length, events });
  });

  function eventPayload(body, previous = {}) {
    const input = { ...previous, ...body };
    const title = clean(input.title, 100);
    const date = clean(input.date, 10);
    const time = clean(input.time, 5);
    const location = clean(input.location, 120);
    const description = clean(input.description, 600);
    const url = clean(input.url, 500);
    const trek = clean(input.trek, 20);
    if (!isNonEmpty(title)) return { error: 'Event title is required.', field: 'title' };
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
    if (!Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== date) {
      return { error: 'Choose a valid event date.', field: 'date' };
    }
    if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Choose a valid event time.', field: 'time' };
    if (trek && !TREKS.some((item) => item.id === trek)) return { error: 'Choose a valid trek destination.', field: 'trek' };
    if (url) {
      try {
        if (new URL(url).protocol !== 'https:') throw new Error('protocol');
      } catch {
        return { error: 'Event links must be valid HTTPS URLs.', field: 'url' };
      }
    }
    return { title, date, time, location, description, url, trek };
  }

  app.post('/api/admin/events', requireAdmin, asyncRoute(async (req, res) => {
    const payload = eventPayload(req.body);
    if (payload.error) return res.status(400).json({ ok: false, error: payload.error, field: payload.field });
    const event = await store.insertEvent(payload);
    res.status(201).json({ ok: true, event });
  }));

  app.patch('/api/admin/events/:id', requireAdmin, asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const previous = store.snapshot().events.find((event) => event.id === id);
    if (!previous) return notFound(res);
    const payload = eventPayload(req.body, previous);
    if (payload.error) return res.status(400).json({ ok: false, error: payload.error, field: payload.field });
    const event = await store.updateEvent(id, payload);
    res.json({ ok: true, event });
  }));

  app.delete('/api/admin/events/:id', requireAdmin, asyncRoute(async (req, res) => {
    const event = await store.removeEvent(Number(req.params.id));
    if (!event) return notFound(res);
    res.json({ ok: true });
  }));

  app.get('/api/admin/search', requireAdmin, (req, res) => {
    const q = clean(req.query.q, 80).toLowerCase();
    if (!q) return res.json({ ok: true, results: [] });
    const snap = store.snapshot();
    const results = [];
    const add = (type, collection, row, subtitle) => {
      if (searchText(row).includes(q)) results.push({ type, collection, id: row.id, title: row.name, subtitle, status: row.status, href: `#/${collection}/${row.id}` });
    };
    for (const row of snap.applications) add('application', 'applications', row, row.org || row.wc);
    for (const row of snap.pledges) add('pledge', 'pledges', row, `${row.qty} × ${row.genre}`);
    for (const row of snap.passes) add('pass', 'passes', row, row.track);
    for (const row of snap.reservations) add('reservation', 'reservations', row, `${store.trekLabel(row.trek)} · ${row.wc}`);
    for (const row of snap.events) {
      const trekName = row.trek ? TREKS.find((item) => item.id === row.trek)?.name || row.trek : '';
      if (`${row.title} ${row.location} ${row.description} ${trekName}`.toLowerCase().includes(q)) {
        results.push({ type: 'event', collection: 'events', id: row.id, title: row.title, subtitle: `${row.date}${trekName ? ` · ${trekName}` : ''}${row.location ? ` · ${row.location}` : ''}`, href: '#/events' });
      }
    }
    res.json({ ok: true, results: results.slice(0, 12) });
  });

  app.get('/api/admin/activity', requireAdmin, (req, res) => {
    const snap = store.snapshot();
    const type = clean(req.query.type, 20);
    const q = clean(req.query.q, 80).toLowerCase();
    const refId = Number(req.query.ref_id);
    let rows = snap.activity.filter((row) => (!type || type === 'all' || row.type === type) && (!q || String(row.summary).toLowerCase().includes(q)) && (!Number.isInteger(refId) || refId <= 0 || row.ref_id === refId));
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);
    const limit = clamp(req.query.limit, 1, 100, 20);
    const page = clamp(req.query.page, 1, 10000, 1);
    const facets = { application: 0, pledge: 0, pass: 0, reservation: 0, event: 0 };
    for (const row of snap.activity) if (facets[row.type] != null) facets[row.type]++;
    res.json({ ok: true, total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / limit)), limit, facets, items: rows.slice((page - 1) * limit, page * limit) });
  });

  app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
    const type = clean(req.query.type, 20);
    const snap = store.snapshot();
    const specs = {
      applications: { headers: ['id', 'created_at', 'updated_at', 'status', 'name', 'wc', 'org', 'interests', 'msg', 'notes'], rows: snap.applications },
      pledges: { headers: ['id', 'created_at', 'updated_at', 'status', 'name', 'genre', 'qty', 'notes'], rows: snap.pledges },
      passes: { headers: ['id', 'created_at', 'updated_at', 'status', 'name', 'track', 'notes'], rows: snap.passes },
      reservations: { headers: ['id', 'created_at', 'updated_at', 'status', 'name', 'wc', 'trek', 'notes'], rows: snap.reservations },
    };
    const spec = specs[type];
    if (!spec) return res.status(400).json({ ok: false, error: 'Unknown export.' });
    let rows = spec.rows;
    const status = clean(req.query.status, 30);
    const trek = clean(req.query.trek, 20);
    const track = clean(req.query.track, 30);
    const genre = clean(req.query.genre, 60);
    const interest = clean(req.query.interest, 20);
    const q = clean(req.query.q, 80).toLowerCase();
    if (status && status !== 'all') rows = rows.filter((row) => row.status === status);
    if (trek && trek !== 'all') rows = rows.filter((row) => row.trek === trek);
    if (track && track !== 'all') rows = rows.filter((row) => row.track === track);
    if (genre && genre !== 'all') rows = rows.filter((row) => row.genre === genre);
    if (interest && interest !== 'all') rows = rows.filter((row) => (row.interests || []).includes(interest));
    if (q) rows = rows.filter((row) => searchText(row).includes(q));
    const allowedSort = new Set(['created_at', 'updated_at', 'name', 'status', 'qty', 'org', 'genre', 'track', 'trek', 'wc']);
    const sort = allowedSort.has(clean(req.query.sort, 20)) ? clean(req.query.sort, 20) : 'created_at';
    const direction = req.query.dir === 'asc' ? 1 : -1;
    rows = sortRows(rows, sort, direction);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hiworld-${type}.csv"`);
    res.send(makeCsv(spec.headers, rows));
  });

  app.post('/api/admin/bulk', requireAdmin, asyncRoute(async (req, res) => {
    const collection = clean(req.body.type, 20);
    const status = clean(req.body.status, 30);
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))] : [];
    if (!COLLECTIONS.includes(collection)) return res.status(400).json({ ok: false, error: 'Unknown record type.' });
    if (!STATUSES[collection].includes(status)) return res.status(400).json({ ok: false, error: 'Unknown status.' });
    if (!ids.length || ids.length > 100) return res.status(400).json({ ok: false, error: 'Choose between 1 and 100 records.' });
    const updated = [];
    const skipped = [];
    for (const id of ids) {
      const previous = rowFor(collection, id);
      if (!previous) { skipped.push(id); continue; }
      const next = { ...previous, status };
      if (collection === 'reservations' && status !== 'cancelled' && store.hasOpenReservation(next.wc, next.trek, id)) { skipped.push(id); continue; }
      if (collection === 'reservations' && TAKES_SEAT.has(status) && !TAKES_SEAT.has(previous.status)) {
        const trek = TREKS.find((item) => item.id === previous.trek);
        if (trek && store.seatsTaken(previous.trek, id) >= trek.seats) { skipped.push(id); continue; }
      }
      const log = activityFor(collection, next, previous, { status });
      try {
        const activity = { type: TYPE_OF[collection], ...log };
        const result = collection === 'reservations'
          ? await store.updateReservation(id, { status }, activity, TREKS.find((item) => item.id === next.trek)?.seats)
          : await store.updateRow(collection, id, { status }, activity);
        if (result) updated.push(result.id);
      } catch (error) {
        if (error.code === '23505' || error.code === 'CAPACITY_FULL') { skipped.push(id); continue; }
        throw error;
      }
    }
    res.json({ ok: true, updated, skipped });
  }));

  app.post('/api/admin/clear-all', requireAdmin, asyncRoute(async (req, res) => {
    if (clean(req.body.confirm, 40) !== 'CLEAR ALL DATA') {
      return res.status(400).json({ ok: false, error: 'Confirmation did not match.' });
    }
    const cleared = await store.clearAll();
    res.json({ ok: true, cleared, books: { pledged: 0, base: 0, goal: store.bookGoal() } });
  }));

  app.post('/api/admin/seed', requireAdmin, asyncRoute(async (req, res) => {
    if (!store.isEmpty()) return res.status(409).json({ ok: false, error: 'The desk already has records.' });
    await store.replaceAll(require('./seed').buildSeed());
    res.status(201).json({ ok: true, demo: true });
  }));
  app.post('/api/admin/reset-demo', requireAdmin, asyncRoute(async (req, res) => {
    if (!store.isDemo()) return res.status(403).json({ ok: false, error: 'Reset is only available for untouched sample data.' });
    if (clean(req.body.confirm, 40) !== 'RESET SAMPLE') return res.status(400).json({ ok: false, error: 'Confirmation did not match.' });
    await store.replaceAll(require('./seed').buildSeed());
    res.json({ ok: true, demo: true });
  }));

  for (const collection of COLLECTIONS) {
    app.get(`/api/admin/${collection}`, requireAdmin, (req, res) => {
      const body = listCollection(collection, req);
      const snap = store.snapshot();
      if (collection === 'reservations') {
        body.capacity = TREKS.map((trek) => {
          const rows = snap.reservations.filter((r) => r.trek === trek.id);
          const taken = rows.filter((r) => TAKES_SEAT.has(r.status)).length;
          const events = snap.events
            .filter((event) => event.trek === trek.id)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || '')))
            .map(({ id, title, date, time, location }) => ({ id, title, date, time, location }));
          return { id: trek.id, name: trek.name, days: trek.days, location: trek.location, image: trek.image, seats: trek.seats, taken, left: Math.max(0, trek.seats - taken), waitlisted: rows.filter((r) => r.status === 'waitlisted').length, checkedIn: rows.filter((r) => r.status === 'checked-in').length, events };
        });
      }
      if (collection === 'pledges') {
        const active = snap.pledges.filter((p) => p.status !== 'cancelled');
        const siteQty = active.reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
        const receivedQty = snap.pledges.filter((p) => p.status === 'received').reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
        const openQty = snap.pledges.filter((p) => p.status === 'pledged').reduce((sum, p) => sum + (Number(p.qty) || 0), 0);
        const goal = store.bookGoal();
        const baseline = store.bookBaseline();
        body.books = { pledged: baseline + siteQty, goal, toGo: Math.max(0, goal - baseline - siteQty), base: baseline, siteQty, receivedQty, openQty };
      }
      res.json(body);
    });
  }

  app.get('/api/admin/:collection/:id', requireAdmin, (req, res) => {
    const { collection } = req.params;
    if (!COLLECTIONS.includes(collection)) return notFound(res);
    const snap = store.snapshot();
    const item = snap[collection].find((row) => row.id === Number(req.params.id));
    if (!item) return notFound(res);
    const type = TYPE_OF[collection];
    const history = snap.activity.filter((row) => row.ref_id === item.id && row.type === type)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id).slice(0, 20);
    res.json({ ok: true, collection, item, activity: history });
  });

  app.post('/api/admin/applications', requireAdmin, asyncRoute(async (req, res) => {
    const name = clean(req.body.name, 80);
    const wc = clean(req.body.wc, 60);
    const org = clean(req.body.org, 120);
    const msg = clean(req.body.msg, 2000);
    const notes = clean(req.body.notes, 2000);
    const status = clean(req.body.status, 20) || 'new';
    const interests = Array.isArray(req.body.interests) ? [...new Set(req.body.interests.map((v) => clean(v, 20)).filter((v) => INTERESTS.has(v)))] : [];
    if (!isNonEmpty(name)) return res.status(400).json({ ok: false, error: 'Name is required.', field: 'name' });
    if (!isNonEmpty(wc)) return res.status(400).json({ ok: false, error: 'WeChat ID is required.', field: 'wc' });
    if (!STATUSES.applications.includes(status)) return res.status(400).json({ ok: false, error: 'Unknown status.' });
    const info = await stmts.insertApplication.run({ name, wc, org, interests, msg });
    if (status !== 'new' || notes) await store.updateRow('applications', info.lastInsertRowid, { status, notes }, { type: 'application', action: status !== 'new' ? 'status' : 'updated', summary: status !== 'new' ? `${name} marked ${status}` : `Note added on ${name}` });
    res.status(201).json({ ok: true, item: rowFor('applications', info.lastInsertRowid) });
  }));

  app.patch('/api/admin/applications/:id', requireAdmin, asyncRoute(async (req, res) => {
    const previous = rowFor('applications', req.params.id);
    if (!previous) return notFound(res);
    const patch = {};
    if (req.body.name != null) { patch.name = clean(req.body.name, 80); if (!patch.name) return res.status(400).json({ ok: false, error: 'Name is required.', field: 'name' }); }
    if (req.body.wc != null) { patch.wc = clean(req.body.wc, 60); if (!patch.wc) return res.status(400).json({ ok: false, error: 'WeChat ID is required.', field: 'wc' }); }
    if (req.body.org != null) patch.org = clean(req.body.org, 120);
    if (req.body.msg != null) patch.msg = clean(req.body.msg, 2000);
    if (req.body.notes != null) patch.notes = clean(req.body.notes, 2000);
    if (req.body.status != null) { patch.status = clean(req.body.status, 20); if (!STATUSES.applications.includes(patch.status)) return res.status(400).json({ ok: false, error: 'Unknown status.' }); }
    if (req.body.interests != null) {
      if (!Array.isArray(req.body.interests)) return res.status(400).json({ ok: false, error: 'Interests must be a list.' });
      patch.interests = [...new Set(req.body.interests.map((v) => clean(v, 20)).filter((v) => INTERESTS.has(v)))];
    }
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'Nothing to update.' });
    const result = await store.updateRow('applications', previous.id, patch, { type: 'application', ...activityFor('applications', { ...previous, ...patch }, previous, patch) });
    res.json({ ok: true, item: result });
  }));

  app.post('/api/admin/pledges', requireAdmin, asyncRoute(async (req, res) => {
    const name = clean(req.body.name, 40) || 'Anonymous';
    const genre = clean(req.body.genre, 60);
    const qty = Number(req.body.qty);
    const status = clean(req.body.status, 20) || 'pledged';
    const notes = clean(req.body.notes, 2000);
    if (!GENRES.has(genre)) return res.status(400).json({ ok: false, error: 'Unknown book genre.', field: 'genre' });
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ ok: false, error: 'Quantity must be 1–20.', field: 'qty' });
    if (!STATUSES.pledges.includes(status)) return res.status(400).json({ ok: false, error: 'Unknown status.' });
    const info = await stmts.insertPledge.run({ name, genre, qty });
    if (status !== 'pledged' || notes) await store.updateRow('pledges', info.lastInsertRowid, { status, notes }, { type: 'pledge', action: 'status', summary: status === 'received' ? `${name}'s ${qty} books marked received` : `${name}'s pledge marked ${status}` });
    res.status(201).json({ ok: true, item: rowFor('pledges', info.lastInsertRowid) });
  }));

  app.patch('/api/admin/pledges/:id', requireAdmin, asyncRoute(async (req, res) => {
    const previous = rowFor('pledges', req.params.id);
    if (!previous) return notFound(res);
    const patch = {};
    if (req.body.name != null) patch.name = clean(req.body.name, 40) || 'Anonymous';
    if (req.body.genre != null) { patch.genre = clean(req.body.genre, 60); if (!GENRES.has(patch.genre)) return res.status(400).json({ ok: false, error: 'Unknown book genre.', field: 'genre' }); }
    if (req.body.qty != null) { patch.qty = Number(req.body.qty); if (!Number.isInteger(patch.qty) || patch.qty < 1 || patch.qty > 20) return res.status(400).json({ ok: false, error: 'Quantity must be 1–20.', field: 'qty' }); }
    if (req.body.notes != null) patch.notes = clean(req.body.notes, 2000);
    if (req.body.status != null) { patch.status = clean(req.body.status, 20); if (!STATUSES.pledges.includes(patch.status)) return res.status(400).json({ ok: false, error: 'Unknown status.' }); }
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'Nothing to update.' });
    const result = await store.updateRow('pledges', previous.id, patch, { type: 'pledge', ...activityFor('pledges', { ...previous, ...patch }, previous, patch) });
    res.json({ ok: true, item: result });
  }));

  app.post('/api/admin/passes', requireAdmin, asyncRoute(async (req, res) => {
    const name = clean(req.body.name, 28);
    const track = clean(req.body.track, 20);
    const status = clean(req.body.status, 20) || 'active';
    const notes = clean(req.body.notes, 2000);
    if (!isNonEmpty(name)) return res.status(400).json({ ok: false, error: 'Name is required.', field: 'name' });
    if (!TRACKS.has(track)) return res.status(400).json({ ok: false, error: 'Unknown track.', field: 'track' });
    if (!STATUSES.passes.includes(status)) return res.status(400).json({ ok: false, error: 'Unknown status.' });
    const info = await stmts.insertPass.run({ name, track });
    if (status !== 'active' || notes) await store.updateRow('passes', info.lastInsertRowid, { status, notes }, { type: 'pass', action: status === 'revoked' ? 'status' : 'updated', summary: status === 'revoked' ? `${name}'s visitor pass revoked` : `Note added on ${name}'s pass` });
    res.status(201).json({ ok: true, item: rowFor('passes', info.lastInsertRowid) });
  }));

  app.patch('/api/admin/passes/:id', requireAdmin, asyncRoute(async (req, res) => {
    const previous = rowFor('passes', req.params.id);
    if (!previous) return notFound(res);
    const patch = {};
    if (req.body.name != null) { patch.name = clean(req.body.name, 28); if (!patch.name) return res.status(400).json({ ok: false, error: 'Name is required.', field: 'name' }); }
    if (req.body.track != null) { patch.track = clean(req.body.track, 20); if (!TRACKS.has(patch.track)) return res.status(400).json({ ok: false, error: 'Unknown track.', field: 'track' }); }
    if (req.body.notes != null) patch.notes = clean(req.body.notes, 2000);
    if (req.body.status != null) { patch.status = clean(req.body.status, 20); if (!STATUSES.passes.includes(patch.status)) return res.status(400).json({ ok: false, error: 'Unknown status.' }); }
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'Nothing to update.' });
    const result = await store.updateRow('passes', previous.id, patch, { type: 'pass', ...activityFor('passes', { ...previous, ...patch }, previous, patch) });
    res.json({ ok: true, item: result });
  }));

  app.post('/api/admin/reservations', requireAdmin, asyncRoute(async (req, res) => {
    const name = clean(req.body.name, 80);
    const wc = clean(req.body.wc, 60);
    const trek = clean(req.body.trek, 20);
    const status = clean(req.body.status, 20) || 'confirmed';
    const notes = clean(req.body.notes, 2000);
    if (!isNonEmpty(name)) return res.status(400).json({ ok: false, error: 'Name is required.', field: 'name' });
    if (!isNonEmpty(wc)) return res.status(400).json({ ok: false, error: 'WeChat ID is required.', field: 'wc' });
    const definition = TREKS.find((item) => item.id === trek);
    if (!definition) return res.status(400).json({ ok: false, error: 'Unknown trek.', field: 'trek' });
    if (!STATUSES.reservations.includes(status)) return res.status(400).json({ ok: false, error: 'Unknown status.' });
    if (TAKES_SEAT.has(status) && store.seatsTaken(trek) >= definition.seats) return res.status(409).json({ ok: false, error: `${definition.name} is full. Add them to the waitlist instead.` });
    try {
      const info = await stmts.insertReservation.run({ name, wc, trek, status, notes, seatLimit: definition.seats });
      res.status(201).json({ ok: true, item: rowFor('reservations', info.lastInsertRowid) });
    } catch (error) {
      if (error.code === '23505' || String(error.message).includes('UNIQUE')) return res.status(409).json({ ok: false, error: 'This WeChat ID already has a seat or waitlist spot on this trek.' });
      if (error.code === 'CAPACITY_FULL') return res.status(409).json({ ok: false, error: `${definition.name} is full. Add them to the waitlist instead.` });
      throw error;
    }
  }));

  app.patch('/api/admin/reservations/:id', requireAdmin, asyncRoute(async (req, res) => {
    const previous = rowFor('reservations', req.params.id);
    if (!previous) return notFound(res);
    const patch = {};
    if (req.body.name != null) { patch.name = clean(req.body.name, 80); if (!patch.name) return res.status(400).json({ ok: false, error: 'Name is required.', field: 'name' }); }
    if (req.body.wc != null) { patch.wc = clean(req.body.wc, 60); if (!patch.wc) return res.status(400).json({ ok: false, error: 'WeChat ID is required.', field: 'wc' }); }
    if (req.body.trek != null) { patch.trek = clean(req.body.trek, 20); if (!TREKS.some((item) => item.id === patch.trek)) return res.status(400).json({ ok: false, error: 'Unknown trek.', field: 'trek' }); }
    if (req.body.notes != null) patch.notes = clean(req.body.notes, 2000);
    if (req.body.status != null) { patch.status = clean(req.body.status, 20); if (!STATUSES.reservations.includes(patch.status)) return res.status(400).json({ ok: false, error: 'Unknown status.' }); }
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'Nothing to update.' });
    const next = { ...previous, ...patch };
    if (next.status !== 'cancelled' && store.hasOpenReservation(next.wc, next.trek, previous.id)) return res.status(409).json({ ok: false, error: 'This WeChat ID already has a seat or waitlist spot on this trek.' });
    const wasTakingSeat = TAKES_SEAT.has(previous.status) && previous.trek === next.trek;
    if (TAKES_SEAT.has(next.status) && !wasTakingSeat) {
      const definition = TREKS.find((item) => item.id === next.trek);
      if (definition && store.seatsTaken(next.trek, previous.id) >= definition.seats) return res.status(409).json({ ok: false, error: `${definition.name} is full. Keep them on the waitlist.` });
    }
    const definition = TREKS.find((item) => item.id === next.trek);
    try {
      const result = await store.updateReservation(previous.id, patch, { type: 'reservation', ...activityFor('reservations', next, previous, patch) }, definition?.seats);
      res.json({ ok: true, item: result });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ ok: false, error: 'This WeChat ID already has a seat or waitlist spot on this trek.' });
      if (error.code === 'CAPACITY_FULL') return res.status(409).json({ ok: false, error: `${definition?.name || 'This trek'} is full. Keep them on the waitlist.` });
      throw error;
    }
  }));

  for (const collection of COLLECTIONS) {
    app.delete(`/api/admin/${collection}/:id`, requireAdmin, asyncRoute(async (req, res) => {
      const row = rowFor(collection, req.params.id);
      if (!row) return notFound(res);
      const summary = collection === 'reservations' ? `${row.name}'s ${store.trekLabel(row.trek)} reservation removed`
        : collection === 'pledges' ? `${row.name}'s pledge removed`
          : collection === 'passes' ? `${row.name}'s visitor pass removed` : `${row.name}'s application removed`;
      await store.removeRow(collection, row.id, { type: TYPE_OF[collection], action: 'deleted', summary });
      res.json({ ok: true });
    }));
  }
}

module.exports = { registerAdmin, STATUSES };
