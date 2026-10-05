import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

test('real upload routes persist remote video, retain failed AI sources, clean temp files and enforce ownership', { timeout: 20000 }, async t => {
  const child = spawn(process.execPath, ['tests/fixtures/bunny/server.mjs'], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: '0', NODE_ENV: 'development', DEV_AUTH_BYPASS: '1', DEV_AUTH_UID: 'bunny-fixture-owner',
      VIDEO_TOKEN_SECRET: 'fixture-signing-key', BUNNY_STREAM_LIBRARY_ID: '123', BUNNY_STREAM_API_KEY: 'fixture-secret', BUNNY_STREAM_CDN_HOSTNAME: 'fixture.b-cdn.net' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture server failed to start')), 10000);
    child.stdout.on('data', () => { const match = output.match(/Server listening on (http:\/\/localhost:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${errors}`)); });
  });
  const headers = { Authorization: 'Bearer local-development' };
  const upload = async (content, route = '/api/transcribe') => {
    const body = new FormData(); body.append('media', new Blob([content], { type: 'video/webm' }), 'synthetic.webm');
    return fetch(base + route, { method: 'POST', headers, body });
  };
  const success = await upload('ORIGINAL_BYTES'); assert.equal(success.status, 200);
  const { videoId } = await success.json(); assert.ok(videoId);
  const video = (await (await fetch(`${base}/api/videos/${videoId}`, { headers })).json()).video;
  assert.match(video.stored_path, /^bunny:\/\/123\//);
  const grant = await (await fetch(`${base}/api/videos/${videoId}/token`, { headers })).json();
  assert.equal((await fetch(`${base}/api/videos/${videoId}/media`)).status, 401);
  const ranged = await fetch(`${base}/api/videos/${videoId}/media?mediaToken=${grant.mediaToken}`, { headers: { Range: 'bytes=0-7' } });
  assert.equal(ranged.status, 206); assert.equal(await ranged.text(), 'ORIGINAL');
  assert.equal(ranged.headers.get('content-type'), 'video/webm');
  const file = await fetch(`${base}/api/videos/${videoId}/file`, { headers }); assert.equal(await file.text(), 'ORIGINAL_BYTES');
  const failed = await upload('FAIL_UPLOAD'); assert.equal(failed.status, 500); assert.match((await failed.json()).error, /אחסון הסרטונים/);
  const failedAI = await upload('FAIL_AI'); assert.equal(failedAI.status, 500); await failedAI.json();
  const wordUpload = await upload('WORD_BYTES', '/api/transcribe-words'); assert.equal(wordUpload.status, 200); assert.ok((await wordUpload.json()).videoId);
  const videos = (await (await fetch(`${base}/api/videos`, { headers })).json()).videos;
  assert.equal(videos.filter(v => v.status === 'completed').length, 2);
  assert.ok(videos.some(v => v.status === 'failed' && v.stored_path?.startsWith('bunny://')));
  for (const match of output.matchAll(/FIXTURE_INPUT=(.+)/g)) {
    // The response is sent immediately before finally deletes its working file.
    await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(access(match[1].trim()), { code: 'ENOENT' });
  }
});
