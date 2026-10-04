import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { ADMIN_TABLES, createAdminStore } from '../src/adminStore.js';

test('MySQL paginates error history in 50-row snapshots and deduplicates browser retries',
  { skip: process.env.RUN_MYSQL_TESTS !== '1' }, async t => {
    await import('../src/loadAppEnv.js');
    const db = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 10000 });
    t.after(() => db.end());
    // A connection-local table shadows the real table; customer logs are untouched.
    const sql = ADMIN_TABLES.find(sql => sql.includes('application_errors'));
    await db.execute(sql.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE'));
    const rows = Array.from({ length: 105 }, () => [randomUUID(), 'server', '/api/transcribe', 'Test failure',
      500, 'POST', 'test-only-user', randomUUID(), new Date()]);
    await db.query(`INSERT INTO application_errors (event_id, source, operation, message, http_status,
      http_method, user_uid, request_id, created_at) VALUES ?`, [rows]);
    const store = createAdminStore(db);
    const first = await store.errors(0);
    assert.equal(first.errors.length, 50); assert.equal(first.total, 105);
    assert.equal(first.errors[0].id, 105);
    const entry = { id: randomUUID(), source: 'client', operation: 'upload', message: 'Invalid response',
      status: 502, userUid: 'test-only-user', createdAt: new Date() };
    await store.recordError(entry); await store.recordError(entry);
    const second = await store.errors(1, first.snapshot);
    const third = await store.errors(2, first.snapshot);
    assert.equal(second.errors.length, 50); assert.equal(third.errors.length, 5);
    assert.equal(second.errors[0].id, 55); assert.equal(third.errors[0].id, 5);
    assert.equal(new Set([...first.errors, ...second.errors, ...third.errors].map(row => row.id)).size, 105);
    const refreshed = await store.errors(0);
    assert.equal(refreshed.total, 106); assert.equal(refreshed.errors[0].source, 'client');
  });
