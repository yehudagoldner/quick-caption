import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transcriptions } from 'openai/resources/audio/transcriptions';
import { Responses } from 'openai/resources/responses/responses';

// Unit tests must never load local credentials or contact the real API.
globalThis.__appEnvLoaded = true;
const { transcribeMedia, aiEditSubtitles, intelligentSplitSegment, resegmentWithGPT } =
  await import('../src/transcription.js');
const segment = { id: 7, start: 0, end: 2, text: 'שלום עולם' };
const words = [{ word: 'שלום', start: 0.1, end: 0.8 }, { word: 'עולם', start: 1.1, end: 1.8 }];

async function setup(t, { failAudio = false, failCorrection = false, legacy = false } = {}) {
  const savedEnv = { ...process.env };
  Object.assign(process.env, {
    OPENAI_API_KEY: 'unit-test-no-network', OPENAI_LANGUAGE: 'he',
    OPENAI_TIMED_MODEL: 'whisper-1',
    OPENAI_HIGH_ACCURACY_MODEL: legacy ? 'gpt-4o-transcribe' : 'gpt-transcribe',
    OPENAI_CORRECTION_MODEL: 'gpt-6-luna', OPENAI_EDIT_MODEL: 'gpt-6-luna',
    OPENAI_SPLIT_MODEL: 'gpt-6-luna', OPENAI_RESEGMENT_MODEL: 'gpt-6-luna',
    OPENAI_TEXT_SERVICE_TIER: 'fast',
  });
  if (legacy) delete process.env.OPENAI_TEXT_SERVICE_TIER;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-models-'));
  const inputPath = path.join(dir, 'sample.wav');
  await fs.writeFile(inputPath, 'fake audio consumed only by mock');
  const audioRequests = [];
  const textRequests = [];
  const streams = [];
  t.after(async () => {
    streams.forEach(s => s.destroy());
    // Wait until all file handles close before removing the fixture on Windows.
    await Promise.all(streams.map(s => s.closed ? null : new Promise(resolve => s.once('close', resolve))));
    await fs.rm(dir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  });
  t.mock.method(Transcriptions.prototype, 'create', async request => {
    streams.push(request.file);
    audioRequests.push(request);
    if (request.model === 'whisper-1') return { text: segment.text, segments: [segment], words };
    if (failAudio) throw new Error('Transcription unavailable');
    return { text: segment.text }; // No segment timestamps in gpt-transcribe output.
  });
  t.mock.method(Responses.prototype, 'create', async request => {
    textRequests.push(request);
    if (failCorrection) throw new Error('Correction unavailable');
    return {
      output_text: JSON.stringify({ segments: [{ ...segment, start: 99, end: 100 }] }),
      service_tier: 'fast',
      usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 30 } },
    };
  });
  return { inputPath, maxWordsPerSubtitle: 0, logger: {}, audioRequests, textRequests };
}

test('new models keep Whisper word times, use languages and request Fast only for text', async t => {
  const context = await setup(t);
  const result = await transcribeMedia(context);
  const [timed, accurate] = context.audioRequests;
  assert.deepEqual(timed.timestamp_granularities, ['word', 'segment']);
  assert.equal(timed.language, 'he');
  assert.equal(timed.response_format, 'verbose_json');
  assert.deepEqual(accurate.languages, ['he']);
  for (const field of ['language', 'timestamp_granularities', 'temperature', 'translate', 'service_tier']) {
    assert.equal(Object.hasOwn(accurate, field), false, field);
  }
  const request = context.textRequests[0];
  assert.equal(request.model, 'gpt-6-luna');
  assert.equal(request.service_tier, 'fast');
  assert.equal(request.reasoning.effort, 'medium');
  assert.equal(request.text.format.type, 'json_object');
  assert.deepEqual(result.segments, [segment], 'correction cannot move source timestamps');
  assert.deepEqual(result.words.map(w => [w.start, w.end]), words.map(w => [w.start, w.end]));
  assert.equal(result.usage.highAccuracy.durationSeconds, 2, 'text-only response must not erase duration');
  assert.equal(result.usage.correction.cachedTokens, 30);
  assert.equal(result.usage.correction.serviceTier, 'fast');
  assert.equal(result.warnings.length, 0);
});

test('legacy transcription configuration remains usable without a service tier override', async t => {
  const context = await setup(t, { legacy: true });
  await transcribeMedia(context);
  assert.equal(context.audioRequests[1].language, 'he');
  assert.equal(context.audioRequests[1].languages, undefined);
  assert.equal(Object.hasOwn(context.textRequests[0], 'service_tier'), false);
});

test('failed new models preserve the timed transcript and report both stage failures', async t => {
  const context = await setup(t, { failAudio: true, failCorrection: true });
  const result = await transcribeMedia(context);
  assert.deepEqual(result.segments, [segment]);
  assert.equal(result.models.highAccuracy, null);
  assert.equal(result.warnings.filter(w => w.includes('failed')).length, 2);
  assert.equal(result.words.length, 2);
});

test('editing, splitting and resegmenting all use Luna Fast and retain original word boundaries', async t => {
  await setup(t);
  const requests = [];
  const outputs = [JSON.stringify({ segments: [segment] }), JSON.stringify({ splitAfterIndex: 0 }), 'שלום\nעולם'];
  t.mock.method(Responses.prototype, 'create', async request => {
    requests.push(request);
    return { output_text: outputs.shift() };
  });
  const edited = await aiEditSubtitles([segment], words, 'שמור את הטקסט');
  const split = await intelligentSplitSegment(segment, words, 1);
  const resegmented = await resegmentWithGPT(words, 1);
  assert.equal(edited.segments[0].text, segment.text);
  assert.equal(split.segments[0].end, words[0].end);
  assert.equal(split.segments[1].start, words[1].start);
  assert.deepEqual(resegmented.map(s => [s.start, s.end]), words.map(w => [w.start, w.end]));
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.model, 'gpt-6-luna');
    assert.equal(request.service_tier, 'fast');
    assert.equal(request.reasoning.effort, 'medium');
    assert.equal(request.temperature, undefined);
  }
});
