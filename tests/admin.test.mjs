import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createFirebaseVerifier, createIdentityMiddleware } from '../src/firebaseIdentity.js';
import { createAdminRouter } from '../routes/admin.js';
import { priceUsage, configureUsageRecorder, instrumentOpenAI, usageContext } from '../src/aiUsage.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = 1800000000000;
const claims = { sub: 'owner-id', aud: 'caption-project', iss: 'https://securetoken.google.com/caption-project',
  exp: now / 1000 + 600, iat: now / 1000 - 30, auth_time: now / 1000 - 30,
  email: 'goldnery@gmail.com', email_verified: true };
function token(payload = claims, header = { alg: 'RS256', kid: 'test-key' }) {
  const content = [header, payload].map(item => Buffer.from(JSON.stringify(item)).toString('base64url')).join('.');
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}
const verifier = () => createFirebaseVerifier({ projectId: 'caption-project', now: () => now, fetchImpl: async () => ({
  ok: true, headers: new Headers({ 'cache-control': 'max-age=3600' }), json: async () => ({ 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) }),
}) });

test('Firebase identity rejects forged, expired and other-project tokens', async () => {
  const verify = verifier();
  assert.equal((await verify(token())).email, 'goldnery@gmail.com');
  for (const payload of [{ ...claims, exp: now / 1000 }, { ...claims, aud: 'other-project' }, { ...claims, iss: 'attacker' }, { ...claims, sub: '' }]) {
    await assert.rejects(verify(token(payload)));
  }
  await assert.rejects(verify(token(claims, { alg: 'none', kid: 'test-key' })));
  await assert.rejects(verify(`${token().slice(0, -8)}AAAAAAAA`));
});

test('admin APIs require verified owner/delegated identity, ignoring supplied email and uid', async t => {
  const calls = [];
  const app = express(); app.use(express.json());
  app.use('/api/admin', createAdminRouter({ authenticate: createIdentityMiddleware(verifier()), store: {
    isAdmin: async email => ['goldnery@gmail.com', 'delegate@example.com'].includes(email),
    overview: async () => ({ total: 123 }), users: async () => ({ users: [] }),
    grantCredits: async body => { calls.push(body); return { newBalance: 150 }; },
    grantAdmin: async body => calls.push(body),
  } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/admin`;
  const request = (path, identity, body) => fetch(`${url}${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(identity ? { Authorization: `Bearer ${token(identity)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await request('/overview')).status, 401);
  assert.equal((await request('/overview', { ...claims, email: 'member@example.com' })).status, 403);
  assert.equal((await request('/overview', { ...claims, email_verified: false })).status, 403);
  assert.equal((await request('/overview', claims)).status, 200);
  assert.equal((await request('/overview', { ...claims, email: 'delegate@example.com' })).status, 200);
  const body = { userUid: 'member', credits: 100, reason: 'support', requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'goldnery@gmail.com' };
  assert.equal((await request('/credits', { ...claims, email: 'member@example.com' }, body)).status, 403);
  for (const credits of [-1, 0, 1.5, '100', 1000001]) assert.equal((await request('/credits', claims, { ...body, credits })).status, 400);
  assert.equal((await request('/credits', claims, body)).status, 200);
  assert.equal(calls.length, 1); assert.equal(calls[0].actor, claims.email);
  assert.equal((await request('/users?page=0.5', claims)).status, 400);
  assert.equal((await request('/admins', claims, { email: 'bad', requestId: body.requestId })).status, 400);
});

test('costs preserve fractional cents, cache discounts, tiers, and missing prices', () => {
  const usage = { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 200 } };
  assert.equal(priceUsage({ model: 'gpt-6-luna', usage }).costUSD, 0.000132);
  assert.equal(priceUsage({ model: 'gpt-6-luna', usage, serviceTier: 'fast' }).costUSD, 0.000264);
  assert.ok(Math.abs(priceUsage({ model: 'whisper-1', audio: true, durationSeconds: 90 }).costUSD - 0.009) < 1e-12);
  assert.equal(priceUsage({ model: 'unknown', usage }).costUSD, null);
  assert.equal(priceUsage({ model: 'gpt-5', usage: null }).costUSD, null);
  assert.equal(priceUsage({ model: 'gpt-transcribe', audio: true, durationSeconds: null }).costUSD, null);
});

test('provider responses are recorded before parsing and failed calls are visibly unpriced', async t => {
  const recorded = []; configureUsageRecorder(async row => { recorded.push(row); });
  t.after(() => configureUsageRecorder(undefined));
  const resource = () => ({ create: async () => ({ usage: { input_tokens: 10, output_tokens: 20 }, output_text: 'invalid JSON' }) });
  const client = instrumentOpenAI({ responses: resource(), chat: { completions: resource() }, audio: { transcriptions: { create: async () => ({ text: 'hello' }) } } }, async () => 60);
  await new Promise((resolve, reject) => usageContext({ path: '/api/ai-edit-subtitles', body: { userUid: 'buyer' } }, null, () => {
    client.responses.create({ model: 'gpt-5' }).then(result => {
      assert.equal(result.output_text, 'invalid JSON'); assert.equal(recorded.length, 1); assert.equal(recorded[0].userUid, 'buyer'); resolve();
    }).catch(reject);
  }));
  await new Promise((resolve, reject) => usageContext({ path: '/api/transcribe', body: {} }, null, () => {
    client.audio.transcriptions.create({ model: 'gpt-transcribe', file: { path: 'fixture.mp3' } }).then(() => {
      assert.equal(recorded[1].durationSeconds, 60); assert.equal(recorded[1].costUSD, 0.0045); resolve();
    }).catch(reject);
  }));
  const failing = resource(); failing.create = async () => { throw new Error('provider failure'); };
  const bad = instrumentOpenAI({ responses: failing, chat: { completions: resource() }, audio: { transcriptions: resource() } }, async () => 0);
  await new Promise(resolve => usageContext({ path: '/api/transcribe', body: {} }, null, () => {
    assert.rejects(bad.responses.create({ model: 'gpt-5' }), /provider failure/).then(resolve);
  }));
  assert.equal(recorded[2].status, 'failed'); assert.equal(recorded[2].costUSD, null);
});
