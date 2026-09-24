'use strict';

/**
 * Club data store.
 *
 * Local development can use an atomic JSON-file store. Set DATABASE_URL to use
 * PostgreSQL in production. PostgreSQL stores the app state as JSONB in one
 * locked row so the existing club-desk operations remain atomic while being
 * durable and shared across serverless instances.
 */

const fs = require('fs');
const path = require('path');

const isServerless = !!process.env.VERCEL;
let DB_PATH = process.env.DB_PATH || (isServerless
  ? path.join('/tmp', 'hiworld-club.json')
  : path.join(__dirname, '..', 'data', 'club.json'));
if (DB_PATH.endsWith('.db')) DB_PATH += '.json';
try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch {
  /* read-only filesystem — in-memory mode */
}

const COLLECTIONS = ['pledges', 'applications', 'passes', 'reservations'];
const STORE_COLLECTIONS = [...COLLECTIONS, 'events'];
const DEFAULT_BOOK_GOAL = 500;
const DEFAULT_BOOK_BASELINE = 347;
const TREK_LABELS = { alibaba: 'Alibaba HQ', refinery: 'Refinery Island' };
const ACTIVE_SEAT_STATUSES = new Set(['confirmed', 'checked-in']);
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const TABLE_NAME = 'hiworld_club_state';
let storageInitializationState = DATABASE_URL ? 'initializing' : 'ready';
let storageInitializationErrorCode = '';

function blank() {
  return {
    pledges: [], applications: [], passes: [], reservations: [], events: [], activity: [], seq: 1,
    meta: { bookGoal: DEFAULT_BOOK_GOAL, bookBaseline: DEFAULT_BOOK_BASELINE },
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function trekLabel(id) {
  return TREK_LABELS[id] || id;
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function loadFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : blank();
  } catch {
    return blank();
  }
}

function migrate(value) {
  const next = value && typeof value === 'object' ? clone(value) : blank();
  for (const collection of STORE_COLLECTIONS) {
    if (!Array.isArray(next[collection])) next[collection] = [];
  }
  next.activity = Array.isArray(next.activity) ? next.activity : [];
  next.meta = next.meta && typeof next.meta === 'object' ? next.meta : {};

  const configuredGoal = Number(next.meta.bookGoal);
  next.meta.bookGoal = Number.isInteger(configuredGoal) && configuredGoal >= 1 && configuredGoal <= 100000
    ? configuredGoal : DEFAULT_BOOK_GOAL;
  const configuredBaseline = next.meta.bookBaseline == null ? NaN : Number(next.meta.bookBaseline);
  const migratedBaseline = next.meta.cleared_at && next.meta.bookBaseline == null
    ? 0 : DEFAULT_BOOK_BASELINE;
  next.meta.bookBaseline = Number.isInteger(configuredBaseline) && configuredBaseline >= 0 && configuredBaseline <= 100000
    ? configuredBaseline : migratedBaseline;

  for (const application of next.applications) {
    if (typeof application.interests === 'string') {
      try { application.interests = JSON.parse(application.interests); } catch { application.interests = []; }
    }
    if (!Array.isArray(application.interests)) application.interests = [];
    application.status = application.status || 'new';
    application.notes = application.notes || '';
    application.org = application.org || '';
    application.msg = application.msg || '';
    application.wc = application.wc || '';
    application.updated_at = application.updated_at || application.created_at;
  }
  for (const pledge of next.pledges) {
    pledge.status = pledge.status || 'pledged';
    pledge.notes = pledge.notes || '';
    pledge.name = pledge.name || 'Anonymous';
    pledge.updated_at = pledge.updated_at || pledge.created_at;
  }
  for (const pass of next.passes) {
    pass.status = pass.status || 'active';
    pass.notes = pass.notes || '';
    pass.updated_at = pass.updated_at || pass.created_at;
  }
  for (const reservation of next.reservations) {
    reservation.status = reservation.status || 'confirmed';
    reservation.notes = reservation.notes || '';
    reservation.updated_at = reservation.updated_at || reservation.created_at;
  }
  for (const event of next.events) {
    if (!event || typeof event !== 'object') continue;
    event.trek = event.trek === 'alibaba' || event.trek === 'refinery' ? event.trek : '';
  }

  const ids = [];
  for (const collection of [...STORE_COLLECTIONS, 'activity']) {
    for (const row of next[collection]) if (row && row.id) ids.push(Number(row.id) || 0);
  }
  const maxId = ids.length ? Math.max(...ids) : 0;
  if (!Number.isInteger(next.seq) || next.seq <= maxId) next.seq = maxId + 1;
  return next;
}

function saveFile(state) {
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state));
  fs.renameSync(tempPath, DB_PATH);
}

function isEmptyState(state) {
  // Audit-only stores can occur after deleting the last record; don't reseed over them.
  return STORE_COLLECTIONS.every((collection) => state[collection].length === 0) && state.activity.length === 0;
}

function prepareInitialState(source) {
  let state = migrate(source);
  if (process.env.SEED_DEMO !== '0' && isEmptyState(state) && !state.meta.suppressDemoSeed) {
    const bookGoal = state.meta.bookGoal;
    const bookBaseline = state.meta.bookBaseline;
    state = migrate(require('./seed').buildSeed());
    state.meta.bookGoal = bookGoal;
    state.meta.bookBaseline = bookBaseline;
  }
  return state;
}

let pool = null;
let data = blank();
let operationQueue = Promise.resolve();

function serialize(operation) {
  const pending = operationQueue.then(operation, operation);
  operationQueue = pending.catch(() => {});
  return pending;
}

function isEmpty() {
  return isEmptyState(data);
}

function insertRow(state, collection, fields, activity) {
  const stamp = now();
  const row = { id: state.seq++, created_at: stamp, updated_at: stamp, status: 'new', ...fields };
  state[collection].unshift(row);
  if (activity) pushActivity(state, activity);
  return clone(row);
}

function pushActivity(state, entry) {
  state.activity.unshift({
    id: state.seq++, created_at: now(),
    type: entry.type || 'application', action: entry.action || 'created',
    ref_id: entry.ref_id || null, summary: entry.summary || '',
  });
}

function updateRowInState(state, collection, id, patch, activity) {
  const rows = state[collection] || [];
  const index = rows.findIndex((row) => row.id === Number(id));
  if (index < 0) return null;
  const next = { ...rows[index], ...clone(patch), updated_at: now() };
  rows[index] = next;
  if (activity) pushActivity(state, { ...activity, ref_id: next.id });
  return clone(next);
}

function removeRowInState(state, collection, id, activity) {
  const rows = state[collection] || [];
  const index = rows.findIndex((row) => row.id === Number(id));
  if (index < 0) return null;
  const [removed] = rows.splice(index, 1);
  if (activity) pushActivity(state, { ...activity, ref_id: removed.id });
  return clone(removed);
}

let ready;

async function mutate(mutator) {
  await ready;
  return serialize(async () => {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(`SELECT state FROM ${TABLE_NAME} WHERE id = 1 FOR UPDATE`);
        if (!result.rows.length) throw new Error('PostgreSQL club state row is missing.');
        const draft = migrate(result.rows[0].state);
        const output = mutator(draft);
        await client.query(`UPDATE ${TABLE_NAME} SET state = $1::jsonb, revision = revision + 1, updated_at = NOW() WHERE id = 1`, [JSON.stringify(draft)]);
        await client.query('COMMIT');
        data = draft;
        return clone(output);
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      } finally {
        client.release();
      }
    }

    const draft = clone(data);
    const output = mutator(draft);
    saveFile(draft);
    data = draft;
    return clone(output);
  });
}

async function refresh() {
  await ready;
  if (!pool) return;
  await serialize(async () => {
    const result = await pool.query(`SELECT state FROM ${TABLE_NAME} WHERE id = 1`);
    if (result.rows.length) data = migrate(result.rows[0].state);
  });
}

function snapshot() {
  return clone(data);
}

function reservationCount(state, trek, exceptId) {
  return state.reservations.filter((row) => row.trek === trek
    && row.id !== exceptId && ACTIVE_SEAT_STATUSES.has(row.status)).length;
}

const stmts = {
  countApplications: { get: () => ({ n: data.applications.length }) },
  countPasses: { get: () => ({ n: data.passes.length }) },
  countByTrek: {
    all: () => Object.entries(data.reservations
      .filter((row) => ACTIVE_SEAT_STATUSES.has(row.status))
      .reduce((counts, row) => ({ ...counts, [row.trek]: (counts[row.trek] || 0) + 1 }), {}))
      .map(([trek, n]) => ({ trek, n })),
  },
  sumPledges: {
    get: () => ({ sum: data.pledges
      .filter((pledge) => pledge.status !== 'cancelled')
      .reduce((sum, pledge) => sum + (Number(pledge.qty) || 0), 0) }),
  },
  listPledges: {
    all: ({ limit }) => clone(data.pledges
      .filter((pledge) => pledge.status !== 'cancelled')
      .slice(0, limit)
      .map(({ id, name, genre, qty, created_at, status }) => ({ id, name, genre, qty, created_at, status }))),
  },
  listApplications: { all: ({ limit, offset }) => clone(data.applications.slice(offset, offset + limit)) },
  latestPasses: {
    all: ({ limit }) => clone(data.passes
      .filter((pass) => pass.status !== 'revoked')
      .slice(0, limit)
      .map(({ id, name, track, created_at }) => ({ id, name, track, created_at }))),
  },
  insertPledge: {
    run: (fields) => mutate((state) => {
      const clientId = String(fields.clientId || '').slice(0, 80);
      const currentEpoch = String(state.meta.cleared_at || '');
      if (clientId) {
        const existing = state.pledges.find((pledge) => pledge.client_id === clientId);
        if (existing) return { lastInsertRowid: existing.id, bookEpoch: currentEpoch, duplicate: true };
        if (fields.clientEpoch != null && String(fields.clientEpoch).slice(0, 64) !== currentEpoch) {
          const error = new Error('The club data was cleared while this pledge was offline. Please submit the pledge again.');
          error.code = 'STALE_CLIENT_EPOCH';
          throw error;
        }
      }
      const row = insertRow(state, 'pledges', {
        name: fields.name || 'Anonymous', genre: fields.genre, qty: fields.qty,
        status: fields.status || 'pledged', notes: fields.notes || '', ...(clientId ? { client_id: clientId } : {}),
      }, { type: 'pledge', action: 'created', summary: `${fields.name || 'Anonymous'} pledged ${fields.qty} books` });
      return { lastInsertRowid: row.id, bookEpoch: currentEpoch, duplicate: false };
    }),
  },
  insertApplication: {
    run: (fields) => mutate((state) => {
      const clientId = String(fields.clientId || '').slice(0, 80);
      const currentEpoch = String(state.meta.cleared_at || '');
      if (clientId) {
        const existing = state.applications.find((application) => application.client_id === clientId);
        if (existing) return { lastInsertRowid: existing.id, bookEpoch: currentEpoch, duplicate: true };
        if (fields.clientEpoch != null && String(fields.clientEpoch).slice(0, 64) !== currentEpoch) {
          const error = new Error('Club data was cleared while this application was offline. Please submit it again.');
          error.code = 'STALE_CLIENT_EPOCH';
          throw error;
        }
      }
      const interests = typeof fields.interests === 'string' ? JSON.parse(fields.interests || '[]') : (fields.interests || []);
      const row = insertRow(state, 'applications', {
        name: fields.name, wc: fields.wc, org: fields.org || '', interests, msg: fields.msg || '',
        notes: fields.notes || '', status: fields.status || 'new', ...(clientId ? { client_id: clientId } : {}),
      }, { type: 'application', action: 'created', summary: `${fields.name} applied to join` });
      return { lastInsertRowid: row.id, bookEpoch: currentEpoch, duplicate: false };
    }),
  },
  insertPass: {
    run: (fields) => mutate((state) => {
      const row = insertRow(state, 'passes', {
        name: fields.name, track: fields.track, status: fields.status || 'active', notes: fields.notes || '',
      }, { type: 'pass', action: 'created', summary: `${fields.name} issued a visitor pass` });
      return { lastInsertRowid: row.id };
    }),
  },
  insertReservation: {
    run: (fields) => mutate((state) => {
      if (state.reservations.some((row) => row.wc === fields.wc && row.trek === fields.trek && row.status !== 'cancelled')) {
        const error = new Error('UNIQUE constraint failed: reservations.wc, reservations.trek');
        error.code = '23505';
        throw error;
      }
      let status = fields.status || 'confirmed';
      const seatLimit = Number(fields.seatLimit);
      if (ACTIVE_SEAT_STATUSES.has(status) && Number.isInteger(seatLimit) && seatLimit >= 0
        && reservationCount(state, fields.trek) >= seatLimit) {
        if (fields.waitlistWhenFull) status = 'waitlisted';
        else {
          const error = new Error('Trek capacity is full.');
          error.code = 'CAPACITY_FULL';
          throw error;
        }
      }
      const row = insertRow(state, 'reservations', {
        name: fields.name, wc: fields.wc, trek: fields.trek, status, notes: fields.notes || '',
      }, { type: 'reservation', action: 'created', summary: `${fields.name} added to ${trekLabel(fields.trek)} · ${status}` });
      return { lastInsertRowid: row.id, status: row.status };
    }),
  },
};

function initializeFileStore() {
  const loaded = loadFile();
  const original = JSON.stringify(loaded);
  data = prepareInitialState(loaded);
  if (JSON.stringify(data) !== original) {
    try { saveFile(data); } catch (error) { console.error('Store initialization save failed:', error.message); }
  }
}

function postgresConnectionConfig(connectionString, env = process.env) {
  const { parse } = require('pg-connection-string');
  const config = parse(connectionString);
  const sslMode = String(config.sslmode || '').toLowerCase();
  const ssl = config.ssl && typeof config.ssl === 'object' ? config.ssl : {};
  const sslCa = String(env.DATABASE_SSL_CA || '').replace(/\\n/g, '\n').trim();
  const verifyCertificates = env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true';
  const allowUnverified = env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false';
  const sslRequested = /^(1|true|require)$/i.test(String(env.DATABASE_SSL || ''));
  const urlRequestsSsl = (!!sslMode && sslMode !== 'disable') || config.ssl === true
    || (config.ssl && typeof config.ssl === 'object');

  if (sslCa) {
    // A provider root certificate lets us validate private CA chains without disabling TLS checks.
    config.ssl = { ...ssl, ca: sslCa, rejectUnauthorized: true };
  } else if (verifyCertificates) {
    config.ssl = { ...ssl, rejectUnauthorized: true };
  } else if (allowUnverified && (urlRequestsSsl || sslRequested)) {
    config.ssl = { ...ssl, rejectUnauthorized: false };
  } else if (sslRequested && !sslMode) {
    config.ssl = { ...ssl, rejectUnauthorized: false };
  }

  return config;
}

async function initializePostgresStore() {
  const { Pool } = require('pg');
  const configuredPoolMax = Number(process.env.PGPOOL_MAX);
  const defaultPoolMax = isServerless ? 1 : 5;
  pool = new Pool({
    ...postgresConnectionConfig(DATABASE_URL),
    max: Number.isInteger(configuredPoolMax) && configuredPoolMax >= 1
      ? Math.min(20, configuredPoolMax) : defaultPoolMax,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (error) => console.error('PostgreSQL idle client error:', error.message));

  let client;
  try {
    client = await pool.connect();
    await client.query(`CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      state JSONB NOT NULL,
      revision BIGINT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query('BEGIN');
    const existing = await client.query(`SELECT state FROM ${TABLE_NAME} WHERE id = 1 FOR UPDATE`);
    if (!existing.rows.length) {
      const bootstrap = prepareInitialState(loadFile());
      await client.query(
        `INSERT INTO ${TABLE_NAME} (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(bootstrap)],
      );
    }
    const result = await client.query(`SELECT state FROM ${TABLE_NAME} WHERE id = 1 FOR UPDATE`);
    const raw = result.rows[0].state;
    data = migrate(raw);
    if (JSON.stringify(data) !== JSON.stringify(raw)) {
      await client.query(`UPDATE ${TABLE_NAME} SET state = $1::jsonb, revision = revision + 1, updated_at = NOW() WHERE id = 1`, [JSON.stringify(data)]);
    }
    await client.query('COMMIT');
    storageInitializationState = 'ready';
    storageInitializationErrorCode = '';
  } catch (error) {
    storageInitializationState = 'error';
    storageInitializationErrorCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
      ? error.code : 'DATABASE_CONNECT_FAILED';
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    await pool.end().catch(() => {});
    pool = null;
    throw error;
  } finally {
    client?.release();
  }
}

if (DATABASE_URL) {
  ready = initializePostgresStore().catch((error) => {
    storageInitializationState = 'error';
    storageInitializationErrorCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
      ? error.code : 'DATABASE_CONNECT_FAILED';
    console.error('PostgreSQL initialization failed:', error.message);
    throw error;
  });
} else {
  storageInitializationState = 'ready';
  initializeFileStore();
  ready = Promise.resolve();
}

function storageStatus() {
  if (!DATABASE_URL) return { storage: 'json', databaseConfigured: false, ready: true };
  if (storageInitializationState === 'ready' && pool) {
    return { storage: 'postgres', databaseConfigured: true, ready: true };
  }
  if (storageInitializationState === 'error') {
    return {
      storage: 'unavailable', databaseConfigured: true, ready: false,
      databaseErrorCode: storageInitializationErrorCode || 'DATABASE_CONNECT_FAILED',
    };
  }
  return { storage: 'initializing', databaseConfigured: true, ready: false };
}

const store = {
  ready,
  refresh,
  snapshot,
  storageMode: () => storageStatus().storage,
  storageStatus,
  storagePath: () => DB_PATH,
  isEmpty,
  isDemo: () => !!data.meta.demo,
  bookGoal: () => data.meta.bookGoal || DEFAULT_BOOK_GOAL,
  bookBaseline: () => Number.isInteger(data.meta.bookBaseline) ? data.meta.bookBaseline : DEFAULT_BOOK_BASELINE,
  bookEpoch: () => String(data.meta.cleared_at || ''),
  setBookGoal: (goal) => mutate((state) => { state.meta.bookGoal = goal; return goal; }),
  setBookBaseline: (baseline) => mutate((state) => { state.meta.bookBaseline = baseline; return baseline; }),
  trekLabel,
  hasOpenReservation: (wc, trek, exceptId) => data.reservations.some((row) => row.wc === wc && row.trek === trek && row.id !== exceptId && row.status !== 'cancelled'),
  seatsTaken: (trek, exceptId) => reservationCount(data, trek, exceptId),
  insertEvent: (fields) => mutate((state) => insertRow(state, 'events', {
    title: fields.title, date: fields.date, time: fields.time || '', location: fields.location || '',
    description: fields.description || '', url: fields.url || '', trek: fields.trek || '',
  }, { type: 'event', action: 'created', summary: `${fields.title} added for ${fields.date}` })),
  updateEvent: (id, fields) => mutate((state) => updateRowInState(state, 'events', id, fields, {
    type: 'event', action: 'updated', summary: `${fields.title || 'Club event'} updated`,
  })),
  removeEvent: (id) => mutate((state) => {
    const previous = state.events.find((row) => row.id === Number(id));
    return previous ? removeRowInState(state, 'events', id, {
      type: 'event', action: 'deleted', summary: `${previous.title} removed from the calendar`,
    }) : null;
  }),
  updateRow: (collection, id, patch, activity) => mutate((state) => updateRowInState(state, collection, id, patch, activity)),
  updateReservation: (id, patch, activity, seatLimit) => mutate((state) => {
    const previous = state.reservations.find((row) => row.id === Number(id));
    if (!previous) return null;
    const next = { ...previous, ...patch };
    if (next.status !== 'cancelled' && state.reservations.some((row) => row.id !== previous.id
      && row.wc === next.wc && row.trek === next.trek && row.status !== 'cancelled')) {
      const error = new Error('UNIQUE constraint failed: reservations.wc, reservations.trek');
      error.code = '23505';
      throw error;
    }
    const wasTakingSeat = ACTIVE_SEAT_STATUSES.has(previous.status) && previous.trek === next.trek;
    if (ACTIVE_SEAT_STATUSES.has(next.status) && !wasTakingSeat
      && reservationCount(state, next.trek, previous.id) >= Number(seatLimit)) {
      const error = new Error('Trek capacity is full.');
      error.code = 'CAPACITY_FULL';
      throw error;
    }
    return updateRowInState(state, 'reservations', previous.id, patch, activity);
  }),
  removeRow: (collection, id, activity) => mutate((state) => removeRowInState(state, collection, id, activity)),
  clearAll: () => mutate((state) => {
    const counts = Object.fromEntries(STORE_COLLECTIONS.map((collection) => [collection, state[collection].length]));
    counts.activity = state.activity.length;
    counts.historicalBooks = Number(state.meta.bookBaseline) || 0;
    const bookGoal = state.meta.bookGoal;
    const clearedAt = now();
    for (const collection of STORE_COLLECTIONS) state[collection] = [];
    state.activity = [];
    state.seq = 1;
    state.meta = { bookGoal, bookBaseline: 0, suppressDemoSeed: true, cleared_at: clearedAt };
    return counts;
  }),
  replaceAll: (next) => mutate((state) => {
    const currentGoal = state.meta.bookGoal;
    const currentBaseline = state.meta.bookBaseline;
    const replacement = clone(next);
    replacement.meta = { ...(replacement.meta || {}) };
    if (replacement.meta.bookGoal == null) replacement.meta.bookGoal = currentGoal;
    if (replacement.meta.bookBaseline == null) replacement.meta.bookBaseline = currentBaseline;
    const normalized = migrate(replacement);
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, normalized);
    return normalized;
  }),
};

module.exports = {
  stmts, store, COLLECTIONS, STORE_COLLECTIONS, DEFAULT_BOOK_GOAL, DEFAULT_BOOK_BASELINE,
  postgresConnectionConfig,
};
