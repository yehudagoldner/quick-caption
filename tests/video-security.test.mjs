import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink, mkdir, mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVideoTokens, loadVideoSigningKey } from '../src/videoTokens.js';

test('signing key survives restarts and is shared by concurrent local workers', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'caption-key-test-'));
  const keyPath = path.join(directory, 'key');
  t.after(async () => { await unlink(keyPath); await rmdir(directory); });
  const keys = await Promise.all(Array.from({ length: 8 }, () => loadVideoSigningKey({ keyPath })));
  assert.equal(keys[0].length, 32);
  for (const key of keys) assert.deepEqual(key, keys[0]);
  const token = createVideoTokens(keys[0]).issue(42, 'owner', 'edit');
  assert.equal(createVideoTokens(await loadVideoSigningKey({ keyPath })).verify(token, 'edit').userUid, 'owner');
  assert.equal(await loadVideoSigningKey({ configuredKey: 'configured-fixture-key', keyPath }), 'configured-fixture-key');
});

test('video grants reject unsigned, modified, expired and cross-purpose tokens', () => {
  let now = 1000;
  const tokens = createVideoTokens('fixture-key', () => now);
  const token = tokens.issue(42, 'owner', 'edit', 100);
  assert.equal(tokens.verify(token, 'edit').videoId, 42);
  assert.equal(tokens.verify(token, 'media'), null);
  assert.equal(tokens.verify(Buffer.from(JSON.stringify({ videoId: 42, userUid: 'owner', exp: 999999 })).toString('base64url'), 'edit'), null);
  const [payload, signature] = token.split('.');
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), videoId: 43 })).toString('base64url');
  assert.equal(tokens.verify(`${tampered}.${signature}`, 'edit'), null);
  assert.equal(createVideoTokens('other-key').verify(token, 'edit'), null);
  now = 1100;
  assert.equal(tokens.verify(token, 'edit'), null);
});

test('real private routes require verified ownership; signed media still supports seeking', { timeout: 20000 }, async t => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const identity = uid => {
    const seconds = Math.floor(Date.now() / 1000);
    const claims = { sub: uid, aud: 'security-fixture', iss: 'https://securetoken.google.com/security-fixture', exp: seconds + 600, iat: seconds, auth_time: seconds };
    const payload = [{ alg: 'RS256', kid: 'fixture' }, claims].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return `${payload}.${sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64url')}`;
  };
  const filename = `security-fixture-${process.pid}.webm`;
  await mkdir('stored-videos', { recursive: true });
  const media = Buffer.from((await readFile('tests/fixtures/portrait-video.base64', 'utf8')).trim(), 'base64');
  await writeFile(`stored-videos/${filename}`, media, { flag: 'wx' });
  const child = spawn(process.execPath, ['tests/fixtures/security/server.mjs'], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: '0', NODE_ENV: 'production', DEV_AUTH_BYPASS: '1',
      VIDEO_TOKEN_SECRET: 'security-integration-test-key', TEST_MEDIA_FILE: filename, TEST_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    await unlink(`stored-videos/${filename}`);
  });
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Fixture server did not start')), 10000);
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/Server listening on (http:\/\/localhost:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture server exited: ${code}`)); });
  });
  const request = (path, token, body, method = body ? 'PUT' : 'GET', extraHeaders = {}) => fetch(`${base}${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const owner = identity('qa-owner-fixture'), stranger = identity('stranger');
  const unsigned = Buffer.from(JSON.stringify({ videoId: 424242, userUid: 'qa-owner-fixture', exp: Date.now() + 999999 })).toString('base64url');
  for (const path of ['/api/users/credits', '/api/videos', '/api/videos/424242', '/api/videos/424242/token', '/api/videos/424242/media', '/api/videos/424242/file', `/api/videos/load?token=${unsigned}`, '/api/transcribe/jobs/11111111-1111-4111-8111-111111111111']) {
    assert.equal((await request(`${path}${path.includes('?') ? '&' : '?'}userUid=qa-owner-fixture`)).status, 401, path);
  }
  for (const path of ['/api/transcribe', '/api/transcribe-words', '/api/burn-subtitles', '/api/ai-edit-subtitles', '/api/resegment', '/api/payments/create-order', '/api/payments/capture-order']) {
    assert.equal((await request(path, null, { userUid: 'qa-owner-fixture', credits: 100 }, 'POST')).status, 401, path);
  }
  assert.equal((await request('/api/videos/424242?userUid=qa-owner-fixture', stranger)).status, 404);
  assert.equal((await request('/api/payments/create-order', stranger, { userUid: 'qa-owner-fixture', credits: 100 }, 'POST')).status, 404);
  assert.equal((await request('/api/videos/424242', 'local-development')).status, 401, 'Production cannot use the local development bypass');
  const update = { userUid: 'qa-owner-fixture', subtitleJson: JSON.stringify([{ id: 1, start: 0, end: 2, text: 'authorized revision' }]) };
  assert.equal((await request('/api/videos/424242/subtitles', null, update)).status, 401);
  assert.equal((await request('/api/videos/424242/subtitles', stranger, update)).status, 404);
  assert.equal((await request('/api/videos/update-subtitles', owner, { ...update, token: unsigned })).status, 401);
  const grant = await (await request('/api/videos/424242/token', owner)).json();
  assert.equal((await request(`/api/videos/load?token=${grant.token}`, stranger)).status, 403);
  assert.equal((await request('/api/videos/update-subtitles', stranger, { ...update, token: grant.token })).status, 403);
  assert.equal((await request('/api/videos/update-subtitles', owner, { ...update, userUid: 'stranger', token: grant.token })).status, 200);
  assert.equal((await (await request('/api/videos/424242', owner)).json()).video.subtitle_json[0].text, 'authorized revision');
  assert.equal((await request(`/api/videos/424243/media?mediaToken=${grant.mediaToken}`)).status, 401);
  assert.equal((await request(`/api/videos/load?token=${grant.mediaToken}`, owner)).status, 401);
  const stream = await request(`/api/videos/424242/media?mediaToken=${grant.mediaToken}`, null, null, 'GET', { Range: 'bytes=0-31' });
  assert.equal(stream.status, 206);
  assert.deepEqual(Buffer.from(await stream.arrayBuffer()), media.subarray(0, 32));
});
