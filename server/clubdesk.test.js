'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dbPath = path.join(os.tmpdir(), `hiworld-club-test-${process.pid}-${Date.now()}.json`);
const token = 'test-clubdesk-secret';
process.env.DB_PATH = dbPath;
process.env.SEED_DEMO = '0';
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
process.env.ADMIN_TOKEN = token;
process.env.NODE_ENV = 'test';

const app = require('./server');

function listen(instance) {
  return new Promise((resolve, reject) => {
    const server = instance.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function request(base, pathname, { method = 'GET', body, admin = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (admin) headers['x-admin-token'] = token;
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, data };
}

test('club desk auth, live totals, status actions, and trek capacity', async (t) => {
  const server = await listen(app);
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    await t.test('health reports the active file adapter without leaking configuration', async () => {
      const health = await request(base, '/api/health');
      assert.equal(health.response.status, 200);
      assert.equal(health.data.ok, true);
      assert.equal(health.data.storage, 'json');
      assert.equal(health.data.databaseConfigured, false);
      assert.equal(health.data.ready, true);
      assert.equal(health.data.serverless, false);
      assert.equal('DATABASE_URL' in health.data, false);
    });

    await t.test('protects admin endpoints and records public applications', async () => {
      const denied = await request(base, '/api/admin/overview');
      assert.equal(denied.response.status, 401);

      const created = await request(base, '/api/applications', {
        method: 'POST',
        body: { name: 'Test Member', wc: 'test-member', org: 'Test University', interests: ['treks'], msg: 'Ready to explore.' },
      });
      assert.equal(created.response.status, 201);

      const listed = await request(base, '/api/admin/applications?limit=10', { admin: true });
      assert.equal(listed.response.status, 200);
      assert.equal(listed.data.total, 1);
      assert.equal(listed.data.items[0].name, 'Test Member');
      assert.equal(listed.data.items[0].status, 'new');
      assert.deepEqual(listed.data.items[0].interests, ['treks']);

      const changed = await request(base, `/api/admin/applications/${listed.data.items[0].id}`, {
        method: 'PATCH', admin: true, body: { status: 'declined', notes: 'Tested status transition.' },
      });
      assert.equal(changed.response.status, 200);
      assert.equal(changed.data.item.status, 'declined');

      // Public totals intentionally remain all-record counts, including declined applications.
      const stats = await request(base, '/api/stats');
      assert.equal(stats.data.applications, 1);

      const detail = await request(base, `/api/admin/applications/${listed.data.items[0].id}`, { admin: true });
      assert.ok(detail.data.activity.some((event) => event.summary.includes('marked declined')));
    });

    await t.test('persists an adjustable book goal for public and admin displays', async () => {
      const denied = await request(base, '/api/admin/book-goal', { method: 'PATCH', body: { goal: 600 } });
      assert.equal(denied.response.status, 401);
      const invalid = await request(base, '/api/admin/book-goal', { method: 'PATCH', admin: true, body: { goal: 2.5 } });
      assert.equal(invalid.response.status, 400);

      const saved = await request(base, '/api/admin/book-goal', { method: 'PATCH', admin: true, body: { goal: 600 } });
      assert.equal(saved.response.status, 200);
      assert.equal(saved.data.goal, 600);
      const stats = await request(base, '/api/stats');
      assert.equal(stats.data.books.goal, 600);
      assert.equal(stats.data.books.base, 347);
      assert.equal(stats.data.books.toGo, 253);
      const pledges = await request(base, '/api/pledges');
      assert.equal(pledges.data.goal, 600);
      assert.equal(pledges.data.base, 347);
      const deskPledges = await request(base, '/api/admin/pledges', { admin: true });
      assert.equal(deskPledges.data.books.goal, 600);
      assert.equal(deskPledges.data.books.pledged, 347);
      const overview = await request(base, '/api/admin/overview', { admin: true });
      assert.equal(overview.data.kpis.books.goal, 600);
      assert.equal(overview.data.kpis.books.base, 347);
    });

    await t.test('keeps public book totals in sync with admin status', async () => {
      const received = await request(base, '/api/admin/pledges', {
        method: 'POST', admin: true,
        body: { name: 'Test Donor', genre: 'Classics', qty: 2, status: 'received' },
      });
      assert.equal(received.response.status, 201);
      assert.equal(received.data.item.status, 'received');

      const cancelled = await request(base, '/api/admin/pledges', {
        method: 'POST', admin: true,
        body: { name: 'Withdrawn Donor', genre: 'STEM & science', qty: 5, status: 'cancelled' },
      });
      assert.equal(cancelled.response.status, 201);
      const stats = await request(base, '/api/stats');
      assert.equal(stats.data.books.pledged, 349);

      const list = await request(base, '/api/admin/pledges?status=received', { admin: true });
      assert.equal(list.data.total, 1);
      assert.equal(list.data.items[0].qty, 2);
    });

    await t.test('publishes editable public events and keeps an audit trail', async () => {
      const publicPage = await request(base, '/events');
      assert.equal(publicPage.response.status, 200);
      assert.match(publicPage.data, /Upcoming gatherings/);
      assert.match(publicPage.data, /\/js\/events\.js/);

      const denied = await request(base, '/api/admin/events');
      assert.equal(denied.response.status, 401);
      const invalidDate = await request(base, '/api/admin/events', {
        method: 'POST', admin: true, body: { title: 'Invalid date', date: '2026-02-31' },
      });
      assert.equal(invalidDate.response.status, 400);
      const invalidLink = await request(base, '/api/admin/events', {
        method: 'POST', admin: true, body: { title: 'Invalid link', date: '2099-02-16', url: 'javascript:alert(1)' },
      });
      assert.equal(invalidLink.response.status, 400);
      const invalidTrek = await request(base, '/api/admin/events', {
        method: 'POST', admin: true, body: { title: 'Invalid trek link', date: '2099-02-16', trek: 'unknown' },
      });
      assert.equal(invalidTrek.response.status, 400);

      const home = await request(base, '/');
      assert.match(home.data, /data-trek-events="alibaba"/);
      assert.match(home.data, /data-trek-events="refinery"/);

      const trekDenied = await request(base, '/api/admin/trek-definitions');
      assert.equal(trekDenied.response.status, 401);
      const newTrek = await request(base, '/api/admin/trek-definitions', {
        method: 'POST', admin: true, body: {
          id: 'design-studio', name: 'Design Studio', seats: 12, days: '1 day', location: 'Hangzhou',
          themes: 'Design · Craft', description: 'A working studio visit.', image: 'data:image/png;base64,iVBORw0KGgo=',
          itinerary: ['10:00|Studio welcome'], takeaways: ['A portfolio review'], note: 'Bring a sketchbook.',
        },
      });
      assert.equal(newTrek.response.status, 201);
      assert.equal(newTrek.data.trek.name, 'Design Studio');
      let publicTreks = await request(base, '/api/treks');
      assert.ok(publicTreks.data.treks.some((trek) => trek.id === 'design-studio' && trek.seats === 12));
      const editedTrek = await request(base, '/api/admin/trek-definitions/design-studio', {
        method: 'PATCH', admin: true, body: { name: 'Product Design Studio', seats: 14 },
      });
      assert.equal(editedTrek.response.status, 200);
      assert.equal(editedTrek.data.trek.seats, 14);
      const archivedTrek = await request(base, '/api/admin/trek-definitions/design-studio', { method: 'DELETE', admin: true });
      assert.equal(archivedTrek.response.status, 200);
      publicTreks = await request(base, '/api/treks');
      assert.equal(publicTreks.data.treks.some((trek) => trek.id === 'design-studio'), false);
      const restoredTrek = await request(base, '/api/admin/trek-definitions/design-studio/restore', { method: 'POST', admin: true });
      assert.equal(restoredTrek.response.status, 200);
      await request(base, '/api/admin/trek-definitions/design-studio', { method: 'DELETE', admin: true });

      const past = await request(base, '/api/admin/events', {
        method: 'POST', admin: true, body: { title: 'Past club meetup', date: '2000-01-01' },
      });
      assert.equal(past.response.status, 201);
      const created = await request(base, '/api/admin/events', {
        method: 'POST', admin: true,
        body: { title: 'Community book swap', date: '2099-02-16', time: '14:30', location: 'School library', description: 'Bring a book to share.', url: 'https://example.org/book-swap', trek: 'alibaba' },
      });
      assert.equal(created.response.status, 201);
      const eventId = created.data.event.id;
      const updated = await request(base, `/api/admin/events/${eventId}`, {
        method: 'PATCH', admin: true,
        body: { title: 'Spring book exchange', date: '2099-02-17', description: 'Bring a book and meet the club.', trek: 'refinery' },
      });
      assert.equal(updated.response.status, 200);
      assert.equal(updated.data.event.title, 'Spring book exchange');
      assert.equal(updated.data.event.time, '14:30');
      assert.equal(updated.data.event.location, 'School library');
      assert.equal(updated.data.event.url, 'https://example.org/book-swap');

      const publicList = await request(base, '/api/events');
      assert.equal(publicList.response.status, 200);
      assert.equal(publicList.data.events.length, 1);
      assert.equal(publicList.data.events[0].title, 'Spring book exchange');
      assert.equal(publicList.data.events[0].location, 'School library');
      assert.equal(publicList.data.events[0].trek, 'refinery');
      const search = await request(base, '/api/admin/search?q=Spring', { admin: true });
      assert.ok(search.data.results.some((result) => result.type === 'event' && result.href === '#/events'));
      assert.equal('created_at' in publicList.data.events[0], false);
      assert.equal('updated_at' in publicList.data.events[0], false);
      const trekDesk = await request(base, '/api/admin/reservations', { admin: true });
      const refineryDesk = trekDesk.data.capacity.find((trek) => trek.id === 'refinery');
      assert.deepEqual(refineryDesk.events, [{
        id: eventId, title: 'Spring book exchange', date: '2099-02-17',
        time: '14:30', location: 'School library', description: 'Bring a book and meet the club.',
        url: 'https://example.org/book-swap', trek: 'refinery',
      }]);

      const second = await request(base, '/api/admin/events', {
        method: 'POST', admin: true,
        body: { title: 'Club welcome evening', date: '2099-03-01', location: 'Student center' },
      });
      assert.equal(second.response.status, 201);
      const deleted = await request(base, `/api/admin/events/${eventId}`, { method: 'DELETE', admin: true });
      assert.equal(deleted.response.status, 200);
      const remaining = await request(base, '/api/events');
      assert.deepEqual(remaining.data.events.map((event) => event.title), ['Club welcome evening']);

      const feed = await request(base, '/api/public/activity');
      assert.ok(feed.data.activity.some((event) => event.message === 'A new club event was announced.'));
      assert.ok(feed.data.activity.some((event) => event.message === 'A club event was updated.'));
      assert.ok(feed.data.activity.some((event) => event.message === 'A club event was removed.'));
      assert.equal(JSON.stringify(feed.data).includes('Spring book exchange'), false);
      const adminLog = await request(base, '/api/admin/activity?type=event', { admin: true });
      assert.equal(adminLog.data.facets.event, 5);
      assert.equal(adminLog.data.items.length, 5);
    });

    await t.test('waitlists at capacity, prevents duplicate active bookings, and frees cancelled seats', async () => {
      const reservations = [];
      for (let i = 0; i < 20; i++) {
        const result = await request(base, '/api/admin/reservations', {
          method: 'POST', admin: true,
          body: { name: `Visitor ${i + 1}`, wc: `visitor-${i + 1}`, trek: 'alibaba' },
        });
        assert.equal(result.response.status, 201);
        reservations.push(result.data.item);
      }

      const waitlisted = await request(base, '/api/reservations', {
        method: 'POST', body: { name: 'Next Visitor', wc: 'next-visitor', trek: 'alibaba' },
      });
      assert.equal(waitlisted.response.status, 201);
      assert.equal(waitlisted.data.waitlisted, true);
      assert.equal((await request(base, '/api/reservations/counts')).data.counts.alibaba, 20);

      const duplicate = await request(base, '/api/admin/reservations', {
        method: 'POST', admin: true,
        body: { name: 'Next Visitor Again', wc: 'next-visitor', trek: 'alibaba' },
      });
      assert.equal(duplicate.response.status, 409);

      const cancelled = await request(base, `/api/admin/reservations/${reservations[0].id}`, {
        method: 'PATCH', admin: true, body: { status: 'cancelled' },
      });
      assert.equal(cancelled.response.status, 200);
      assert.equal((await request(base, '/api/reservations/counts')).data.counts.alibaba, 19);

      const promotedSeat = await request(base, '/api/reservations', {
        method: 'POST', body: { name: 'Seat Reopened', wc: 'seat-reopened', trek: 'alibaba' },
      });
      assert.equal(promotedSeat.response.status, 201);
      assert.equal(promotedSeat.data.waitlisted, undefined);
      assert.equal(promotedSeat.data.left, 0);
      assert.equal((await request(base, '/api/reservations/counts')).data.counts.alibaba, 20);
    });

    await t.test('exports CSV with the admin token', async () => {
      const denied = await request(base, '/api/admin/export.csv?type=applications');
      assert.equal(denied.response.status, 401);
      const exported = await request(base, '/api/admin/export.csv?type=applications', { admin: true });
      assert.equal(exported.response.status, 200);
      assert.match(String(exported.data), /Test Member/);
      assert.match(exported.response.headers.get('content-type'), /text\/csv/);
    });

    await t.test('shows safe public activity and clears every collection persistently', async () => {
      const livePledge = await request(base, '/api/admin/pledges', {
        method: 'POST', admin: true,
        body: { name: 'Public Sync Donor', genre: 'Classics', qty: 4, status: 'pledged' },
      });
      assert.equal(livePledge.response.status, 201);
      let publicPledges = await request(base, '/api/pledges?limit=50');
      assert.ok(publicPledges.data.pledges.some((pledge) => pledge.name === 'Public Sync Donor'));
      const deletePledge = await request(base, `/api/admin/pledges/${livePledge.data.item.id}`, {
        method: 'DELETE', admin: true,
      });
      assert.equal(deletePledge.response.status, 200);
      publicPledges = await request(base, '/api/pledges?limit=50');
      assert.equal(publicPledges.data.pledges.some((pledge) => pledge.name === 'Public Sync Donor'), false);

      const livePass = await request(base, '/api/admin/passes', {
        method: 'POST', admin: true,
        body: { name: 'Public Sync Visitor', track: 'Treks', status: 'active' },
      });
      assert.equal(livePass.response.status, 201);
      let publicPasses = await request(base, '/api/passes/latest?limit=6');
      assert.ok(publicPasses.data.passes.some((pass) => pass.name === 'Public Sync Visitor'));
      const deletePass = await request(base, `/api/admin/passes/${livePass.data.item.id}`, {
        method: 'DELETE', admin: true,
      });
      assert.equal(deletePass.response.status, 200);
      publicPasses = await request(base, '/api/passes/latest?limit=6');
      assert.equal(publicPasses.data.passes.some((pass) => pass.name === 'Public Sync Visitor'), false);

      const privateRecord = await request(base, '/api/admin/applications', {
        method: 'POST', admin: true,
        body: { name: 'Private Feed Applicant', wc: 'private-feed-wechat', org: 'Confidential School', interests: ['treks'], msg: 'Do not publish this note.' },
      });
      assert.equal(privateRecord.response.status, 201);
      const removed = await request(base, `/api/admin/applications/${privateRecord.data.item.id}`, {
        method: 'DELETE', admin: true,
      });
      assert.equal(removed.response.status, 200);

      const feed = await request(base, '/api/public/activity?limit=8');
      assert.equal(feed.response.status, 200);
      assert.ok(feed.data.activity.some((event) => event.message === 'A new club application was received.'));
      assert.ok(feed.data.activity.some((event) => event.message === 'A club application was removed.'));
      const publicJson = JSON.stringify(feed.data);
      for (const secret of ['Private Feed Applicant', 'private-feed-wechat', 'Confidential School', 'Do not publish this note.', 'ref_id', 'summary']) {
        assert.equal(publicJson.includes(secret), false, `public activity must not contain ${secret}`);
      }
      assert.ok(feed.data.activity.every((event) => !('id' in event) && !('action' in event)));

      const beforeOfflineSync = await request(base, '/api/stats');
      const offlineApplication = {
        name: 'Offline applicant', wc: 'offline-app-id', org: 'Test campus', interests: ['csr'], msg: 'Please count me in.',
        client_id: 'app-idempotency-001', client_epoch: beforeOfflineSync.data.books.epoch,
      };
      const firstApplicationSync = await request(base, '/api/applications', { method: 'POST', body: offlineApplication });
      assert.equal(firstApplicationSync.response.status, 201);
      const retryApplicationSync = await request(base, '/api/applications', { method: 'POST', body: offlineApplication });
      assert.equal(retryApplicationSync.response.status, 200);
      assert.equal(retryApplicationSync.data.duplicate, true);
      assert.equal(retryApplicationSync.data.id, firstApplicationSync.data.id);

      const offlinePledge = {
        name: 'Offline donor', genre: 'Classics', qty: 3,
        client_id: 'idempotency-test-001', client_epoch: beforeOfflineSync.data.books.epoch,
      };
      const firstSync = await request(base, '/api/pledges', { method: 'POST', body: offlinePledge });
      assert.equal(firstSync.response.status, 201);
      const retrySync = await request(base, '/api/pledges', { method: 'POST', body: offlinePledge });
      assert.equal(retrySync.response.status, 200);
      assert.equal(retrySync.data.duplicate, true);
      assert.equal(retrySync.data.pledge.id, firstSync.data.pledge.id);
      assert.equal((await request(base, '/api/stats')).data.books.pledged, beforeOfflineSync.data.books.pledged + 3);

      const unauthorized = await request(base, '/api/admin/clear-all', {
        method: 'POST', body: { confirm: 'CLEAR ALL DATA' },
      });
      assert.equal(unauthorized.response.status, 401);
      const badPhrase = await request(base, '/api/admin/clear-all', {
        method: 'POST', admin: true, body: { confirm: 'CLEAR' },
      });
      assert.equal(badPhrase.response.status, 400);

      const cleared = await request(base, '/api/admin/clear-all', {
        method: 'POST', admin: true, body: { confirm: 'CLEAR ALL DATA' },
      });
      assert.equal(cleared.response.status, 200);
      assert.ok(cleared.data.cleared.applications >= 1);
      assert.ok(cleared.data.cleared.pledges >= 2);
      assert.ok(cleared.data.cleared.reservations >= 20);
      assert.ok(cleared.data.cleared.events >= 2);
      assert.ok(cleared.data.cleared.activity >= 20);
      assert.equal(cleared.data.cleared.historicalBooks, 347);
      assert.deepEqual(cleared.data.books, { pledged: 0, base: 0, goal: 600 });
      const staleOfflinePledge = await request(base, '/api/pledges', {
        method: 'POST', body: { name: 'Old queued pledge', genre: 'Classics', qty: 1, client_id: 'stale-pledge-001', client_epoch: '' },
      });
      assert.equal(staleOfflinePledge.response.status, 409);
      assert.equal(staleOfflinePledge.data.code, 'STALE_CLIENT_EPOCH');
      const staleOfflineApplication = await request(base, '/api/applications', {
        method: 'POST', body: { name: 'Old queued applicant', wc: 'old-offline-id', client_id: 'stale-applicant-001', client_epoch: '' },
      });
      assert.equal(staleOfflineApplication.response.status, 409);
      assert.equal(staleOfflineApplication.data.code, 'STALE_CLIENT_EPOCH');

      for (const collection of ['applications', 'pledges', 'passes', 'reservations', 'events']) {
        const list = await request(base, `/api/admin/${collection}`, { admin: true });
        assert.equal(list.data.total, 0, `${collection} should be empty after clearing`);
      }
      assert.equal((await request(base, '/api/admin/activity', { admin: true })).data.total, 0);
      assert.deepEqual((await request(base, '/api/public/activity')).data.activity, []);
      const emptyPledges = await request(base, '/api/pledges?limit=50');
      assert.deepEqual(emptyPledges.data.pledges, []);
      assert.equal(emptyPledges.data.total, 0);
      assert.equal(emptyPledges.data.base, 0);
      assert.deepEqual((await request(base, '/api/passes/latest')).data.passes, []);
      assert.deepEqual((await request(base, '/api/reservations/counts')).data.counts, { alibaba: 0, refinery: 0 });

      // Start a fresh Node process with normal demo seeding enabled. An explicit
      // wipe must keep the file empty rather than silently restoring sample rows.
      const script = `const { store } = require(${JSON.stringify(require.resolve('./db'))}); process.stdout.write(JSON.stringify(store.snapshot()));`;
      const restarted = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        env: { ...process.env, DB_PATH: dbPath, SEED_DEMO: '1' },
      });
      assert.equal(restarted.status, 0, restarted.stderr);
      const persisted = JSON.parse(restarted.stdout);
      assert.deepEqual(persisted.applications, []);
      assert.deepEqual(persisted.pledges, []);
      assert.deepEqual(persisted.passes, []);
      assert.deepEqual(persisted.reservations, []);
      assert.deepEqual(persisted.events, []);
      assert.deepEqual(persisted.activity, []);
      assert.equal(persisted.meta.bookGoal, 600);
      assert.equal(persisted.meta.bookBaseline, 0);
      assert.equal(persisted.meta.suppressDemoSeed, true);

      // The regular first-run demo seed must retain a goal configured before any
      // record was created, even though the store is otherwise empty.
      const configuredEmptyPath = `${dbPath}.configured-empty.json`;
      try {
        fs.writeFileSync(configuredEmptyPath, JSON.stringify({
          applications: [], pledges: [], passes: [], reservations: [], events: [],
          activity: [], seq: 1, meta: { bookGoal: 725 },
        }));
        const configuredScript = `const { store } = require(${JSON.stringify(require.resolve('./db'))}); process.stdout.write(JSON.stringify(store.snapshot()));`;
        const configuredRestart = spawnSync(process.execPath, ['-e', configuredScript], {
          encoding: 'utf8',
          env: { ...process.env, DB_PATH: configuredEmptyPath, SEED_DEMO: '1' },
        });
        assert.equal(configuredRestart.status, 0, configuredRestart.stderr);
        const configuredStore = JSON.parse(configuredRestart.stdout);
        assert.equal(configuredStore.meta.bookGoal, 725);
        assert.equal(configuredStore.meta.bookBaseline, 347);
        assert.ok(configuredStore.meta.demo);
        assert.ok(configuredStore.applications.length > 0);
      } finally {
        fs.rmSync(configuredEmptyPath, { force: true });
        fs.rmSync(`${configuredEmptyPath}.tmp`, { force: true });
      }

      // An older explicit clear marker had no persisted baseline field. Treat it
      // as a zero baseline during migration instead of restoring the old 347.
      const legacyClearPath = `${dbPath}.legacy-clear.json`;
      try {
        fs.writeFileSync(legacyClearPath, JSON.stringify({
          applications: [], pledges: [], passes: [], reservations: [], events: [],
          activity: [], seq: 1, meta: { bookGoal: 725, suppressDemoSeed: true, cleared_at: '2026-01-01 00:00:00' },
        }));
        const legacyScript = `const { store } = require(${JSON.stringify(require.resolve('./db'))}); process.stdout.write(JSON.stringify(store.snapshot()));`;
        const legacyRestart = spawnSync(process.execPath, ['-e', legacyScript], {
          encoding: 'utf8', env: { ...process.env, DB_PATH: legacyClearPath, SEED_DEMO: '1' },
        });
        assert.equal(legacyRestart.status, 0, legacyRestart.stderr);
        const legacyStore = JSON.parse(legacyRestart.stdout);
        assert.equal(legacyStore.meta.bookBaseline, 0);
        assert.deepEqual(legacyStore.pledges, []);
      } finally {
        fs.rmSync(legacyClearPath, { force: true });
        fs.rmSync(`${legacyClearPath}.tmp`, { force: true });
      }

      // Deleting every record one-by-one leaves audit history; that is not a
      // truly empty store and should not trigger demo seeding either.
      const auditOnlyPath = `${dbPath}.audit-only.json`;
      try {
        fs.writeFileSync(auditOnlyPath, JSON.stringify({
          applications: [], pledges: [], passes: [], reservations: [], events: [],
          activity: [{ id: 1, type: 'application', action: 'deleted', summary: 'private', ref_id: 9, created_at: '2026-01-01 00:00:00' }],
          seq: 2, meta: {},
        }));
        const auditScript = `const { store } = require(${JSON.stringify(require.resolve('./db'))}); process.stdout.write(JSON.stringify(store.snapshot()));`;
        const auditRestart = spawnSync(process.execPath, ['-e', auditScript], {
          encoding: 'utf8',
          env: { ...process.env, DB_PATH: auditOnlyPath, SEED_DEMO: '1' },
        });
        assert.equal(auditRestart.status, 0, auditRestart.stderr);
        const auditOnly = JSON.parse(auditRestart.stdout);
        assert.deepEqual(auditOnly.applications, []);
        assert.equal(auditOnly.activity.length, 1);
        assert.notEqual(auditOnly.meta.demo, true);
      } finally {
        fs.rmSync(auditOnlyPath, { force: true });
        fs.rmSync(`${auditOnlyPath}.tmp`, { force: true });
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const file of [dbPath, `${dbPath}.tmp`]) {
      try { fs.rmSync(file, { force: true }); } catch { /* best-effort cleanup */ }
    }
  }
});
