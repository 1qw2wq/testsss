'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');

process.env.DB_PATH = path.join(os.tmpdir(), `hiworld-club-ssl-test-${process.pid}.json`);
process.env.SEED_DEMO = '0';
delete process.env.DATABASE_URL;
delete process.env.VERCEL;

const { Client } = require('pg');
const { postgresConnectionConfig } = require('./db');
const connectionString = 'postgresql://club:test-password@db.example.com:6543/postgres';

/* ---------------- unit tests: configuration matrix ---------------- */

test('sslmode=require follows libpq semantics: encrypted TLS without certificate verification', () => {
  const config = postgresConnectionConfig(`${connectionString}?sslmode=require`, {});

  assert.equal(config.host, 'db.example.com');
  assert.equal(config.port, '6543');
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test('sslmode=require can retain strict verification with a supplied root CA', () => {
  const rootCa = '-----BEGIN CERTIFICATE-----\\nexample-root\\n-----END CERTIFICATE-----';
  const config = postgresConnectionConfig(`${connectionString}?sslmode=require`, {
    DATABASE_SSL_CA: rootCa,
  });

  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.ca, rootCa.replace(/\\n/g, '\n'));
});

test('an explicit verification setting keeps certificate checks enabled', () => {
  const config = postgresConnectionConfig(`${connectionString}?sslmode=require`, {
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
  });

  assert.equal(config.ssl.rejectUnauthorized, true);
});

test('explicitly allowing an unverified server still keeps TLS enabled', () => {
  const config = postgresConnectionConfig(`${connectionString}?sslmode=require`, {
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test('sslmode=verify-full requests certificate verification', () => {
  const config = postgresConnectionConfig(`${connectionString}?sslmode=verify-full`, {});

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test('verify-full is not weakened by the DATABASE_SSL convenience flag', () => {
  const config = postgresConnectionConfig(`${connectionString}?sslmode=verify-full`, {
    DATABASE_SSL: '1',
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test('DATABASE_SSL enables TLS when the connection URI has no SSL mode', () => {
  const config = postgresConnectionConfig(connectionString, { DATABASE_SSL: '1' });

  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test('?ssl=true in the URI is treated as encrypted-but-unverified TLS', () => {
  const config = postgresConnectionConfig(`${connectionString}?ssl=true`, {});

  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test('sslmode=prefer and sslmode=allow also connect with encrypted, unverified TLS', () => {
  for (const sslmode of ['prefer', 'allow']) {
    const config = postgresConnectionConfig(`${connectionString}?sslmode=${sslmode}`, {});
    assert.deepEqual(config.ssl, { rejectUnauthorized: false }, `sslmode=${sslmode}`);
  }
});

test('sslmode=disable keeps TLS off, even with the DATABASE_SSL convenience flag', () => {
  const config = postgresConnectionConfig(`${connectionString}?sslmode=disable`, {
    DATABASE_SSL: '1',
  });

  assert.equal(config.ssl, false);
});

test('uselibpqcompat is still honoured for sslmode=require', () => {
  const config = postgresConnectionConfig(`${connectionString}?sslmode=require&uselibpqcompat=true`, {});

  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

/* ---------------- test fixtures: private-CA PostgreSQL server ---------------- */
// A local fake PostgreSQL answers the SSLRequest handshake and presents a certificate
// chained to a self-signed test root CA — the same shape as providers such as
// Supabase whose poolers are signed by private CAs. It implements just enough of the
// wire protocol (startup, simple + extended queries, the club-state JSONB row) for the
// real store to bootstrap and mutate against it. Tests are skipped when openssl (used
// to mint throwaway certificates) is unavailable.

const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiworld-ssl-certs-'));

function generateTestCertificates() {
  const caKey = path.join(certDir, 'ca.key');
  const caCert = path.join(certDir, 'ca.crt');
  const otherCaKey = path.join(certDir, 'other-ca.key');
  const otherCaCert = path.join(certDir, 'other-ca.crt');
  const leafKey = path.join(certDir, 'leaf.key');
  const leafCsr = path.join(certDir, 'leaf.csr');
  const leafCert = path.join(certDir, 'leaf.crt');
  const run = (args) => execFileSync('openssl', args, { cwd: certDir, stdio: 'ignore' });
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', caCert,
    '-days', '1', '-subj', '/CN=Hi World Club Test CA']);
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', otherCaKey, '-out', otherCaCert,
    '-days', '1', '-subj', '/CN=Some Other Test CA']);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', leafKey, '-out', leafCsr,
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
  run(['x509', '-req', '-in', leafCsr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial',
    '-out', leafCert, '-days', '1']);
  return {
    key: fs.readFileSync(leafKey, 'utf8'),
    cert: `${fs.readFileSync(leafCert, 'utf8')}\n${fs.readFileSync(caCert, 'utf8')}`,
    ca: fs.readFileSync(caCert, 'utf8'),
    otherCa: fs.readFileSync(otherCaCert, 'utf8'),
  };
}

const message = (type, body = Buffer.alloc(0)) => {
  const out = Buffer.alloc(5 + body.length);
  out[0] = type.charCodeAt(0);
  out.writeUInt32BE(body.length + 4, 1);
  body.copy(out, 5);
  return out;
};
const uint32 = (value) => {
  const body = Buffer.alloc(4);
  body.writeUInt32BE(value);
  return body;
};
const tag = (text) => Buffer.from(`${text}\0`);
const idle = Buffer.from('I');
const readCStringAt = (buffer, offset) => {
  const end = buffer.indexOf(0, offset);
  return buffer.toString('utf8', offset, end < 0 ? buffer.length : end);
};
const rowDescription = (fieldName) => {
  const name = Buffer.from(`${fieldName}\0`);
  const body = Buffer.alloc(2 + name.length + 18);
  let offset = 0;
  body.writeInt16BE(1, offset); offset += 2;
  name.copy(body, offset); offset += name.length;
  body.writeUInt32BE(0, offset); offset += 4; // table oid
  body.writeInt16BE(0, offset); offset += 2; // attribute number
  body.writeUInt32BE(3802, offset); offset += 4; // jsonb
  body.writeInt16BE(-1, offset); offset += 2; // type length
  body.writeInt32BE(-1, offset); offset += 4; // type modifier
  body.writeInt16BE(0, offset); // text format
  return message('T', body);
};
const dataRow = (jsonText) => {
  const value = Buffer.from(jsonText);
  const body = Buffer.alloc(6 + value.length);
  body.writeInt16BE(1, 0);
  body.writeInt32BE(value.length, 2);
  value.copy(body, 6);
  return message('D', body);
};
const errorResponse = (text) => message('E', Buffer.concat([
  Buffer.from('S'), tag('ERROR'),
  Buffer.from('C'), tag('XX000'),
  Buffer.from('M'), tag(text),
  Buffer.from('\0'),
]));

function attachProtocol(stream, state) {
  let buffer = Buffer.alloc(0);
  let sawStartup = false;
  const statements = new Map();
  const portals = new Map();
  const send = (...messages) => {
    if (!stream.destroyed) stream.write(Buffer.concat(messages));
  };
  const selectRows = () => (state.json == null ? [] : [dataRow(state.json)]);

  const handleSimpleQuery = (sql) => {
    if (/^create table/i.test(sql)) return send(message('C', tag('CREATE TABLE')), message('Z', idle));
    if (/^begin/i.test(sql)) return send(message('C', tag('BEGIN')), message('Z', idle));
    if (/^commit/i.test(sql)) return send(message('C', tag('COMMIT')), message('Z', idle));
    if (/^rollback/i.test(sql)) return send(message('C', tag('ROLLBACK')), message('Z', idle));
    if (/^select state from/i.test(sql)) {
      const rows = selectRows();
      return send(rowDescription('state'), ...rows, message('C', tag(`SELECT ${rows.length}`)), message('Z', idle));
    }
    return send(errorResponse(`unexpected simple query: ${sql}`), message('Z', idle));
  };

  stream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (!sawStartup) {
        if (buffer.length < 4) break;
        const length = buffer.readUInt32BE(0);
        if (buffer.length < length) break;
        buffer = buffer.subarray(length);
        sawStartup = true;
        send(message('R', uint32(0)), message('Z', idle)); // AuthenticationOk + ReadyForQuery
        continue;
      }
      if (buffer.length < 5) break;
      const type = String.fromCharCode(buffer[0]);
      const length = buffer.readUInt32BE(1);
      if (buffer.length < 1 + length) break;
      const body = buffer.subarray(5, 1 + length);
      buffer = buffer.subarray(1 + length);

      switch (type) {
        case 'Q': { // simple query
          handleSimpleQuery(readCStringAt(body, 0));
          break;
        }
        case 'P': { // parse (unnamed statements only arrive here)
          const name = readCStringAt(body, 0);
          const sql = readCStringAt(body, name.length + 1);
          statements.set(name, sql);
          send(message('1')); // ParseComplete
          break;
        }
        case 'B': { // bind
          let offset = 0;
          const portal = readCStringAt(body, offset); offset += portal.length + 1;
          const statement = readCStringAt(body, offset); offset += statement.length + 1;
          const formatCount = body.readInt16BE(offset); offset += 2 + 2 * formatCount;
          const paramCount = body.readInt16BE(offset); offset += 2;
          const params = [];
          for (let index = 0; index < paramCount; index++) {
            const paramLength = body.readInt32BE(offset); offset += 4;
            params.push(paramLength < 0 ? null : body.subarray(offset, offset + paramLength).toString('utf8'));
            offset += Math.max(0, paramLength);
          }
          portals.set(portal, { sql: statements.get(statement) || '', params });
          send(message('2')); // BindComplete
          break;
        }
        case 'D': { // describe
          const kind = String.fromCharCode(body[0]);
          const name = readCStringAt(body, 1);
          const described = kind === 'P' ? portals.get(name) : { sql: statements.get(name) };
          send(/^\s*select/i.test(described?.sql || '') ? rowDescription('state') : message('n'));
          break;
        }
        case 'E': { // execute
          const portal = readCStringAt(body, 0);
          const { sql, params } = portals.get(portal) || {};
          if (/^insert into/i.test(sql || '')) {
            state.json = params[0];
            send(message('C', tag('INSERT 0 1')));
          } else if (/^update/i.test(sql || '')) {
            state.json = params[0];
            send(message('C', tag('UPDATE 1')));
          } else if (/^select state from/i.test(sql || '')) {
            const rows = selectRows();
            send(rowDescription('state'), ...rows, message('C', tag(`SELECT ${rows.length}`)));
          } else {
            send(errorResponse(`unexpected execute: ${sql}`));
          }
          break;
        }
        case 'S': send(message('Z', idle)); break; // sync
        case 'X': stream.end(); break; // terminate
        default: send(errorResponse(`unexpected message type ${type}`), message('Z', idle));
      }
    }
  });
}

// Each server instance keeps its own "database" (club state as JSON text), so every
// store test bootstraps from a clean slate.
function startFakePostgresTlsServer({ key, cert }) {
  const secureContext = tls.createSecureContext({ key, cert });
  const state = { json: null };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.once('data', (buffer) => {
      // First packet must be an SSLRequest (length 8, code 80877103); agree and upgrade.
      if (buffer.length < 8 || buffer.readUInt32BE(4) !== 80877103) {
        socket.destroy();
        return;
      }
      socket.write('S');
      const secure = new tls.TLSSocket(socket, { isServer: true, secureContext });
      secure.on('error', () => {});
      attachProtocol(secure, state);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: (query) => `postgresql://club:test-password@127.0.0.1:${server.address().port}/postgres?${query}`,
    destroy: () => {
      server.closeAllConnections?.();
      for (const socket of sockets) socket.destroy();
      return new Promise((closed) => server.close(closed));
    },
  })));
}

let certificates = null;
let sharedServer = null;

before(async () => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    certificates = generateTestCertificates();
    sharedServer = await startFakePostgresTlsServer(certificates);
  } catch {
    certificates = null; // openssl unavailable — end-to-end tests skip below.
  }
});

after(async () => {
  if (sharedServer) await sharedServer.destroy();
  fs.rmSync(certDir, { recursive: true, force: true });
});

async function connectClient(url, env) {
  const config = postgresConnectionConfig(url, env);
  const client = new Client({ ...config, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

/* ---------------- end-to-end: pg client against the private-CA server ---------------- */

test('end-to-end: sslmode=require connects through a private certificate authority', { timeout: 15000, skip: !certificates && 'openssl is not available' }, async () => {
  const client = await connectClient(sharedServer.url('sslmode=require'), {});
  await client.end();
});

test('end-to-end: sslmode=verify-full still rejects the untrusted chain', { timeout: 15000, skip: !certificates && 'openssl is not available' }, async () => {
  await assert.rejects(
    connectClient(sharedServer.url('sslmode=verify-full'), {}),
    (error) => {
      assert.equal(error.code, 'SELF_SIGNED_CERT_IN_CHAIN');
      return true;
    },
  );
});

test('end-to-end: a supplied root CA verifies and connects with strict TLS', { timeout: 15000, skip: !certificates && 'openssl is not available' }, async () => {
  const client = await connectClient(sharedServer.url('sslmode=require'), {
    DATABASE_SSL_CA: certificates.ca,
  });
  await client.end();
});

/* ---------------- end-to-end: the real store bootstrapped over TLS ---------------- */
// Each scenario runs db.js in a child process with DATABASE_URL pointed at a fresh
// fake private-CA server, waits for initialization, writes a pledge, and reports status.
// The child runs asynchronously so the parent can keep serving the database protocol.

const storeScript = `
  const { stmts, store } = require(process.argv[1]);
  const finish = (payload) => process.stdout.write(JSON.stringify(payload), () => process.exit(0));
  (async () => {
    await store.ready;
    const info = await stmts.insertPledge.run({ name: 'TLS Test', genre: 'Classics', qty: 3 });
    await store.refresh();
    finish({
      ok: true,
      status: store.storageStatus(),
      pledgeId: info.lastInsertRowid,
      pledges: store.snapshot().pledges.length,
    });
  })().catch((error) => {
    finish({ ok: false, code: error.code || null, message: error.message });
  });
`;

function runStoreProcess(databaseUrl, envOverrides = {}) {
  const dbPath = path.join(os.tmpdir(),
    `hiworld-club-store-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', storeScript, path.join(__dirname, 'db.js')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DB_PATH: dbPath,
        SEED_DEMO: '0',
        PGPOOL_MAX: '2',
        ADMIN_TOKEN: 'test-token',
        ...envOverrides,
      },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: 'TEST_PROCESS_FAILED', message: String(error) });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: false, code: 'TEST_PROCESS_FAILED', message: `${stderr}\n${stdout}`.slice(0, 500) });
      }
    });
  });
}

async function withStoreServer(query, envOverrides, run) {
  const server = await startFakePostgresTlsServer(certificates);
  try {
    return await runStoreProcess(server.url(query), envOverrides);
  } finally {
    await server.destroy();
  }
}

test('store: sslmode=require initializes, writes, and reports encrypted-unverified TLS', { timeout: 60000, skip: !certificates && 'openssl is not available' }, async () => {
  const result = await withStoreServer('sslmode=require');

  assert.ok(result.ok, `store failed: ${result.message}`);
  assert.equal(result.status.storage, 'postgres');
  assert.equal(result.status.ready, true);
  assert.deepEqual(result.status.databaseTLS, { verification: 'encrypted-unverified', requestedBy: 'sslmode=require' });
  assert.ok(result.pledgeId >= 1);
  assert.equal(result.pledges, 1);
});

test('store: strict verification forced by env falls back to encrypted TLS and keeps serving', { timeout: 60000, skip: !certificates && 'openssl is not available' }, async () => {
  const result = await withStoreServer('sslmode=require', { DATABASE_SSL_REJECT_UNAUTHORIZED: 'true' });

  assert.ok(result.ok, `store failed: ${result.message}`);
  assert.equal(result.status.storage, 'postgres');
  assert.equal(result.status.ready, true);
  assert.deepEqual(result.status.databaseTLS, {
    verification: 'encrypted-unverified',
    requestedBy: 'DATABASE_SSL_REJECT_UNAUTHORIZED=true',
    fallbackFrom: 'DATABASE_SSL_REJECT_UNAUTHORIZED=true',
  });
  assert.equal(result.pledges, 1);
});

test('store: a correct DATABASE_SSL_CA keeps strict verification with no fallback', { timeout: 60000, skip: !certificates && 'openssl is not available' }, async () => {
  const result = await withStoreServer('sslmode=require', { DATABASE_SSL_CA: certificates.ca });

  assert.ok(result.ok, `store failed: ${result.message}`);
  assert.equal(result.status.storage, 'postgres');
  assert.deepEqual(result.status.databaseTLS, { verification: 'verified', requestedBy: 'DATABASE_SSL_CA' });
  assert.equal(result.pledges, 1);
});

test('store: a mismatched DATABASE_SSL_CA falls back and discloses it', { timeout: 60000, skip: !certificates && 'openssl is not available' }, async () => {
  const result = await withStoreServer('sslmode=require', { DATABASE_SSL_CA: certificates.otherCa });

  assert.ok(result.ok, `store failed: ${result.message}`);
  assert.equal(result.status.storage, 'postgres');
  assert.equal(result.status.ready, true);
  assert.deepEqual(result.status.databaseTLS, {
    verification: 'encrypted-unverified',
    requestedBy: 'DATABASE_SSL_CA',
    fallbackFrom: 'DATABASE_SSL_CA',
  });
  assert.equal(result.pledges, 1);
});

test('store: sslmode=verify-full against a private CA falls back and discloses it', { timeout: 60000, skip: !certificates && 'openssl is not available' }, async () => {
  const result = await withStoreServer('sslmode=verify-full');

  assert.ok(result.ok, `store failed: ${result.message}`);
  assert.equal(result.status.storage, 'postgres');
  assert.equal(result.status.ready, true);
  assert.deepEqual(result.status.databaseTLS, {
    verification: 'encrypted-unverified',
    requestedBy: 'sslmode=verify-full',
    fallbackFrom: 'sslmode=verify-full',
  });
  assert.equal(result.pledges, 1);
});
