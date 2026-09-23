'use strict';

/**
 * Zero-dependency JSON file storage (no native builds required).
 * Keeps the same `stmts` interface the public API uses, and adds a `store`
 * for the club desk (status, notes, activity, admin edits).
 * File: data/club.json  (override with DB_PATH — .db/.json both fine)
 */

const fs = require('fs');
const path = require('path');

const isServerless = !!process.env.VERCEL;
let DB_PATH =
  process.env.DB_PATH ||
  (isServerless ? path.join('/tmp', 'hiworld-club.json') : path.join(__dirname, '..', 'data', 'club.json'));
if (DB_PATH.endsWith('.db')) DB_PATH += '.json';
try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch {
  /* read-only filesystem — in-memory mode */
}

const COLLECTIONS = ['pledges', 'applications', 'passes', 'reservations'];
const TREK_LABELS = { alibaba: 'Alibaba HQ', refinery: 'Refinery Island' };

function blank() {
  return { pledges: [], applications: [], passes: [], reservations: [], activity: [], seq: 1, meta: {} };
}

function trekLabel(id) {
  return TREK_LABELS[id] || id;
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function load() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return blank();
    return d;
  } catch {
    return blank();
  }
}

function migrate(d) {
  const next = d && typeof d === 'object' ? d : blank();
  for (const c of COLLECTIONS) if (!Array.isArray(next[c])) next[c] = [];
  next.activity = Array.isArray(next.activity) ? next.activity : [];
  next.meta = next.meta && typeof next.meta === 'object' ? next.meta : {};

  for (const a of next.applications) {
    if (typeof a.interests === 'string') {
      try { a.interests = JSON.parse(a.interests); } catch { a.interests = []; }
    }
    if (!Array.isArray(a.interests)) a.interests = [];
    a.status = a.status || 'new';
    a.notes = a.notes || '';
    a.org = a.org || '';
    a.msg = a.msg || '';
    a.wc = a.wc || '';
    a.updated_at = a.updated_at || a.created_at;
  }
  for (const p of next.pledges) {
    p.status = p.status || 'pledged';
    p.notes = p.notes || '';
    p.name = p.name || 'Anonymous';
    p.updated_at = p.updated_at || p.created_at;
  }
  for (const p of next.passes) {
    p.status = p.status || 'active';
    p.notes = p.notes || '';
    p.updated_at = p.updated_at || p.created_at;
  }
  for (const r of next.reservations) {
    r.status = r.status || 'confirmed';
    r.notes = r.notes || '';
    r.updated_at = r.updated_at || r.created_at;
  }

  const ids = [];
  for (const c of [...COLLECTIONS, 'activity']) {
    for (const row of next[c]) if (row && row.id) ids.push(Number(row.id) || 0);
  }
  const maxId = ids.length ? Math.max(...ids) : 0;
  if (!next.seq || next.seq <= maxId) next.seq = maxId + 1;
  return next;
}

const loaded = load();
const loadedJson = JSON.stringify(loaded);
let data = migrate(loaded);

function save() {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DB_PATH);
}

if (JSON.stringify(data) !== loadedJson) {
  try { save(); } catch (err) { console.error('Store migration save failed:', err.message); }
}

function isEmpty() {
  return COLLECTIONS.every((c) => data[c].length === 0);
}

if (process.env.SEED_DEMO !== '0' && isEmpty()) {
  data = migrate(require('./seed').buildSeed());
  try { save(); } catch (err) { console.error('Seed save failed:', err.message); }
}

function snapshot() {
  return JSON.parse(JSON.stringify(data));
}

function pushActivity(entry) {
  const row = {
    id: data.seq++,
    type: entry.type,
    action: entry.action,
    summary: entry.summary,
    ref_id: entry.ref_id ?? null,
    created_at: entry.created_at || now(),
  };
  data.activity.push(row);
  if (data.activity.length > 500) data.activity.splice(0, data.activity.length - 500);
  return row;
}

function insertRow(collection, fields, activity) {
  // Once the first real submission/manual record arrives, the sample reset is locked out.
  if (data.meta.demo) data.meta.demo = false;
  const row = {
    ...fields,
    id: data.seq++,
    created_at: fields.created_at || now(),
    updated_at: fields.updated_at || fields.created_at || now(),
  };
  data[collection].push(row);
  if (activity) pushActivity({ ...activity, ref_id: activity.ref_id ?? row.id });
  save();
  return row;
}

function updateRow(collection, id, patch, activity) {
  const row = data[collection].find((r) => r.id === Number(id));
  if (!row) return null;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id' || k === 'created_at') continue;
    row[k] = v;
  }
  row.updated_at = now();
  if (activity) pushActivity({ ...activity, ref_id: activity.ref_id ?? row.id });
  save();
  return JSON.parse(JSON.stringify(row));
}

function removeRow(collection, id, activity) {
  const i = data[collection].findIndex((r) => r.id === Number(id));
  if (i < 0) return null;
  const [row] = data[collection].splice(i, 1);
  if (activity) pushActivity({ ...activity, ref_id: activity.ref_id ?? row.id });
  save();
  return row;
}

function seatsTaken(trek, exceptId) {
  return data.reservations.filter(
    (r) => r.trek === trek && r.id !== Number(exceptId) && (r.status === 'confirmed' || r.status === 'checked-in')
  ).length;
}

function hasOpenReservation(wc, trek, exceptId) {
  return data.reservations.some(
    (r) => r.id !== Number(exceptId) && r.wc === wc && r.trek === trek && r.status !== 'cancelled'
  );
}

function replaceAll(next) {
  data = migrate(JSON.parse(JSON.stringify(next)));
  save();
  return snapshot();
}

function byRecent(rows, limit) {
  return [...rows]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)
    .slice(0, limit);
}

const stmts = {
  insertPledge: {
    run: ({ name, genre, qty }) => {
      const row = insertRow(
        'pledges',
        { name, genre, qty, status: 'pledged', notes: '' },
        { type: 'pledge', action: 'created', summary: `${name} pledged ${qty} × ${genre}` }
      );
      return { lastInsertRowid: row.id };
    },
  },
  listPledges: {
    all: ({ limit }) => byRecent(data.pledges.filter((p) => p.status !== 'cancelled'), limit),
  },
  sumPledges: {
    get: () => ({
      sum: data.pledges.reduce((a, p) => a + (p.status === 'cancelled' ? 0 : p.qty || 0), 0),
    }),
  },
  countPledges: {
    get: () => ({ n: data.pledges.filter((p) => p.status !== 'cancelled').length }),
  },

  insertApplication: {
    run: ({ name, wc, org, interests, msg }) => {
      const list = Array.isArray(interests)
        ? interests
        : (() => { try { return JSON.parse(interests || '[]'); } catch { return []; } })();
      const row = insertRow(
        'applications',
        { name, wc, org: org || '', interests: list, msg: msg || '', status: 'new', notes: '' },
        { type: 'application', action: 'created', summary: `${name} applied to join` }
      );
      return { lastInsertRowid: row.id };
    },
  },
  listApplications: {
    all: ({ limit, offset }) => byRecent(data.applications, data.applications.length).slice(offset, offset + limit),
  },
  countApplications: {
    get: () => ({ n: data.applications.length }),
  },

  insertPass: {
    run: ({ name, track }) => {
      const row = insertRow(
        'passes',
        { name, track, status: 'active', notes: '' },
        { type: 'pass', action: 'created', summary: `Visitor pass issued to ${name} · ${track}` }
      );
      return { lastInsertRowid: row.id };
    },
  },
  latestPasses: {
    all: ({ limit }) => byRecent(data.passes.filter((p) => p.status !== 'revoked'), limit),
  },
  countPasses: {
    get: () => ({ n: data.passes.length }),
  },

  insertReservation: {
    run: ({ name, wc, trek, status, notes }) => {
      const st = status || 'confirmed';
      if (st !== 'cancelled' && hasOpenReservation(wc, trek)) {
        throw new Error('UNIQUE constraint failed: reservations.wc, reservations.trek');
      }
      const summary = st === 'waitlisted'
        ? `${name} joined the ${trekLabel(trek)} waitlist`
        : `${name} reserved ${trekLabel(trek)}`;
      const row = insertRow(
        'reservations',
        { name, wc, trek, status: st, notes: notes || '' },
        { type: 'reservation', action: 'created', summary }
      );
      return { lastInsertRowid: row.id };
    },
  },
  countByTrek: {
    all: () => {
      const m = {};
      for (const r of data.reservations) {
        if (r.status !== 'confirmed' && r.status !== 'checked-in') continue;
        m[r.trek] = (m[r.trek] || 0) + 1;
      }
      return Object.entries(m).map(([trek, n]) => ({ trek, n }));
    },
  },
};

const store = {
  snapshot,
  isEmpty,
  isDemo: () => !!data.meta.demo,
  seatsTaken,
  hasOpenReservation,
  updateRow,
  removeRow,
  replaceAll,
  trekLabel,
  now,
};

module.exports = { stmts, store, DB_PATH, trekLabel };
