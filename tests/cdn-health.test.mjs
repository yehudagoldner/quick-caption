import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCdn, requireQa } from '../scripts/check-cdn.mjs';
import { createBunnyStreamStorage } from '../src/bunnyStreamStorage.js';

const reference = 'bunny://123/11111111-1111-4111-8111-111111111111';
const content = Buffer.alloc(5000, 42);
function fixture() {
  const calls = [];
  return { calls, async open(ref, { method, range, signal }) {
    assert.equal(ref, reference);
    assert.ok(signal instanceof AbortSignal);
    calls.push({ method, range });
    if (method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(content.length), 'Accept-Ranges': 'bytes' } });
    const [, startText, endText] = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = Number(startText), end = Number(endText);
    if (start >= content.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${content.length}` } });
    return new Response(content.subarray(start, end + 1), { status: 206, headers: {
      'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${content.length}` } });
  }, async openThumbnail(_ref, { method }) {
    return new Response(method === 'HEAD' ? null : new Uint8Array([255, 216, 255, 217]), { headers: { 'Content-Type': 'image/jpeg' } });
  } };
}
const run = storage => checkCdn({ storage, references: [reference], rounds: 2 });

test('live diagnostics reject production and incomplete QA configuration before opening a database', () => {
  const qa = { DB_NAME: 'quickcaption_qa', DB_USER: 'quickcaption_qa', PORT: '3100', VITE_APP_ENV: 'qa' };
  assert.doesNotThrow(() => requireQa(qa));
  for (const patch of [{ DB_NAME: 'production' }, { DB_USER: 'root' }, { PORT: '3000' }, { VITE_APP_ENV: 'production' }]) {
    assert.throws(() => requireQa({ ...qa, ...patch }), /isolated QA/);
  }
});

test('CDN checks cover HEAD, start/middle/end seeking, invalid ranges, repeated bytes and thumbnails', async () => {
  const storage = fixture(), report = await run(storage);
  assert.equal(report.ok, true);
  assert.equal(report.passed, 9);
  assert.ok(storage.calls.some(call => call.range === 'bytes=2500-3523'));
  assert.ok(storage.calls.some(call => call.range === 'bytes=3976-4999'));
  assert.equal(JSON.stringify(report).includes(reference), false);
});

test('an origin ignoring Range fails without downloading its full video', async () => {
  const storage = fixture(), open = storage.open;
  let cancelled = 0;
  storage.open = (ref, options) => options.method === 'HEAD' ? open(ref, options) : new Response(new ReadableStream({
    cancel() { cancelled++; },
  }));
  const report = await run(storage);
  assert.equal(report.ok, false);
  assert.equal(report.failed, 6);
  assert.equal(cancelled, 6);
});

test('incorrect range metadata and truncated range bodies fail the health check', async () => {
  for (const fault of ['metadata', 'truncated']) {
    const storage = fixture(), open = storage.open;
    storage.open = async (ref, options) => {
      const result = await open(ref, options);
      if (result.status !== 206) return result;
      if (fault === 'metadata') { result.headers.set('Content-Range', 'bytes 1-2/3'); return result; }
      return new Response(new Uint8Array([42]), { status: 206, headers: result.headers });
    };
    const report = await run(storage);
    assert.equal(report.ok, false);
    assert.ok(report.checks.some(check => !check.ok && /incorrect|incomplete|does not match/.test(check.reason)));
  }
});

test('intermittent network failures remain failures even when later requests recover; secrets stay out of the report', async () => {
  const storage = fixture(), open = storage.open;
  let calls = 0;
  storage.open = (ref, options) => {
    if (++calls === 3) throw Object.assign(new Error('https://cdn.example/original?token=SECRET API_KEY=SECRET'), { status: 502, code: 'BUNNY_STORAGE_ERROR' });
    return open(ref, options);
  };
  const report = await run(storage);
  assert.equal(report.failed, 1);
  assert.equal(report.ok, false);
  assert.equal(report.checks.at(-1).ok, true);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|cdn\.example/);
});

test('thumbnail HTML errors and oversized image bodies are rejected', async () => {
  for (const response of [() => new Response('error page', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/jpeg' } })]) {
    const storage = fixture(); storage.openThumbnail = async () => response();
    const report = await run(storage);
    assert.equal(report.ok, false);
    assert.equal(report.checks.at(-1).ok, false);
  }
});

test('Bunny transport obeys cancellation and reports timeout without accepting missing media', async () => {
  const storage = createBunnyStreamStorage({ BUNNY_STREAM_LIBRARY_ID: '123', BUNNY_STREAM_API_KEY: 'fixture-secret', BUNNY_STREAM_CDN_HOSTNAME: 'fixture.b-cdn.net' },
    async (_url, { signal }) => new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
  // AbortSignal.timeout is unref'ed; keep the test alive while simulating a pending socket.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const report = await checkCdn({ storage, references: [reference], rounds: 1, timeoutMs: 20 });
    assert.equal(report.ok, false);
    assert.equal(report.failed, 3);
    assert.ok(report.checks.every(check => !check.ok));
  } finally { clearInterval(keepAlive); }
});
