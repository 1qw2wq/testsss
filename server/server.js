'use strict';

/**
 * Hi World Club backend — Express with PostgreSQL or local JSON persistence.
 * Serves the static site from /public and exposes a JSON API under /api.
 *
 * API:
 *   GET  /api/health
 *   GET  /api/treks
 *   GET  /api/stats
 *   GET  /api/public/activity  privacy-safe club update feed
 *   GET  /api/pledges?limit=8
 *   POST /api/pledges            { name?, genre, qty }
 *   POST /api/applications       { name*, wc*, org?, interests?[], msg? }
 *   GET  /api/applications       (admin: header x-admin-token or ?token=)
 *   POST /api/passes             { name*, track }
 *   GET  /api/passes/latest?limit=5
 *   POST /api/reservations       { name*, wc*, trek: alibaba|refinery }
 *   GET  /api/reservations/counts
 *   /api/admin/*                 club desk (see adminRoutes.js)
 */

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { stmts, store } = require('./db');
const { registerAdmin } = require('./adminRoutes');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'hiworld-admin';
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const GENRES = new Set([
  "Children's picture books",
  'Middle-grade fiction',
  'STEM & science',
  'English learning',
  'Classics',
]);
const TRACKS = new Set(['All-rounder', 'Treks', 'Craft', 'Impact']);
const INTERESTS = new Set(['treks', 'workshops', 'csr']);
const DEFAULT_TREKS = [
  {
    id: 'alibaba',
    name: 'Alibaba HQ · Hangzhou',
    days: '1 day',
    location: 'Hangzhou',
    themes: 'E-commerce · Cloud · Logistics',
    seats: 20,
    image: '/images/trek-alibaba.jpg',
    alt: 'Modern tech campus buildings on a student guided tour',
  },
  {
    id: 'refinery',
    name: 'Private Refinery Island',
    days: '2 days',
    location: 'Island site · ferry transfer',
    themes: 'Energy · Operations · Safety',
    seats: 16,
    image: '/images/trek-refinery.jpg',
    alt: 'Island refinery glowing at dusk with a ferry approaching',
  },
];

/* ---------------- middleware ---------------- */
// NOTE: frameguard / CSP disabled so the site can run inside proxied previews & iframes.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, frameguard: false }));
app.use(cors());
// Trek images are compressed in the admin browser and stored with the durable
// PostgreSQL state. Keep this below Vercel's request limit.
app.use(express.json({ limit: '2.5mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const apiLimiter = rateLimit({ windowMs: 60_000, max: 180, standardHeaders: 'draft-8', legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: 'draft-8', legacyHeaders: false });
app.use('/api/', apiLimiter);
// Keep health reachable even when DATABASE_URL is misconfigured and store.ready rejects.
app.get('/api/health', (req, res) => {
  const storage = store.storageStatus();
  res.status(storage.ready ? 200 : 503).json({
    ok: storage.ready,
    time: new Date().toISOString(),
    ...storage,
    serverless: Boolean(process.env.VERCEL),
    adminDefault: ADMIN_TOKEN === 'hiworld-admin',
  });
});
app.use('/api/', asyncRoute(async (req, res, next) => {
  await store.ready;
  await store.refresh();
  next();
}));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  etag: true,
  setHeaders(res, filePath) {
    // HTML and interactive app assets must never cache — always serve the latest.
    const freshAsset = ['admin.js', 'admin.css', 'app.js', 'events.js', 'events.css', 'styles.css']
      .some((name) => filePath.endsWith(`${path.sep}${name}`));
    if (filePath.endsWith('.html') || freshAsset) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  },
}));

/* ---------------- helpers ---------------- */
const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const isNonEmpty = (v) => clean(v).length > 0;

function reservationCounts() {
  const rows = stmts.countByTrek.all();
  const counts = Object.fromEntries(store.treks().map((trek) => [trek.id, 0]));
  for (const r of rows) if (counts[r.trek] != null) counts[r.trek] = r.n;
  return counts;
}

function pledgeTotal() {
  return store.bookBaseline() + (stmts.sumPledges.get().sum || 0);
}

function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token') || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

/* ---------------- routes ---------------- */
app.get('/api/treks', (req, res) => {
  const counts = reservationCounts();
  res.json({
    ok: true,
    treks: store.treks().map((t) => ({
      ...t,
      reserved: counts[t.id] || 0,
      left: Math.max(0, t.seats - (counts[t.id] || 0)),
    })),
  });
});

app.get('/api/stats', (req, res) => {
  const total = pledgeTotal();
  const goal = store.bookGoal();
  res.json({
    ok: true,
    books: { pledged: total, goal, toGo: Math.max(0, goal - total), base: store.bookBaseline(), epoch: store.bookEpoch() },
    applications: stmts.countApplications.get().n,
    passes: stmts.countPasses.get().n,
    reservations: reservationCounts(),
  });
});

// Anonymous, privacy-safe feed for the public homepage. Private applications,
// names, WeChat IDs, notes, and internal activity summaries never leave here.
function publicActivityMessage(event) {
  if (event.action === 'deleted') {
    return event.type === 'event' ? 'A club event was removed.'
      : event.type === 'application' ? 'A club application was removed.'
        : event.type === 'pledge' ? 'A book-drive pledge was removed.'
          : event.type === 'pass' ? 'A visitor pass was removed.'
            : 'A trek roster entry was removed.';
  }
  if (event.action === 'created') {
    return event.type === 'event' ? 'A new club event was announced.'
      : event.type === 'application' ? 'A new club application was received.'
        : event.type === 'pledge' ? 'New books were pledged to the drive.'
          : event.type === 'pass' ? 'A visitor pass was issued.'
            : 'A trek reservation was added.';
  }
  return event.type === 'event' ? 'A club event was updated.'
    : event.type === 'application' ? 'Club application review was updated.'
      : event.type === 'pledge' ? 'The book drive was updated.'
        : event.type === 'pass' ? 'The visitor roster was updated.'
          : 'The trek roster was updated.';
}

app.get('/api/public/activity', (req, res) => {
  const limit = Math.min(8, Math.max(1, Number(req.query.limit) || 5));
  const visible = new Set(['application', 'pledge', 'pass', 'reservation', 'event']);
  const activity = store.snapshot().activity
    .filter((event) => visible.has(event.type))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)
    .slice(0, limit)
    .map((event) => ({
      type: event.type,
      message: publicActivityMessage(event),
      created_at: event.created_at,
    }));
  res.json({ ok: true, activity });
});

// ---- pledges ----
app.get('/api/pledges', (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 8));
  const total = pledgeTotal();
  const goal = store.bookGoal();
  res.json({
    ok: true,
    total,
    goal,
    base: store.bookBaseline(),
    epoch: store.bookEpoch(),
    toGo: Math.max(0, goal - total),
    pledges: stmts.listPledges.all({ limit }),
  });
});

app.post('/api/pledges', writeLimiter, asyncRoute(async (req, res) => {
  const name = clean(req.body.name, 40) || 'Anonymous';
  const genre = clean(req.body.genre, 60);
  const qty = Number(req.body.qty);
  const clientId = clean(req.body.client_id, 80);
  const clientEpoch = req.body.client_epoch == null ? null : clean(req.body.client_epoch, 64);
  if (!GENRES.has(genre)) return res.status(400).json({ ok: false, error: 'Unknown book genre.' });
  if (!Number.isInteger(qty) || qty < 1 || qty > 20)
    return res.status(400).json({ ok: false, error: 'Quantity must be 1–20.' });
  if (clientId && !/^[A-Za-z0-9_-]{8,80}$/.test(clientId)) return res.status(400).json({ ok: false, error: 'Invalid submission identifier.' });
  try {
    const info = await stmts.insertPledge.run({ name, genre, qty, clientId, clientEpoch });
    const total = pledgeTotal();
    res.status(info.duplicate ? 200 : 201).json({
      ok: true, pledge: { id: info.lastInsertRowid, name, genre, qty }, total,
      goal: store.bookGoal(), base: store.bookBaseline(), epoch: info.bookEpoch,
      duplicate: info.duplicate,
    });
  } catch (error) {
    if (error.code === 'STALE_CLIENT_EPOCH') {
      return res.status(409).json({ ok: false, error: error.message, code: error.code });
    }
    throw error;
  }
}));

function clubToday() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// Public event cards expose only fields intentionally entered for publication.
app.get('/api/events', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 12));
  const events = store.snapshot().events
    .filter((event) => String(event.date || '') >= clubToday())
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.time || '').localeCompare(String(b.time || '')) || a.id - b.id)
    .slice(0, limit)
    .map(({ id, title, date, time, location, description, url, trek }) => ({ id, title, date, time, location, description, url, trek: trek || '' }));
  res.json({ ok: true, events });
});

// ---- applications (join) ----
app.post('/api/applications', writeLimiter, asyncRoute(async (req, res) => {
  const name = clean(req.body.name, 80);
  const wc = clean(req.body.wc, 60);
  const org = clean(req.body.org, 120);
  const msg = clean(req.body.msg, 2000);
  const interests = Array.isArray(req.body.interests)
    ? [...new Set(req.body.interests.map((i) => clean(i, 20)).filter((i) => INTERESTS.has(i)))]
    : [];
  const clientId = clean(req.body.client_id, 80);
  const clientEpoch = req.body.client_epoch == null ? null : clean(req.body.client_epoch, 64);
  if (!isNonEmpty(name)) return res.status(400).json({ ok: false, error: 'Name is required.', field: 'name' });
  if (!isNonEmpty(wc)) return res.status(400).json({ ok: false, error: 'WeChat ID is required.', field: 'wc' });
  if (clientId && !/^[A-Za-z0-9_-]{8,80}$/.test(clientId)) return res.status(400).json({ ok: false, error: 'Invalid submission identifier.' });
  try {
    const info = await stmts.insertApplication.run({ name, wc, org, interests: JSON.stringify(interests), msg, clientId, clientEpoch });
    res.status(info.duplicate ? 200 : 201).json({ ok: true, id: info.lastInsertRowid, name: name.split(' ')[0], epoch: info.bookEpoch, duplicate: info.duplicate });
  } catch (error) {
    if (error.code === 'STALE_CLIENT_EPOCH') return res.status(409).json({ ok: false, error: error.message, code: error.code });
    throw error;
  }
}));

app.get('/api/applications', requireAdmin, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = stmts.listApplications.all({ limit, offset }).map((r) => ({
    ...r,
    interests: Array.isArray(r.interests) ? [...r.interests] : [],
  }));
  res.json({ ok: true, total: stmts.countApplications.get().n, applications: rows });
});

// ---- passes ----
app.post('/api/passes', writeLimiter, asyncRoute(async (req, res) => {
  const name = clean(req.body.name, 28);
  const track = clean(req.body.track, 20);
  if (!isNonEmpty(name)) return res.status(400).json({ ok: false, error: 'Name is required.' });
  if (!TRACKS.has(track)) return res.status(400).json({ ok: false, error: 'Unknown track.' });
  const info = await stmts.insertPass.run({ name, track });
  res.status(201).json({ ok: true, pass: { id: info.lastInsertRowid, name, track } });
}));

app.get('/api/passes/latest', (req, res) => {
  const limit = Math.min(12, Math.max(1, Number(req.query.limit) || 5));
  res.json({ ok: true, passes: stmts.latestPasses.all({ limit }) });
});

// ---- reservations ----
app.get('/api/reservations/counts', (req, res) => res.json({ ok: true, counts: reservationCounts() }));

app.post('/api/reservations', writeLimiter, asyncRoute(async (req, res) => {
  const name = clean(req.body.name, 80);
  const wc = clean(req.body.wc, 60);
  const trek = clean(req.body.trek, 20);
  if (!isNonEmpty(name)) return res.status(400).json({ ok: false, error: 'Name is required.' });
  if (!isNonEmpty(wc)) return res.status(400).json({ ok: false, error: 'WeChat ID is required.' });
  const definition = store.treks().find((item) => item.id === trek);
  if (!definition) return res.status(400).json({ ok: false, error: 'Unknown trek.' });
  try {
    const info = await stmts.insertReservation.run({
      name, wc, trek, status: 'confirmed', seatLimit: definition.seats, waitlistWhenFull: true,
    });
    const counts = reservationCounts();
    if (info.status === 'waitlisted') {
      return res.status(201).json({ ok: true, id: info.lastInsertRowid, trek, waitlisted: true, left: 0 });
    }
    res.status(201).json({ ok: true, id: info.lastInsertRowid, trek, left: Math.max(0, definition.seats - (counts[trek] || 0)) });
  } catch (error) {
    if (error.code === '23505' || String(error.message).includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'This WeChat ID already has a seat or waitlist spot on this trek.' });
    }
    throw error;
  }
}));

/* ---------------- club desk ---------------- */
registerAdmin(app, {
  requireAdmin,
  clean,
  isNonEmpty,
  getTreks: (includeArchived = false) => store.treks(includeArchived),
  DEFAULT_TREKS,
  GENRES,
  TRACKS,
  INTERESTS,
  asyncRoute,
});

app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});
app.get(['/events', '/events/'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'events.html'));
});

/* ---------------- errors & fallback ---------------- */
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return;
  const storage = store.storageStatus();
  if (req.path.startsWith('/api/') && storage.databaseConfigured && !storage.ready) {
    return res.status(503).json({
      ok: false,
      error: storage.storage === 'initializing'
        ? 'The database is still initializing. Please retry shortly.'
        : 'The database connection is unavailable. Check DATABASE_URL in the deployment settings and the server logs.',
      code: storage.databaseErrorCode || 'STORAGE_UNAVAILABLE',
      ...(storage.databaseErrorHint ? { hint: storage.databaseErrorHint } : {}),
      ...(storage.databaseTLS ? { tls: storage.databaseTLS } : {}),
    });
  }
  res.status(err.status || 500).json({ ok: false, error: 'Something went wrong. Please try again.' });
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

if (require.main === module) {
  store.ready.then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`Hi World Club running on http://0.0.0.0:${PORT} (${store.storageMode()} storage)`));
  }).catch((error) => {
    console.error('Server could not initialize its data store:', error.message);
    process.exitCode = 1;
  });
}

module.exports = app;
