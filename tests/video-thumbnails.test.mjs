import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { createBunnyStreamStorage } from '../src/bunnyStreamStorage.js';
import { createVideoThumbnailHandler, withVideoThumbnail } from '../src/videoThumbnails.js';
import { createVideoTokens } from '../src/videoTokens.js';

const ref = 'bunny://123/11111111-1111-4111-8111-111111111111';
const env = { BUNNY_STREAM_LIBRARY_ID: '123', BUNNY_STREAM_API_KEY: 'private-fixture-key', BUNNY_STREAM_CDN_HOSTNAME: 'fixture.b-cdn.net', BUNNY_STREAM_TOKEN_KEY: 'cdn-fixture-key' };

test('Bunny thumbnail uses the API-selected filename, caches metadata and signs the image path without exposing the API key', async () => {
  const calls = [], bytes = new Uint8Array([255, 216, 255, 217]);
  const storage = createBunnyStreamStorage(env, async (input, options) => {
    const url = new URL(input); calls.push({ url, options });
    if (url.hostname === 'video.bunnycdn.com') {
      assert.equal(options.headers.AccessKey, env.BUNNY_STREAM_API_KEY);
      return Response.json({ thumbnailFileName: 'thumbnail_4.jpg' });
    }
    assert.equal(url.pathname, '/11111111-1111-4111-8111-111111111111/thumbnail_4.jpg');
    assert.equal(url.searchParams.get('token'), createHash('sha256').update(env.BUNNY_STREAM_TOKEN_KEY + url.pathname + url.searchParams.get('expires')).digest('base64url'));
    assert.equal(options.headers.AccessKey, undefined);
    assert.equal(options.headers.Referer, 'https://player.mediadelivery.net/');
    return new Response(options.method === 'HEAD' ? null : bytes, { headers: { 'Content-Type': 'image/jpeg' } });
  });
  assert.deepEqual(new Uint8Array(await (await storage.openThumbnail(ref)).arrayBuffer()), bytes);
  await storage.openThumbnail(ref, { method: 'HEAD' });
  assert.equal(calls.filter(c => c.url.hostname === 'video.bunnycdn.com').length, 1);
});

test('missing and unsafe thumbnail names do not trigger a CDN request; CDN errors clear stale metadata', async () => {
  for (const filename of [null, '../original', 'https://evil.example/image.jpg', 'image.svg', 'thumbnail.jpg?secret=1']) {
    let calls = 0;
    const storage = createBunnyStreamStorage(env, async () => { calls++; return Response.json({ thumbnailFileName: filename }); });
    await assert.rejects(storage.openThumbnail(ref));
    assert.equal(calls, 1);
    await assert.rejects(storage.openThumbnail('bunny://999/11111111-1111-4111-8111-111111111111'));
    assert.equal(calls, 1);
  }
  let metadata = 0;
  const storage = createBunnyStreamStorage(env, async input => new URL(input).hostname === 'video.bunnycdn.com'
    ? (metadata++, Response.json({ thumbnailFileName: 'thumbnail.jpg' })) : new Response(null, { status: 404 }));
  await assert.rejects(storage.openThumbnail(ref), { status: 404 });
  await assert.rejects(storage.openThumbnail(ref), { status: 404 });
  assert.equal(metadata, 2);
});

test('list summaries use separate thumbnail grants for video and preserve placeholders for audio', () => {
  const tokens = createVideoTokens('fixture-key');
  const summary = withVideoThumbnail({ id: 42, media_type: 'video', stored_path: ref }, 'owner', tokens);
  assert.ok(!('stored_path' in summary));
  const grant = new URL(summary.thumbnail_url, 'https://fixture.test').searchParams.get('thumbnailToken');
  assert.equal(tokens.verify(grant, 'thumbnail').userUid, 'owner');
  assert.equal(tokens.verify(grant, 'media'), null);
  assert.equal(withVideoThumbnail({ id: 43, media_type: 'audio', stored_path: ref }, 'owner', tokens).thumbnail_url, null);
  assert.ok(withVideoThumbnail({ id: 44, media_type: 'video', stored_path: 'legacy.mp4' }, 'owner', tokens).thumbnail_url);
});

test('thumbnail handler verifies ownership without renewing retention, rejects non-images and handles upstream failure', async t => {
  let mode = 'image', opened = 0;
  const bytes = Buffer.from([255, 216, 255, 217]);
  const app = express();
  app.use((req, _res, next) => { req.identity = { uid: req.get('X-Fixture-User') || 'owner' }; next(); });
  app.get('/videos/:id/thumbnail', createVideoThumbnailHandler({
    getVideoById: async ({ videoId, userUid, touch }) => {
      assert.equal(touch, false);
      return userUid === 'owner' && videoId === 42 ? { stored_path: ref, media_type: 'video' } : null;
    },
    bunny: { openThumbnail: async () => {
      opened++;
      if (mode === 'error') throw new Error('upstream failed');
      return new Response(bytes, { headers: { 'Content-Type': mode === 'image' ? 'image/jpeg' : 'text/html' } });
    } },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/videos/42/thumbnail`;
  assert.equal((await fetch(url, { headers: { 'X-Fixture-User': 'stranger' } })).status, 404);
  assert.equal(opened, 0);
  const image = await fetch(url);
  assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
  mode = 'html'; assert.equal((await fetch(url)).status, 502);
  mode = 'error'; const failed = await fetch(url);
  assert.equal(failed.status, 502); assert.equal(failed.headers.get('cache-control'), 'private, no-store');
});
