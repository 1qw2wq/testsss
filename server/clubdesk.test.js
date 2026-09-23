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
      assert.ok(cleared.data.cleared.activity >= 20);

      for (const collection of ['applications', 'pledges', 'passes', 'reservations']) {
        const list = await request(base, `/api/admin/${collection}`, { admin: true });
        assert.equal(list.data.total, 0, `${collection} should be empty after clearing`);
      }
      assert.equal((await request(base, '/api/admin/activity', { admin: true })).data.total, 0);
      assert.deepEqual((await request(base, '/api/public/activity')).data.activity, []);
      assert.deepEqual((await request(base, '/api/pledges?limit=50')).data.pledges, []);
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
      assert.deepEqual(persisted.activity, []);
      assert.equal(persisted.meta.suppressDemoSeed, true);

      // Deleting every record one-by-one leaves audit history; that is not a
      // truly empty store and should not trigger demo seeding either.
      const auditOnlyPath = `${dbPath}.audit-only.json`;
      try {
        fs.writeFileSync(auditOnlyPath, JSON.stringify({
          applications: [], pledges: [], passes: [], reservations: [],
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
