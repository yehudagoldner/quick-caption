import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transcriptions } from 'openai/resources/audio/transcriptions';
import { recoveryPlan, mergeRecoveredTranscript } from '../src/transcriptionRecovery.js';
import { pcmFixture } from './fixtures/audio.mjs';

globalThis.__appEnvLoaded = true;
const { transcribeMedia, transcribeWithWordTimestamps } = await import('../src/transcription.js');
const loop = { id: 0, seek: 0, start: 27.32, end: 28.72, text: 'ו'.repeat(220), compression_ratio: 29.73 };
const tail = { id: 1, seek: 3000, start: 30, end: 32, text: 'סיום' };
const tailWord = { word: 'סיום', start: 31, end: 31.5 };
const base = { segments: [loop, tail], words: [{ word: loop.text, start: 27.32, end: 28.72 }, tailWord] };
const chunkResult = words => ({ segments: [{ start: words[0].start, end: words.at(-1).end, text: words.map(w => w.word).join(' ') }], words });
const recovered = [chunkResult([{ word: 'התחלה', start: 3, end: 4 }, { word: 'גבול', start: 23.4, end: 23.8 }]),
  chunkResult([{ word: 'גבול', start: 1.4, end: 1.8 }, { word: 'המשך', start: 3, end: 4 }, { word: 'וואו', start: 6, end: 7 }, { word: 'סיום', start: 9, end: 9.5 }])];

test('decoding-loop windows include omitted speech, with bounded context and no silence-gap retries', () => {
  assert.deepEqual(recoveryPlan(base.segments, 40), { ranges: [{ start: 0, end: 30 }], chunks: [
    { start: 0, end: 24, cropStart: 0, cropEnd: 26 }, { start: 24, end: 30, cropStart: 22, cropEnd: 32 } ] });
  assert.deepEqual(recoveryPlan([{ start: 27, end: 29, text: 'דיבור אחרי שקט', no_speech_prob: 0.99, compression_ratio: 2.4 }], 40).chunks, []);
  assert.throws(() => recoveryPlan([0, 60, 120].map(seek => ({ ...loop, seek: seek * 100, start: seek + 1, end: seek + 2 })), 180), /Too many/);
  const expanded = recoveryPlan([loop, { ...tail, start: 29, end: 31 }], 40);
  assert.equal(expanded.ranges[0].end, 31, 'a healthy cue crossing the boundary is replaced whole');
});

test('recovery offsets and ownership preserve healthy cues without duplicating overlap words', () => {
  const result = mergeRecoveredTranscript(base, recoveryPlan(base.segments, 40), recovered);
  assert.deepEqual(result.words.map(word => [word.word, word.start, word.end]), [
    ['התחלה', 3, 4], ['גבול', 23.4, 23.8], ['המשך', 25, 26], ['וואו', 28, 29], ['סיום', 31, 31.5] ]);
  assert.ok(result.segments.every((cue, i) => cue.id === i && cue.start < cue.end));
  assert.equal(result.segments.at(-1).text, tail.text);
  assert.equal(result.segments.at(-1).start, tail.start);
  assert.equal(result.text.includes(loop.text), false);
});

test('persistent loops, missing speech times and invalid crop times cannot become a completed partial transcript', () => {
  const plan = recoveryPlan(base.segments, 40);
  assert.throws(() => mergeRecoveredTranscript(base, plan, [recovered[0]]), /Incomplete/);
  assert.throws(() => mergeRecoveredTranscript(base, plan, [{ segments: [loop], words: [] }, recovered[1]]), /loop/);
  assert.throws(() => mergeRecoveredTranscript(base, plan, [{ segments: [{ start: 1, end: 2, text: 'דיבור' }], words: [] }, recovered[1]]), /without word/);
  assert.throws(() => mergeRecoveredTranscript(base, plan, [chunkResult([{ word: 'דיבור', start: 50, end: 51 }]), recovered[1]]), /timestamps/);
});

async function fixture(t, responses) {
  const saved = { ...process.env };
  Object.assign(process.env, { OPENAI_API_KEY: 'no-network', OPENAI_TIMED_MODEL: 'whisper-1', OPENAI_LANGUAGE: 'he',
    OPENAI_HIGH_ACCURACY_MODEL: 'gpt-transcribe', OPENAI_CORRECTION_MODEL: '' });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-recovery-'));
  const inputPath = path.join(directory, 'selection.wav');
  await fs.writeFile(inputPath, pcmFixture(40));
  const requests = [];
  t.mock.method(Transcriptions.prototype, 'create', async request => {
    requests.push({ model: request.model, file: request.file.path, language: request.language });
    if (request.model !== 'whisper-1') return { text: 'התחלה גבול המשך וואו סיום' };
    const response = responses.shift();
    if (!response) throw new Error('Unexpected extra API call');
    return response;
  });
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  return { inputPath, directory, requests, logger: {}, maxWordsPerSubtitle: 0 };
}

test('real FFmpeg crops feed the recovered pipeline before correction and account for every audio request', async t => {
  const context = await fixture(t, [base, ...structuredClone(recovered)]);
  const result = await transcribeMedia(context);
  assert.equal(context.requests.filter(request => request.model === 'whisper-1').length, 3);
  assert.ok(context.requests.every(request => request.language === 'he' || request.model === 'gpt-transcribe'));
  assert.equal(result.words[0].start, 3);
  assert.equal(result.words.find(word => word.word === 'המשך').start, 25);
  assert.deepEqual(result.recovery.ranges, [{ start: 0, end: 30 }]);
  assert.equal(result.recovery.calls, 2);
  assert.ok(result.usage.timedTranscription.durationSeconds > 75, 'initial + both cropped requests are counted');
  assert.ok(result.usage.highAccuracy.durationSeconds < 41, 'text-only fallback uses source duration, not total retry duration');
  assert.match(result.subtitle.content, /00:00:03,000/);
  assert.ok(result.warnings.some(w => w.includes('שוחזר')));
  assert.deepEqual(await fs.readdir(context.directory), ['selection.wav'], 'all prepared and recovery audio is removed');
});

test('a failed recovery stops before extra model calls and cleans all temporary audio', async t => {
  const context = await fixture(t, [base, { segments: [{ ...loop, start: 1, end: 2 }], words: [] }]);
  await assert.rejects(transcribeMedia(context), /לא נשמר תמלול חלקי/);
  assert.equal(context.requests.length, 2);
  assert.deepEqual(await fs.readdir(context.directory), ['selection.wav']);
});

test('word-timestamp exports use the same recovery with global times', async t => {
  const context = await fixture(t, [base, ...structuredClone(recovered)]);
  const result = await transcribeWithWordTimestamps(context);
  assert.equal(result.words.find(word => word.word === 'המשך').start, 25);
  assert.match(result.formattedOutput, /00:00:25,000/);
  assert.equal(context.requests.length, 3);
});
