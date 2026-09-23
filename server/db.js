'use strict';

/**
 * Zero-dependency JSON file storage (no native builds required).
 * Keeps the same `stmts` interface the server uses.
 * File: data/club.json  (override with DB_PATH — .db/.json both fine)
 */

const fs = require('fs');
const path = require('path');

// On Vercel (serverless) only /tmp is writable — and it's ephemeral.
// Set DB_PATH to override. If the disk isn't writable we keep serving
// from memory rather than crashing.
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

function blank() {
  return { pledges: [], applications: [], passes: [], reservations: [], seq: 1 };
}

function load() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const d = JSON.parse(raw);
    if (!Array.isArray(d.pledges)) return blank();
    d.applications = d.applications || [];
    d.passes = d.passes || [];
    d.reservations = d.reservations || [];
    d.seq = d.seq || 1;
    return d;
  } catch {
    return blank();
  }
}

let data = load();
function save() {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DB_PATH);
}
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const stmts = {
  insertPledge: {
    run: ({ name, genre, qty }) => {
      const row = { id: data.seq++, name, genre, qty, created_at: now() };
      data.pledges.push(row);
      save();
      return { lastInsertRowid: row.id };
    },
  },
  listPledges: {
    all: ({ limit }) => [...data.pledges].reverse().slice(0, limit),
  },
  sumPledges: {
    get: () => ({ sum: data.pledges.reduce((a, p) => a + (p.qty || 0), 0) }),
  },
  countPledges: {
    get: () => ({ n: data.pledges.length }),
  },

  insertApplication: {
    run: ({ name, wc, org, interests, msg }) => {
      const row = { id: data.seq++, name, wc, org, interests, msg, created_at: now() };
      data.applications.push(row);
      save();
      return { lastInsertRowid: row.id };
    },
  },
  listApplications: {
    all: ({ limit, offset }) => [...data.applications].reverse().slice(offset, offset + limit),
  },
  countApplications: {
    get: () => ({ n: data.applications.length }),
  },

  insertPass: {
    run: ({ name, track }) => {
      const row = { id: data.seq++, name, track, created_at: now() };
      data.passes.push(row);
      save();
      return { lastInsertRowid: row.id };
    },
  },
  latestPasses: {
    all: ({ limit }) => [...data.passes].reverse().slice(0, limit),
  },
  countPasses: {
    get: () => ({ n: data.passes.length }),
  },

  insertReservation: {
    run: ({ name, wc, trek }) => {
      if (data.reservations.some((r) => r.wc === wc && r.trek === trek)) {
        throw new Error('UNIQUE constraint failed: reservations.wc, reservations.trek');
      }
      const row = { id: data.seq++, name, wc, trek, created_at: now() };
      data.reservations.push(row);
      save();
      return { lastInsertRowid: row.id };
    },
  },
  countByTrek: {
    all: () => {
      const m = {};
      for (const r of data.reservations) m[r.trek] = (m[r.trek] || 0) + 1;
      return Object.entries(m).map(([trek, n]) => ({ trek, n }));
    },
  },
};

module.exports = { stmts, DB_PATH };
