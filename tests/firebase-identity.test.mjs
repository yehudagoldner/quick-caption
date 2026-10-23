import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createFirebaseVerifier } from '../src/firebaseIdentity.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = 1800000000000;
const claims = { sub: 'fixture-user', aud: 'fixture-project', iss: 'https://securetoken.google.com/fixture-project',
  exp: now / 1000 + 7200, iat: now / 1000 - 30, auth_time: now / 1000 - 30 };
function token(payload = claims) {
  const data = [{ alg: 'RS256', kid: 'fixture-key' }, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}
const response = () => ({ ok: true, headers: new Headers({ 'cache-control': 'max-age=60' }),
  json: async () => ({ 'fixture-key': publicKey.export({ type: 'spki', format: 'pem' }) }) });
const verifier = (fetchImpl, clock = () => now) => createFirebaseVerifier({ projectId: 'fixture-project', now: clock, fetchImpl });

test('certificate network failures are temporary service errors and the next request recovers', async () => {
  for (const failure of [new TypeError('fetch failed'), new DOMException('Timed out', 'TimeoutError')]) {
    let calls = 0;
    const verify = verifier(async () => { if (++calls === 1) throw failure; return response(); });
    await assert.rejects(verify(token()), error => error.status === 503);
    assert.equal((await verify(token())).uid, 'fixture-user');
    assert.equal(calls, 2);
  }
});

test('unavailable or malformed certificate responses fail closed and are not cached', async () => {
  for (const bad of [{ ...response(), ok: false }, { ...response(), json: async () => { throw new SyntaxError(); } },
    ...[null, [], {}, { key: null }].map(body => ({ ...response(), json: async () => body }))]) {
    let calls = 0;
    const verify = verifier(async () => ++calls === 1 ? bad : response());
    await assert.rejects(verify(token()), error => error.status === 503);
    assert.equal((await verify(token())).uid, 'fixture-user');
  }
});

test('parallel authenticated requests share one refresh, including recovery after failure', async () => {
  let release, calls = 0;
  const verify = verifier(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const first = Array.from({ length: 8 }, () => verify(token()));
  assert.equal(calls, 1);
  release({ ...response(), ok: false });
  assert.ok((await Promise.allSettled(first)).every(result => result.status === 'rejected' && result.reason.status === 503));
  const second = Array.from({ length: 8 }, () => verify(token()));
  assert.equal(calls, 2);
  release(response());
  assert.ok((await Promise.all(second)).every(identity => identity.uid === 'fixture-user'));
  await verify(token());
  assert.equal(calls, 2);
});

test('expired certificates cannot authenticate while refresh is unavailable', async () => {
  let time = now, calls = 0;
  const verify = verifier(async () => { if (++calls === 2) throw new Error('offline'); return response(); }, () => time);
  await verify(token());
  time += 61000;
  await assert.rejects(verify(token()), error => error.status === 503);
  assert.equal((await verify(token())).uid, 'fixture-user');
  assert.equal(calls, 3);
});

test('invalid token claims and signatures still return unauthorized', async () => {
  let calls = 0;
  const verify = verifier(async () => { calls++; return response(); });
  for (const value of ['not-a-token', token({ ...claims, aud: 'wrong' }), token({ ...claims, exp: now / 1000 })]) {
    await assert.rejects(verify(value), error => error.status === 401);
  }
  assert.equal(calls, 0);
  await assert.rejects(verify(`${token().slice(0, -12)}AAAAAAAAAAAA`), error => error.status === 401);
  assert.equal((await verify(token())).uid, 'fixture-user');
});
