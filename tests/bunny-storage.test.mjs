import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { createBunnyStreamStorage, createMediaStorage, parseBunnyReference, localMediaPath, serveBunnyMedia } from '../src/bunnyStreamStorage.js';
import { drainRemoteMediaDeletions } from '../src/videoRetention.js';

const guid = '11111111-1111-4111-8111-111111111111';
const reference = `bunny://123/${guid}`;
const env = { BUNNY_STREAM_LIBRARY_ID: '123', BUNNY_STREAM_API_KEY: 'fixture-secret', BUNNY_STREAM_CDN_HOSTNAME: 'fixture.b-cdn.net' };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bunny-storage-test-'));
  const filePath = path.join(root, 'source');
  const content = Buffer.from('synthetic-original-video');
  await fs.writeFile(filePath, content);
  t.after(async () => { await fs.unlink(filePath); await fs.rmdir(root); });
  return { root, content, file: { path: filePath, size: content.length, mimetype: 'video/mp4' } };
}

test('new videos are streamed to Bunny and only a remote reference is persisted', async t => {
  const { root, content, file } = await fixture(t);
  const calls = [];
  const bunny = createBunnyStreamStorage(env, async (url, options) => {
    calls.push({ url: String(url), ...options });
    if (options.method === 'POST') return Response.json({ guid });
    if (options.method === 'PUT') {
      assert.equal(options.headers.AccessKey, env.BUNNY_STREAM_API_KEY);
      assert.equal(options.headers['Content-Length'], String(content.length));
      const chunks = []; for await (const chunk of options.body) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), content);
      return Response.json({ success: true });
    }
    assert.equal(options.headers.Range, 'bytes=0-0');
    assert.equal(options.headers.AccessKey, undefined, 'Never send API credentials to the CDN');
    return new Response(content.subarray(0, 1), { status: 206 });
  });
  assert.equal(await createMediaStorage({ bunny, localDir: root }).persist(file, 'סרטון.mp4'), reference);
  assert.deepEqual(await fs.readdir(root), ['source']);
  assert.equal(calls.length, 3);
});

test('missing credentials and provider failures never fall back to local video storage', async t => {
  const { root, file } = await fixture(t);
  await assert.rejects(createMediaStorage({ bunny: createBunnyStreamStorage({}), localDir: root }).persist(file, 'video.mp4'), { code: 'BUNNY_STORAGE_ERROR', status: 503 });
  const methods = [];
  const bunny = createBunnyStreamStorage(env, async (_url, options) => {
    methods.push(options.method);
    if (options.method === 'POST') return Response.json({ guid });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response(null, { status: 401 });
  });
  await assert.rejects(createMediaStorage({ bunny, localDir: root }).persist(file, 'video.mp4'), /HTTP 401/);
  assert.deepEqual(methods, ['POST', 'PUT', 'DELETE']);
  assert.deepEqual(await fs.readdir(root), ['source']);
});

test('inaccessible source is rejected even after the provider accepts an upload', async t => {
  const { file } = await fixture(t);
  let deleted = false;
  const bunny = createBunnyStreamStorage(env, async (_url, options) => {
    if (options.method === 'POST') return Response.json({ guid });
    if (options.method === 'PUT') return Response.json({ success: true });
    if (options.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
    return new Response(null, { status: 403 });
  });
  await assert.rejects(bunny.upload(file, 'video.mp4'), /Bunny/);
  assert.equal(deleted, true);
});

test('references reject traversal, arbitrary URLs and videos in other libraries', async () => {
  for (const value of ['bunny://123/../secret', 'bunny://123/not-a-guid', 'https://evil.example/video']) assert.equal(parseBunnyReference(value), null);
  for (const value of ['../video', '..\\video', '/video', 'bunny://bad']) assert.throws(() => localMediaPath('/media', value), /Unsafe/);
  const bunny = createBunnyStreamStorage(env, () => { throw new Error('Network must not be reached'); });
  await assert.rejects(bunny.open(`bunny://456/${guid}`), /ספריית/);
});

test('private remote media proxy preserves seeking, HEAD, invalid ranges and MIME type', async t => {
  const content = Buffer.from('original-video-bytes');
  const opened = [];
  const bunny = { async open(_storedPath, options) {
    opened.push(options);
    if (options.range === 'bytes=999-') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${content.length}` } });
    const ranged = Boolean(options.range);
    const body = ranged ? content.subarray(0, 4) : content;
    return new Response(options.method === 'HEAD' ? null : body, { status: ranged ? 206 : 200,
      headers: { 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes', ...(ranged ? { 'Content-Range': `bytes 0-3/${content.length}` } : {}) } });
  } };
  const app = express();
  app.get('/media', (req, res) => { res.set('Cache-Control', 'private, no-store'); return serveBunnyMedia(req, res, { stored_path: reference, mime_type: 'video/webm' }, bunny); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/media`;
  const range = await fetch(url, { headers: { Range: 'bytes=0-3' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-type'), 'video/webm');
  assert.equal(range.headers.get('content-range'), `bytes 0-3/${content.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), content.subarray(0, 4));
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal(opened[1].method, 'HEAD');
  const invalid = await fetch(url, { headers: { Range: 'bytes=999-' } });
  assert.equal(invalid.status, 416); await invalid.arrayBuffer();
});

test('remote retention retries failed deletes and never deletes media still referenced', async () => {
  const queue = new Set([reference, `bunny://123/22222222-2222-4222-8222-222222222222`]);
  const referenced = [...queue][1];
  const db = { async execute(sql, params) {
    if (sql.startsWith('SELECT stored_path')) return [[...queue].map(stored_path => ({ stored_path }))];
    if (sql.startsWith('SELECT id')) return [params[0] === referenced ? [{ id: 1 }] : []];
    if (sql.startsWith('DELETE')) { queue.delete(params[0]); return [{}]; }
    throw new Error(sql);
  } };
  assert.deepEqual(await drainRemoteMediaDeletions(db, async () => { throw new Error('Network outage'); }), { removed: 0, pending: 1 });
  assert.deepEqual([...queue], [reference]);
  const removed = [];
  assert.deepEqual(await drainRemoteMediaDeletions(db, async value => removed.push(value)), { removed: 1, pending: 0 });
  assert.deepEqual(removed, [reference]); assert.equal(queue.size, 0);
});
