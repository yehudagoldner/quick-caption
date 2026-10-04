import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAdminRouter } from '../routes/admin.js';
import { createAdminStore } from '../src/adminStore.js';
import { captureApiErrors, createClientErrorHandler, createErrorRecorder, redactErrorMessage } from '../src/errorMonitoring.js';

async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
const authenticate = (req, res, next) => {
  if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorized' });
  req.identity = { uid: 'uid-1', email: req.headers.authorization === 'Bearer admin' ? 'owner@example.com' : 'member@example.com', emailVerified: true };
  next();
};

test('error log endpoints enforce admin permissions and validate server-side pages', async t => {
  const calls = [];
  const app = express(); app.use(express.json());
  app.use('/api/admin', createAdminRouter({ authenticate, store: {
    isAdmin: async email => email === 'owner@example.com',
    errors: async (page, snapshot) => { calls.push([page, snapshot]); return { errors: [], total: 0, page, pageSize: 50, snapshot: 123 }; },
  } }));
  const base = await serve(t, app);
  const get = (query = '', token = 'admin') => fetch(`${base}/api/admin/errors${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await get('', null)).status, 401);
  assert.equal((await get('', 'member')).status, 403);
  for (const query of ['?page=-1', '?page=1.5', '?page=100001', '?snapshot=abc', '?snapshot=-1']) {
    assert.equal((await get(query)).status, 400);
  }
  const response = await get('?page=2&snapshot=123&limit=99999');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pageSize, 50);
  assert.deepEqual(calls, [[2, 123]]);
});

test('storage selects only 50 rows and keeps the pagination snapshot stable', async () => {
  const calls = [];
  const rows = Array.from({ length: 55 }, (_, index) => ({ id: 55 - index }));
  const store = createAdminStore({ execute: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('MAX(sequence)')) return [[{ snapshot: 55 }]];
    if (sql.includes('COUNT(*)')) return [[{ total: 55 }]];
    const offset = Number(sql.match(/OFFSET (\d+)/)[1]);
    assert.match(sql, /LIMIT 50 OFFSET/);
    return [rows.filter(row => row.id <= params[0]).slice(offset, offset + 50)];
  } });
  const first = await store.errors(0);
  rows.unshift({ id: 56 });
  const next = await store.errors(1, first.snapshot);
  assert.equal(first.errors.length, 50);
  assert.equal(next.errors.length, 5);
  assert.equal(next.errors[0].id, 5);
  assert.equal(next.snapshot, 55);
  assert.equal(calls.filter(call => call.sql.includes('MAX(sequence)')).length, 1);
  assert.deepEqual(calls.find(call => call.sql.includes('OFFSET 50')).params, [55]);
});

test('server failures capture metadata without request bodies, query tokens or credentials', async t => {
  const entries = [];
  const app = express(); app.use(captureApiErrors({ record: entry => entries.push(entry) }));
  app.use(express.json()); app.use(authenticate);
  app.put('/api/videos/5/subtitles', (req, res) => res.status(500).json({ error: 'Database unavailable' }));
  const base = await serve(t, app);
  const response = await fetch(`${base}/api/videos/5/subtitles?token=secret-query`, { method: 'PUT',
    headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ subtitleJson: 'private caption text' }) });
  await response.text();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].operation, '/api/videos/5/subtitles');
  assert.equal(entries[0].userUid, 'uid-1');
  assert.equal(entries[0].status, 500);
  assert.equal(entries[0].requestId, response.headers.get('X-Request-Id'));
  assert.doesNotMatch(JSON.stringify(entries), /secret-query|private caption|Bearer/);
  assert.equal(redactErrorMessage('Bearer hidden token=secret sk-test-private'), 'Bearer [REDACTED] token=[REDACTED] [REDACTED]');
});

test('client reports ignore arbitrary text and ownership, and rate-limit repeated reports', async t => {
  const entries = [];
  const app = express(); app.use(express.json()); app.use(authenticate);
  app.post('/api/client-errors', createClientErrorHandler({ record: entry => entries.push(entry) }));
  const base = await serve(t, app);
  const body = { eventId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', code: 'upload-invalid-response', status: 502,
    userUid: 'another-user', message: 'sensitive text' };
  const post = data => fetch(`${base}/api/client-errors`, { method: 'POST', headers: { Authorization: 'Bearer member', 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await post({ ...body, code: 'arbitrary' })).status, 400);
  for (let i = 0; i < 20; i++) assert.equal((await post(body)).status, 202);
  assert.equal((await post(body)).status, 429);
  assert.equal(entries[0].userUid, 'uid-1');
  assert.doesNotMatch(JSON.stringify(entries), /sensitive text|another-user/);
});

test('logging retries a transient DB failure without blocking or duplicating the response', async t => {
  let attempts = 0;
  const entries = [];
  const recorder = createErrorRecorder({ recordError: async entry => {
    if (++attempts === 1) throw new Error('DB disconnected');
    entries.push(entry);
  } }, { retryMs: 10 });
  t.after(() => recorder.close());
  recorder.record({ source: 'server', operation: 'save', message: 'token=private', status: 500 });
  await new Promise(resolve => setTimeout(resolve, 40));
  recorder.record({ source: 'server', operation: 'upload', message: 'failure', status: 502 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].message, 'token=[REDACTED]');
  assert.notEqual(entries[0].id, entries[1].id);
});
