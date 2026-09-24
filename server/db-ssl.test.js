'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
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

/* ---------------- end-to-end tests against a private-CA PostgreSQL ---------------- */
// A local fake PostgreSQL server answers the SSLRequest handshake and then presents
// a certificate chained to a self-signed test root CA — the same shape as providers
// such as Supabase whose poolers are signed by private CAs. Tests are skipped when
// openssl (used to mint throwaway certificates) is unavailable.

const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiworld-ssl-certs-'));

function generateTestCertificates() {
  const caKey = path.join(certDir, 'ca.key');
  const caCert = path.join(certDir, 'ca.crt');
  const leafKey = path.join(certDir, 'leaf.key');
  const leafCsr = path.join(certDir, 'leaf.csr');
  const leafCert = path.join(certDir, 'leaf.crt');
  const run = (args) => execFileSync('openssl', args, { cwd: certDir, stdio: 'ignore' });
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', caCert,
    '-days', '1', '-subj', '/CN=Hi World Club Test CA']);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', leafKey, '-out', leafCsr,
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
  run(['x509', '-req', '-in', leafCsr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial',
    '-out', leafCert, '-days', '1']);
  return {
    key: fs.readFileSync(leafKey, 'utf8'),
    cert: `${fs.readFileSync(leafCert, 'utf8')}\n${fs.readFileSync(caCert, 'utf8')}`,
    ca: fs.readFileSync(caCert, 'utf8'),
  };
}

function startFakePostgresTlsServer({ key, cert }) {
  const secureContext = tls.createSecureContext({ key, cert });
  const server = net.createServer((socket) => {
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
      let greeted = false;
      secure.on('data', () => {
        if (secure.destroyed) return;
        if (!greeted) {
          greeted = true;
          secure.write(Buffer.concat([
            Buffer.from([0x52, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]), // AuthenticationOk
            Buffer.from([0x5a, 0x00, 0x00, 0x00, 0x05, 0x49]), // ReadyForQuery (idle)
          ]));
        } else {
          secure.end(); // Terminate request — close politely.
        }
      });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let certificates = null;
let fakeServer = null;

before(async () => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    certificates = generateTestCertificates();
    fakeServer = await startFakePostgresTlsServer(certificates);
  } catch {
    certificates = null; // openssl unavailable — end-to-end tests skip below.
  }
});

after(async () => {
  if (fakeServer) {
    fakeServer.closeAllConnections?.();
    await new Promise((resolve) => fakeServer.close(resolve));
  }
  fs.rmSync(certDir, { recursive: true, force: true });
});

const fakeServerUrl = (query) => `postgresql://club:test-password@127.0.0.1:${fakeServer.address().port}/postgres?${query}`;

async function connectClient(url, env) {
  const config = postgresConnectionConfig(url, env);
  const client = new Client({ ...config, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

test('end-to-end: sslmode=require connects through a private certificate authority', { timeout: 15000, skip: !certificates && 'openssl is not available' }, async () => {
  const client = await connectClient(fakeServerUrl('sslmode=require'), {});
  await client.end();
});

test('end-to-end: sslmode=verify-full still rejects the untrusted chain', { timeout: 15000, skip: !certificates && 'openssl is not available' }, async () => {
  await assert.rejects(
    connectClient(fakeServerUrl('sslmode=verify-full'), {}),
    (error) => {
      assert.equal(error.code, 'SELF_SIGNED_CERT_IN_CHAIN');
      return true;
    },
  );
});

test('end-to-end: a supplied root CA verifies and connects with strict TLS', { timeout: 15000, skip: !certificates && 'openssl is not available' }, async () => {
  const client = await connectClient(fakeServerUrl('sslmode=require'), {
    DATABASE_SSL_CA: certificates.ca,
  });
  await client.end();
});
