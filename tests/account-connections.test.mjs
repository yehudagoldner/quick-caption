import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { browserLabel, connectionBinding, connectionRevoked, createConnectionIdentityVerifier } from '../src/accountConnections.js';
import { createConnectionsRouter } from '../routes/connections.js';
import { createIdentityMiddleware } from '../src/firebaseIdentity.js';
import { createVideoTokens } from '../src/videoTokens.js';
import clientModule from '../premiere-plugin/client.js';

test('connection labels expose browser/system rather than arbitrary user-agent text', () => {
  assert.equal(browserLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/150.0 Edg/150.0'), 'Edge · Windows');
  assert.equal(browserLabel('Mozilla iPhone AppleWebKit Safari/604.1'), 'Safari · iPhone / iPad');
  assert.equal(browserLabel('<script>'), 'דפדפן');
});

test('authenticated connections router ignores supplied ownership and distinguishes current disconnect', async t => {
  const owner = { uid: 'owner', authTime: 1800000000, browserConnectionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
  const calls = [];
  const app = express(); app.use(express.json());
  const store = {
    list: async (...args) => { calls.push(['list', ...args]); return [{ id: owner.browserConnectionId, current: true }]; },
    revoke: async (...args) => calls.push(['revoke', ...args]),
    revokeAll: async (...args) => calls.push(['all', ...args]),
  };
  app.use((req, res, next) => { req.identity = req.headers.authorization === 'plugin' ? { uid: 'owner', pluginSessionId: 'p' } : owner; next(); });
  app.use('/api/connections', createConnectionsRouter({ store }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/connections`;
  const request = (path = '', authorization = 'web') => fetch(url + path, { method: path ? 'POST' : 'GET', headers: { authorization, 'Content-Type': 'application/json' }, ...(path ? { body: JSON.stringify({ userUid: 'victim' }) } : {}) });
  const list = await request(); assert.match(list.headers.get('cache-control'), /no-store/);
  assert.equal((await list.json()).connections[0].current, true);
  assert.equal((await (await request(`/${owner.browserConnectionId}/revoke`)).json()).disconnectedCurrent, true);
  assert.equal((await (await request('/another/revoke')).json()).disconnectedCurrent, false);
  assert.equal((await (await request('/revoke-all')).json()).disconnectedCurrent, true);
  assert.equal((await request('', 'plugin')).status, 403);
  assert.deepEqual(calls, [['list', 'owner', owner.browserConnectionId], ['revoke', 'owner', owner.browserConnectionId], ['revoke', 'owner', 'another'], ['all', 'owner']]);
});

test('identity guard checks verified login time, signals remote revocation and fails closed on database outage', async t => {
  let fail = false;
  const verifier = createConnectionIdentityVerifier(async token => ({ uid: token, authTime: 123 }), {
    browser: async identity => { assert.equal(identity.authTime, 123); if (fail) throw new Error('database credentials must not leak'); throw connectionRevoked(); },
  });
  const app = express(); app.use(createIdentityMiddleware(verifier)); app.get('/', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = () => fetch(`http://127.0.0.1:${server.address().port}`, { headers: { authorization: 'Bearer owner' } });
  const revoked = await request(); assert.equal(revoked.status, 401); assert.equal((await revoked.json()).code, 'CONNECTION_REVOKED');
  fail = true; const outage = await request(); assert.equal(outage.status, 503); assert.doesNotMatch(JSON.stringify(await outage.json()), /credentials/);
});

test('media grants carry a signed connection binding', () => {
  const tokens = createVideoTokens('test-secret');
  const binding = connectionBinding({ browserConnectionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
  const grant = tokens.issue(1, 'owner', 'media', undefined, binding);
  assert.equal(tokens.verify(grant, 'media').connectionId, binding.connectionId);
  assert.equal(tokens.verify(grant, 'media').connectionKind, 'browser');
  assert.equal(tokens.verify(grant.replace('a', 'b'), 'media'), null);
});

test('Premiere clears a remotely revoked upload session without resubmitting paid work', async () => {
  let requests = 0;
  const data = new Map();
  const storage = { setItem: async (key, value) => data.set(key, value), getItem: async key => data.get(key), removeItem: async key => data.delete(key) };
  const client = new clientModule.PluginClient({ baseUrl: 'https://qa.invalid', storage, now: () => 1000, fetcher: async () => { requests++; return { status: 401, ok: false, json: async () => ({ code: 'CONNECTION_REVOKED', error: 'נותק' }) }; } });
  await client.accept({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900, user: { uid: 'owner' } });
  await assert.rejects(client.request('/api/transcribe', { method: 'POST' }, false));
  assert.equal(requests, 1); assert.equal(client.session, null); assert.equal(data.has('account'), false);
});
