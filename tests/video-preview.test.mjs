import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createBunnyStreamStorage, serveBunnyMedia } from '../src/bunnyStreamStorage.js';
import { createVideoPreviewRouter } from '../routes/videoPreview.js';

const reference = 'bunny://123/11111111-1111-4111-8111-111111111111';
const env = { BUNNY_STREAM_LIBRARY_ID: '123', BUNNY_STREAM_API_KEY: 'fixture-secret', BUNNY_STREAM_CDN_HOSTNAME: 'fixture.b-cdn.net', BUNNY_STREAM_TOKEN_KEY: 'signing-fixture' };

test('preview metadata defaults to 720p, keeps source dimensions, caches by source and handles smaller videos', async () => {
  let calls = 0;
  const bunny = createBunnyStreamStorage(env, async () => { calls++; return Response.json({ width: 1080, height: 1920, status: 4, hasMP4Fallback: true, availableResolutions: calls === 1 ? '240p,480p,720p,1080p' : '240p,480p' }); });
  const info = await bunny.previewInfo(reference);
  assert.equal(info.mode, 'rendition'); assert.equal(info.defaultQuality, '720p');
  assert.deepEqual(info.sourceDimensions, { width: 1080, height: 1920 });
  assert.deepEqual(info.qualities, ['240p', '480p', '720p', '1080p']);
  assert.deepEqual(await bunny.previewInfo(reference), info); assert.equal(calls, 1);
  const replacement = await bunny.previewInfo(reference.replace('11111111-', '22222222-'));
  assert.equal(calls, 2); assert.equal(replacement.defaultQuality, '480p');
});

test('not-yet-encoded or unavailable previews never claim a rendition is ready', async () => {
  for (const [metadata, mode] of [[{ status: 2, width: 1080, height: 1920 }, 'pending'], [{ status: 4, hasMP4Fallback: false, width: 1080, height: 1920 }, 'unavailable']]) {
    const bunny = createBunnyStreamStorage(env, async () => Response.json(metadata));
    const info = await bunny.previewInfo(reference); assert.equal(info.mode, mode); assert.deepEqual(info.qualities, []);
  }
});

test('preview uses signed MP4 renditions with ranges, while source reads for export remain original', async () => {
  const calls = [];
  const bunny = createBunnyStreamStorage(env, async (url, options) => {
    calls.push({ url: new URL(url), options });
    return new Response('part', { status: 206, headers: { 'Content-Range': 'bytes 0-3/100', 'Content-Length': '4' } });
  });
  await (await bunny.openPreview(reference, '720p', { range: 'bytes=0-3' })).body.cancel();
  await (await bunny.openPreview(reference, '1080p', { method: 'HEAD' })).body.cancel();
  await (await bunny.open(reference, { range: 'bytes=0-3' })).body.cancel();
  assert.ok(calls[0].url.pathname.endsWith('/play_720p.mp4')); assert.equal(calls[0].options.headers.Range, 'bytes=0-3');
  assert.ok(calls[1].url.pathname.endsWith('/play_1080p.mp4')); assert.equal(calls[1].options.method, 'HEAD');
  assert.ok(calls[2].url.pathname.endsWith('/original'));
  for (const call of calls) { assert.ok(call.url.searchParams.get('token')); assert.equal(call.options.headers.AccessKey, undefined); }
  assert.throws(() => bunny.openPreview(reference, '../original'), { status: 400 }); assert.equal(calls.length, 3);
});

test('a missing preview returns 404 without falling back to the large original', async () => {
  const urls = [];
  const bunny = createBunnyStreamStorage(env, async url => { urls.push(String(url)); return new Response('not ready', { status: 404 }); });
  await assert.rejects(bunny.openPreview(reference, '720p'), { status: 404 });
  assert.equal(urls.length, 1); assert.ok(urls[0].includes('play_720p.mp4')); assert.ok(!urls[0].includes('/original'));
});

test('authenticated preview discovery checks ownership and keeps local/audio playback unchanged', async t => {
  const calls = [];
  const app = express(); app.use((req, _res, next) => { req.identity = { uid: req.headers['x-user'] ?? 'owner' }; next(); });
  app.use('/api/videos', createVideoPreviewRouter({
    getVideoById: async ({ videoId, userUid }) => userUid === 'owner' ? { id: videoId, stored_path: videoId === 42 ? reference : 'local.wav', media_type: videoId === 42 ? 'video' : 'audio' } : null,
    bunny: { previewInfo: async value => { calls.push(value); return { mode: 'rendition', qualities: ['720p', '1080p'], defaultQuality: '720p', sourceDimensions: { width: 1920, height: 1080 } }; } },
    issueMediaToken: id => `signed-${id}`,
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/videos/42/preview`;
  const denied = await fetch(url, { headers: { 'x-user': 'other' } }); assert.equal(denied.status, 404); assert.deepEqual(calls, []);
  const result = await fetch(url); const info = await result.json(); assert.equal(info.defaultQuality, '720p'); assert.equal(info.mediaToken, 'signed-42'); assert.equal(result.headers.get('cache-control'), 'private, no-store');
  const audio = await (await fetch(url.replace('/42/', '/43/'))).json(); assert.equal(audio.mode, 'source'); assert.deepEqual(audio.qualities, []); assert.equal(calls.length, 1);
});

test('rendition proxy preserves HTTP ranges and HEAD with MP4 type even for a MOV source', async t => {
  const calls = [];
  const bunny = { open: () => { throw Error('Original must not be read'); }, openPreview: async (storedPath, quality, options) => {
    calls.push({ storedPath, quality, ...options });
    return new Response(options.method === 'HEAD' ? null : 'part', { status: 206, headers: { 'Content-Length': '4', 'Content-Range': 'bytes 0-3/100' } });
  } };
  const app = express(); app.get('/preview', (req, res) => serveBunnyMedia(req, res, { stored_path: reference, mime_type: 'video/quicktime' }, bunny, '720p'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/preview`;
  const result = await fetch(url, { headers: { Range: 'bytes=0-3' } }); assert.equal(await result.text(), 'part'); assert.equal(result.status, 206);
  assert.equal(result.headers.get('content-type'), 'video/mp4'); assert.equal(result.headers.get('accept-ranges'), 'bytes'); assert.equal(result.headers.get('content-range'), 'bytes 0-3/100');
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(await head.text(), ''); assert.equal(calls[1].method, 'HEAD'); assert.equal(calls[0].range, 'bytes=0-3');
});
