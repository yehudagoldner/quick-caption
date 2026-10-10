import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Transcriptions } from 'openai/resources/audio/transcriptions';
import { probeAudio, decodeAudio, compareSamples } from '../scripts/audio-audit-metrics.mjs';

globalThis.__appEnvLoaded = true;
const { transcribeMedia } = await import('../src/transcription.js');

test('video and Premiere PCM use one float mono MP3 preparation path with cleanup and matching level', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'caption-audio-prep-'));
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-no-network';
  const streams = [];
  t.after(async () => {
    for (const stream of streams) stream.destroy();
    await Promise.all(streams.map(s => s.closed ? null : new Promise(resolve => s.once('close', resolve))));
    await fsp.rm(dir, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  const source = path.join(dir, 'video.mp4'), wav = path.join(dir, 'premiere.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=517:sample_rate=44100:duration=2', '-ac', '2', '-c:a', 'aac', source]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', source, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
  const captured = [];
  const sentinel = new Error('Stop before network');
  t.mock.method(Transcriptions.prototype, 'create', async request => {
    streams.push(request.file);
    const output = path.join(dir, `captured-${captured.length}${path.extname(request.file.path)}`);
    await fsp.copyFile(request.file.path, output);
    captured.push({ uploadPath: request.file.path, output, language: request.language });
    throw sentinel;
  });
  for (const inputPath of [source, wav]) {
    await assert.rejects(transcribeMedia({ inputPath, languages: ['he'], secondaryLanguageMode: 'original', logger: {} }), e => e === sentinel);
  }
  assert.deepEqual(captured.map(x => x.language), ['he', 'he']);
  assert.notEqual(captured[0].uploadPath, source);
  assert.notEqual(captured[1].uploadPath, wav);
  assert.equal(fs.existsSync(captured[0].uploadPath), false, 'converted temporary audio is cleaned after failure');
  assert.ok(fs.existsSync(wav), 'an original audio input must never be cleaned');
  const videoUpload = probeAudio(captured[0].output), premiereUpload = probeAudio(captured[1].output);
  assert.equal(videoUpload.codec_name, 'mp3');
  assert.equal(videoUpload.sample_rate, '16000');
  assert.equal(videoUpload.channels, 1);
  assert.equal(premiereUpload.codec_name, 'mp3');
  assert.equal(premiereUpload.sample_rate, '16000');
  assert.equal(premiereUpload.channels, 1);
  assert.equal(fs.existsSync(captured[1].uploadPath), false);
  const comparison = compareSamples(decodeAudio(captured[0].output), decodeAudio(captured[1].output), { start: 0.1, end: 1.8 });
  assert.ok(comparison.correlation > 0.98);
  assert.ok(Math.abs(comparison.gainDb) < 0.5);
  assert.deepEqual((await fsp.readdir(dir)).filter(name => name.startsWith('.caption-audio-')), []);
});
