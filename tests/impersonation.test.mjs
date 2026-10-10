import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createImpersonationSessions } from '../src/impersonation.js';
import { createAdminRouter } from '../routes/admin.js';
import { connectionBinding } from '../src/accountConnections.js';
import { createVideoTokens } from '../src/videoTokens.js';

function fixture() {
  let time = 1000, admin = true;
  const audit = [];
  const actor = { uid: 'owner', email: 'owner@example.com', emailVerified: true, browserConnectionId: 'owner-login' };
  const user = { uid: 'member', email: 'member@example.com', displayName: 'Member', emailVerified: false };
  const store = { isAdmin: async email => admin && email === actor.email,
    impersonationUser: async uid => uid === user.uid ? { ...user } : null,
    auditImpersonation: async (...args) => audit.push(args) };
  return { actor, user, store, audit, sessions: createImpersonationSessions(store, () => time),
    expire: () => { time += 3600000; }, revoke: () => { admin = false; } };
}

test('impersonation requires verified admin login, existing target and audited entry/exit', async () => {
  const f = fixture();
  for (const actor of [{ ...f.actor, emailVerified: false }, { ...f.actor, email: 'member@example.com' }, { ...f.actor, browserConnectionId: undefined }]) {
    await assert.rejects(f.sessions.start(actor, 'member'), { status: 403 });
  }
  await assert.rejects(f.sessions.start(f.actor, 'missing'), { status: 404 });
  await assert.rejects(f.sessions.start(f.actor, 'owner'), { status: 400 });
  const session = await f.sessions.start(f.actor, 'member');
  assert.deepEqual(session.user, f.user);
  assert.equal(f.audit.length, 1);
  assert.equal(f.audit[0][1], 'impersonation-start');
  for (const actor of [{ ...f.actor, uid: 'attacker' }, { ...f.actor, browserConnectionId: 'different-login' }]) {
    await assert.rejects(f.sessions.profile(session.token, actor), { code: 'IMPERSONATION_EXPIRED' });
  }
  await assert.rejects(f.sessions.profile('forged', f.actor), { code: 'IMPERSONATION_EXPIRED' });
  await f.sessions.stop(session.token, { ...f.actor, uid: 'attacker' });
  assert.equal((await f.sessions.profile(session.token, f.actor)).user.uid, 'member');
  await f.sessions.stop(session.token, f.actor);
  await assert.rejects(f.sessions.profile(session.token, f.actor), { code: 'IMPERSONATION_EXPIRED' });
  assert.equal(f.audit[1][1], 'impersonation-stop');
});

test('expiry and revoked administrator privileges terminate effective access', async () => {
  for (const mode of ['expire', 'revoke']) {
    const f = fixture(); const { token } = await f.sessions.start(f.actor, 'member');
    f[mode]();
    await assert.rejects(f.sessions.profile(token, f.actor), { status: 403 });
    await f.sessions.stop(token, f.actor);
    assert.equal(f.audit.length, 2);
  }
});

test('signed media grants bind to admin login and end with impersonation', async () => {
  const f = fixture(); const { token } = await f.sessions.start(f.actor, 'member');
  const signed = createVideoTokens('test-key');
  const grant = signed.verify(signed.issue(1, 'member', 'media', undefined,
    connectionBinding({ ...f.user, browserConnectionId: f.actor.browserConnectionId, impersonationId: token })), 'media');
  const connections = { grantActive: async value => value.userUid === 'owner' && value.connectionId === 'owner-login' };
  assert.equal(await f.sessions.grantActive(grant, connections), true);
  assert.equal(await f.sessions.grantActive({ ...grant, userUid: 'another' }, connections), false);
  assert.equal(await f.sessions.grantActive(grant, { grantActive: async () => false }), false);
  f.revoke();
  assert.equal(await f.sessions.grantActive(grant, connections), false);
  await f.sessions.stop(token, f.actor);
  assert.equal(await f.sessions.grantActive(grant, connections), false);
});

test('HTTP APIs scope target ownership and prevent admin, account linking and connection changes', async t => {
  const f = fixture();
  const authenticate = (req, res, next) => {
    if (!req.headers.authorization) return res.sendStatus(401);
    req.identity = req.headers.authorization === 'owner' ? { ...f.actor } : { ...f.user, browserConnectionId: 'member-login' };
    next();
  };
  const app = express(); app.use(express.json());
  app.use('/api/admin', createAdminRouter({ authenticate, store: f.store, impersonations: f.sessions }));
  app.use('/api', authenticate, f.sessions.apply);
  app.use('/api', (req, res) => res.json({ uid: req.identity.uid, actor: req.actorIdentity?.uid }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path, { authorization = 'owner', token, body, method } = {}) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method: method ?? (body ? 'POST' : 'GET'), headers: { authorization, 'Content-Type': 'application/json', ...(token ? { 'X-Quick-Caption-Impersonation': token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  assert.equal((await request('/admin/impersonation/start', { authorization: 'member', body: { userUid: 'member' } })).status, 403);
  assert.equal((await request('/admin/impersonation/start', { body: { userUid: {} } })).status, 400);
  const start = await request('/admin/impersonation/start', { body: { userUid: 'member' } });
  assert.equal(start.status, 200); const { token } = await start.json();
  assert.deepEqual(await (await request('/videos?userUid=attacker', { token })).json(), { uid: 'member', actor: 'owner' });
  assert.equal((await request('/videos', { token, authorization: 'member' })).status, 403);
  assert.deepEqual(await (await request('/admin/session', { token })).json(), { isAdmin: false });
  for (const path of ['/admin/users', '/plugin/link/approve', '/payments/orders', '/users/sync', '/connections/revoke-all']) {
    assert.equal((await request(path, { token, body: { userUid: 'attacker' } })).status, 403, path);
  }
  assert.equal((await request('/connections', { token })).status, 200);
  assert.equal((await request('/videos/1/subtitles', { token, method: 'PUT', body: { userUid: 'attacker' } })).status, 200);
  assert.equal((await request('/admin/impersonation/stop', { body: { token } })).status, 200);
  assert.equal((await request('/videos', { token })).status, 403);
  assert.deepEqual(await (await request('/videos')).json(), { uid: 'owner' });
});
