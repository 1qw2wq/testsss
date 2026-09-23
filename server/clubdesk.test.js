'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const file of [dbPath, `${dbPath}.tmp`]) {
      try { fs.rmSync(file, { force: true }); } catch { /* best-effort cleanup */ }
    }
  }
});
