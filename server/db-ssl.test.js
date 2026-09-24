'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

process.env.DB_PATH = path.join(os.tmpdir(), `hiworld-club-ssl-test-${process.pid}.json`);
process.env.SEED_DEMO = '0';
delete process.env.DATABASE_URL;
delete process.env.VERCEL;

const { Client } = require('pg');
const { postgresConnectionConfig } = require('./db');
const connectionString = 'postgresql://club:test-password@db.example.com:6543/postgres';

test('sslmode=require retains certificate verification by default', () => {
  const config = postgresConnectionConfig(`${connectionString}?sslmode=require`, {});

  assert.equal(config.host, 'db.example.com');
  assert.equal(config.port, '6543');
  assert.deepEqual(config.ssl, {});
  assert.deepEqual(new Client(config).connectionParameters.ssl, {});
});

test('sslmode=require can retain strict verification with a supplied root CA', () => {
  const rootCa = '-----BEGIN CERTIFICATE-----\nexample-root\n-----END CERTIFICATE-----';
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

test('verify-full is not weakened by the DATABASE_SSL convenience flag', () => {
  const config = postgresConnectionConfig(`${connectionString}?sslmode=verify-full`, {
    DATABASE_SSL: '1',
  });

  assert.deepEqual(config.ssl, {});
});

test('DATABASE_SSL enables TLS when the connection URI has no SSL mode', () => {
  const config = postgresConnectionConfig(connectionString, { DATABASE_SSL: '1' });

  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});
