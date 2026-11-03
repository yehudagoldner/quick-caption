import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVideoMediaRouter, inspectReplacementVideo } from '../routes/videoMedia.js';
import { createVideoMediaStore } from '../src/videoMedia.js';
import { createMediaUpload, mediaUploadError } from '../src/mediaUpload.js';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'caption-replacement-'));
  const video = { id: 42, status: 'completed', stored_path: 'old.webm', subtitle_json: [{ id: 1, start: 0, end: 4, text: 'תיקון קיים', style: { fontColor: '#ff0000' } }], words_json: [{ word: 'תיקון', start: 0, end: 1 }] };
  const removed = [], updates = [], uploads = [];
  const app = express();
  app.use((req, _res, next) => { req.identity = { uid: req.headers['x-user'] ?? 'owner' }; next(); });
  app.use('/api/videos', createVideoMediaRouter({
    upload: createMediaUpload(directory, 10000),
    getVideoById: async ({ videoId, userUid }) => videoId === 42 && userUid === 'owner' ? structuredClone(video) : null,
    updateMedia: async args => { updates.push(args); if (options.conflict) return false; if (options.failSave) throw new Error('database fixture failure'); video.stored_path = args.storedPath; return true; },
    mediaStorage: {
      persist: async (file, filename) => { uploads.push({ file, filename }); if (options.failUpload) throw new Error('storage fixture failure'); return 'new.webm'; },
      remove: async value => { removed.push(value); },
    },
    issueMediaToken: () => 'signed-media-token',
    inspect: async () => { if (options.invalid) throw new Error('Not video'); return 2; },
  }));
  app.use(mediaUploadError);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { video, removed, updates, uploads, directory,
    send: async (uid = 'owner', bytes = 100) => {
      const body = new FormData(); body.append('media', new Blob([new Uint8Array(bytes)], { type: 'video/webm' }), 'replacement.webm');
      const result = await fetch(`http://127.0.0.1:${server.address().port}/api/videos/42/media`, { method: 'PUT', headers: { 'x-user': uid }, body });
      const data = await result.json();
      // The handler sends the acknowledgment before its finally cleanup ends.
      for (let n = 0; n < 30 && (await readdir(directory)).length; n++) await new Promise(resolve => setTimeout(resolve, 10));
      return { result, data };
    },
  };
}

test('replacement retains caption edits, word timings and ownership, cleaning old media after save', async t => {
  const state = await fixture(t);
  const before = JSON.stringify({ segments: state.video.subtitle_json, words: state.video.words_json });
  const { result, data } = await state.send();
  assert.equal(result.status, 200); assert.equal(data.success, true); assert.equal(data.mediaToken, 'signed-media-token');
  assert.equal(state.video.stored_path, 'new.webm'); assert.deepEqual(state.removed, ['old.webm']);
  assert.equal(state.updates[0].previousStoredPath, 'old.webm'); assert.equal(state.updates[0].userUid, 'owner');
  assert.equal(state.updates[0].durationSeconds, 2); assert.equal(state.updates[0].originalFilename, 'replacement.webm');
  assert.equal(JSON.stringify({ segments: state.video.subtitle_json, words: state.video.words_json }), before);
  assert.deepEqual(await readdir(state.directory), []);
});

for (const [name, options, status, removed] of [
  ['invalid media', { invalid: true }, 400, []],
  ['concurrent replacement', { conflict: true }, 409, ['new.webm']],
  ['failed database update', { failSave: true }, 500, ['new.webm']],
  ['failed storage upload', { failUpload: true }, 500, []],
]) test(`${name} keeps the old video and removes temporary uploads`, async t => {
  const state = await fixture(t, options); const { result } = await state.send();
  assert.equal(result.status, status); assert.equal(state.video.stored_path, 'old.webm');
  assert.deepEqual(state.removed, removed); assert.deepEqual(await readdir(state.directory), []);
});

test('cross-account replacement is rejected before uploading or mutating media', async t => {
  const state = await fixture(t); const { result } = await state.send('someone-else');
  assert.equal(result.status, 404); assert.deepEqual(state.uploads, []); assert.deepEqual(state.updates, []); assert.deepEqual(state.removed, []);
  assert.deepEqual(await readdir(state.directory), []);
});

test('oversized replacement preserves the existing video', async t => {
  const state = await fixture(t); const { result } = await state.send('owner', 10002);
  assert.equal(result.status, 413); assert.deepEqual(state.updates, []); assert.deepEqual(state.removed, []);
  assert.deepEqual(await readdir(state.directory), []);
});

test('SQL only changes media metadata and uses ownership plus the previous source as a guard', async () => {
  let statement, values;
  const update = createVideoMediaStore({ execute: async (sql, args) => { statement = sql; values = args; return [{ affectedRows: 1 }]; } });
  assert.equal(await update({ videoId: 42, userUid: 'owner', previousStoredPath: null, storedPath: 'new', originalFilename: 'new.mp4', mimeType: 'video/mp4', durationSeconds: 12, sizeBytes: 123 }), true);
  assert.doesNotMatch(statement, /subtitle_json|words_json|transcription_id|\bformat\s*=/);
  assert.match(statement, /WHERE id = \? AND user_uid = \? AND stored_path <=> \?/);
  assert.deepEqual(values, ['new', 'new.mp4', 'video/mp4', 12, 123, 42, 'owner', null]);
});

test('FFprobe accepts a real video and rejects audio or malformed media', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'caption-video-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'fixture.webm');
  await writeFile(file, Buffer.from(await readFile('tests/fixtures/portrait-video.base64', 'utf8'), 'base64'));
  assert.ok(await inspectReplacementVideo({ path: file }) > 0);
  await writeFile(file, 'invalid media'); await assert.rejects(inspectReplacementVideo({ path: file }));
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  await writeFile(file, wav); await assert.rejects(inspectReplacementVideo({ path: file }));
});
