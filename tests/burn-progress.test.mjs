import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { createBurnSubtitlesRouter } from '../routes/burnSubtitles.js';
import { createBurnSourceResolver } from '../src/burnSource.js';
import { probeBurnDuration, runBurnFfmpeg } from '../src/burnVideo.js';

test('saved source burns locally, emits measured progress only to its owner, preserves original and cleans remote temp files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'burn-test-'));
  const source = path.join(dir, 'original.mp4');
  const generated = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', source]);
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const bytes = await fs.readFile(source);
  const remote = `bunny://1/${randomUUID()}`;
  const lookup = async ({ videoId, userUid }) => userUid === 'owner' && [1, 2].includes(videoId)
    ? { stored_path: videoId === 1 ? 'original.mp4' : remote, original_filename: 'בדיקה.mp4' } : null;
  const bunny = { open: async ref => { assert.equal(ref, remote); return new Response(bytes); } };
  const app = express();
  app.use((req, _res, next) => { req.identity = { uid: req.get('X-Test-User') || 'owner' }; next(); });
  app.use('/burn', createBurnSubtitlesRouter(multer({ dest: dir }), {
    resolveVideo: createBurnSourceResolver({ getVideoById: lookup, bunny, localDir: dir, tempDir: dir }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/burn`;
  const body = id => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ videoId: id, subtitleContent: '1\n00:00:00,000 --> 00:00:10,000\nשלום עולם\n', videoWidth: 1280, videoHeight: 720, fontSize: 60 })) form.append(key, String(value));
    return form;
  };
  try {
    const id = randomUUID(), statuses = [];
    let finished = false;
    const burn = fetch(base, { method: 'POST', body: body(1), headers: { 'X-Burn-Job-Id': id } }).then(async response => {
      assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
      assert.match(response.headers.get('content-disposition'), /subtitled\.mp4/);
      const result = Buffer.from(await response.arrayBuffer());
      finished = true;
      return result;
    });
    while (!finished) {
      const progress = await fetch(`${base}/progress/${id}`);
      if (progress.ok) statuses.push(await progress.json());
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const output = path.join(dir, 'result.mp4');
    await fs.writeFile(output, await burn);
    assert.ok(statuses.some(s => s.stage === 'burning' && s.percent > 0 && s.percent < 100), JSON.stringify(statuses));
    const percentages = statuses.filter(s => s.stage === 'burning').map(s => s.percent);
    assert.deepEqual(percentages, [...percentages].sort((a, b) => a - b));
    assert.equal((await fetch(`${base}/progress/${id}`, { headers: { 'X-Test-User': 'other' } })).status, 404);
    assert.ok(Math.abs(await probeBurnDuration(output) - 10) < .1);
    // Audio remains a packet-for-packet copy, and the saved source is intact.
    const audio = file => spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'adts', 'pipe:1']).stdout;
    assert.deepEqual(audio(output), audio(source));
    assert.deepEqual(await fs.readFile(source), bytes);
    const remoteResponse = await fetch(base, { method: 'POST', body: body(2) });
    assert.equal(remoteResponse.status, 200);
    await remoteResponse.arrayBuffer();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual((await fs.readdir(dir)).sort(), ['original.mp4', 'result.mp4']);
    const denied = await fetch(base, { method: 'POST', body: body(1), headers: { 'X-Test-User': 'other' } });
    assert.equal(denied.status, 404);
    const failedId = randomUUID();
    const invalid = new FormData(); invalid.append('videoId', '1');
    assert.equal((await fetch(base, { method: 'POST', body: invalid, headers: { 'X-Burn-Job-Id': failedId } })).status, 400);
    assert.equal((await (await fetch(`${base}/progress/${failedId}`)).json()).stage, 'failed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('cancelled FFmpeg exits instead of continuing a disconnected burn', async () => {
  const controller = new AbortController();
  await assert.rejects(runBurnFfmpeg(['-v', 'error', '-nostdin', '-progress', 'pipe:1', '-re', '-f', 'lavfi', '-i', 'color=s=320x180:r=10:d=60', '-f', 'null', '-'], {
    duration: 60, signal: controller.signal, onProgress: () => controller.abort(),
  }), /Burn cancelled/);
});

test('remote source read failure removes the partial temporary download', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'burn-source-test-'));
  try {
    const resolver = createBurnSourceResolver({
      getVideoById: async () => ({ stored_path: `bunny://1/${randomUUID()}` }), localDir: dir, tempDir: dir,
      bunny: { open: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.error(new Error('upstream failed')); } })) },
    });
    await assert.rejects(resolver({ videoId: 1, userUid: 'owner' }), /upstream failed/);
    assert.deepEqual(await fs.readdir(dir), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
