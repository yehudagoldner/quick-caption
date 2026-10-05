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

test('multiple selected languages replace the environment hint throughout transcription', async t => {
  const context = await setup(t);
  await transcribeMedia({ ...context, languages: ['en', 'ar'] });
  const [timed, accurate] = context.audioRequests;
  assert.equal(timed.language, undefined);
  assert.match(timed.prompt, /English, Arabic/);
  assert.deepEqual(accurate.languages, ['en', 'ar']);
  assert.equal(Object.hasOwn(accurate, 'language'), false);
  assert.match(context.textRequests[0].input[0].content[0].text, /en, ar/);
  assert.match(context.textRequests[0].input[0].content[0].text, /Output ALL subtitle text in English \(en\)/);
});

test('an empty language selection defaults to Hebrew output', async t => {
  const context = await setup(t, { legacy: true });
  const result = await transcribeMedia({ ...context, languages: [] });
  assert.equal(context.audioRequests[0].language, 'he');
  assert.equal(context.audioRequests[1].language, 'he');
  assert.equal(context.audioRequests[1].prompt, undefined);
  assert.deepEqual(result.segments, [segment]);
});

for (const target of ['he', 'en']) {
  test(`mixed-language captions are rendered in ${target} with preserved cue times`, async t => {
    const context = await setup(t);
    const source = [{ id: 1, start: 0, end: 2, text: 'שלום עולם' }, { id: 2, start: 2, end: 4, text: 'Hello world' }, { id: 3, start: 4, end: 6, text: 'مرحبا بالعالم' }];
    const translated = source.map(s => ({ ...s, start: 99, end: 100, text: target === 'he' ? 'שלום עולם' : 'Hello world' }));
    t.mock.method(Transcriptions.prototype, 'create', async request => {
      context.audioRequests.push(request);
      request.file.destroy();
      return request.model === 'whisper-1' ? { segments: source, text: source.map(s => s.text).join(' ') } : { text: source.map(s => s.text).join(' ') };
    });
    t.mock.method(Responses.prototype, 'create', async request => {
      context.textRequests.push(request);
      return { output_text: JSON.stringify({ segments: translated }) };
    });
    const selected = target === 'he' ? ['he', 'en', 'ar'] : ['en', 'he', 'ar'];
    const result = await transcribeMedia({ ...context, languages: selected });
    assert.deepEqual(context.audioRequests[1].languages, selected);
    assert.equal(context.audioRequests[0].language, undefined);
    assert.match(context.audioRequests[0].prompt, /Preserve each spoken language without translating/);
    const systemPrompt = context.textRequests[0].input[0].content[0].text;
    assert.match(systemPrompt, new RegExp(`Output ALL subtitle text in ${target === 'he' ? 'Hebrew' : 'English'}`));
    assert.match(systemPrompt, /faithfully translate/);
    assert.deepEqual(result.segments.map(s => [s.id, s.start, s.end]), source.map(s => [s.id, s.start, s.end]));
    assert.deepEqual(result.segments.map(s => s.text), translated.map(s => s.text));
    assert.ok(result.words.every(w => w.start >= 0 && w.end <= 6 && w.start < w.end));
    assert.match(result.subtitle.content, target === 'he' ? /שלום עולם/ : /Hello world/);
    const payload = JSON.parse(context.textRequests[0].input[2].content[0].text);
    assert.equal(payload.target_language, target);
    assert.deepEqual(payload.expected_spoken_languages, selected);
  });
}

test('translation failure cannot silently return captions in the source languages', async t => {
  const context = await setup(t, { failCorrection: true });
  await assert.rejects(() => transcribeMedia({ ...context, languages: ['he', 'en'] }), /התמלול או התרגום/);
});

for (const mode of ['original', 'translate', 'transliterate']) {
  test(`explicit ${mode} mode preserves the primary language, cues and output word alignment`, async t => {
    const context = await setup(t);
    process.env.OPENAI_TRANSLATE = 'true';
    const source = [
      { id: 1, start: 0, end: 2, text: 'שלום עולם' },
      { id: 2, start: 2, end: 4, text: 'Good morning' },
      { id: 3, start: 4, end: 6, text: 'שלום Good morning' },
    ];
    const foreign = { original: 'Good morning', translate: 'בוקר טוב', transliterate: 'גוד מורנינג' }[mode];
    const output = ['שלום עולם', foreign, `שלום ${foreign}`];
    t.mock.method(Transcriptions.prototype, 'create', async request => {
      context.audioRequests.push(request);
      request.file.destroy();
      return { segments: source, text: source.map(s => s.text).join(' ') };
    });
    t.mock.method(Responses.prototype, 'create', async request => {
      context.textRequests.push(request);
      return { output_text: JSON.stringify({ segments: source.map((s, i) => ({ ...s, start: 99, end: 100, text: output[i] })).reverse() }) };
    });
    const result = await transcribeMedia({ ...context, languages: ['he', 'en'], secondaryLanguageMode: mode });
    assert.equal(context.audioRequests[0].translate, false, 'audio transcription must preserve source languages before applying the display mode');
    const prompt = context.textRequests[0].input[0].content[0].text;
    assert.match(prompt, /primary language is Hebrew \(he\)/);
    assert.match(prompt, /including code-switching within a segment/);
    assert.match(prompt, mode === 'original' ? /Never translate or transliterate/ : mode === 'translate' ? /translate speech.*into Hebrew/ : /Phonetically transliterate.*Hebrew letters/);
    const payload = JSON.parse(context.textRequests[0].input[2].content[0].text);
    assert.equal(payload.secondary_language_mode, mode);
    assert.equal(payload.primary_language, 'he');
    assert.deepEqual(result.segments, source.map((s, i) => ({ ...s, text: output[i] })));
    assert.deepEqual(result.words.map(w => w.word), output.join(' ').split(' '));
    assert.match(result.subtitle.content, new RegExp(foreign));
    assert.ok(result.words.every(w => w.start >= 0 && w.end <= 6 && w.start < w.end));
  });
}

test('Hebrew translation preserves a non-Hebrew primary language in its original script', async t => {
  const context = await setup(t);
  await transcribeMedia({ ...context, languages: ['en', 'ar'], secondaryLanguageMode: 'translate' });
  const prompt = context.textRequests[0].input[0].content[0].text;
  assert.match(prompt, /primary language is English \(en\); keep speech in this language in its original language and script/);
  assert.match(prompt, /translate speech in languages other than the primary language into Hebrew/);
});

test('transliteration runs with correction disabled and fails rather than returning source text', async t => {
  const context = await setup(t);
  process.env.OPENAI_CORRECTION_MODEL = '';
  await transcribeMedia({ ...context, languages: ['he', 'en'], secondaryLanguageMode: 'transliterate' });
  assert.equal(context.textRequests.length, 1);
  t.mock.method(Responses.prototype, 'create', async () => { throw new Error('conversion failed'); });
  await assert.rejects(() => transcribeMedia({ ...context, languages: ['he', 'en'], secondaryLanguageMode: 'transliterate' }), /התעתיק/);
});

for (const mode of ['translate', 'transliterate']) {
  test(`${mode} rejects nonempty conversion text with a missing source id`, async t => {
    const context = await setup(t);
    t.mock.method(Responses.prototype, 'create', async () => ({ output_text: JSON.stringify({ segments: [{ ...segment, id: 999 }] }) }));
    await assert.rejects(() => transcribeMedia({ ...context, languages: ['he', 'en'], secondaryLanguageMode: mode }), /התמלול או התרגום/);
  });
}

test('translation still runs when optional correction is disabled', async t => {
  const context = await setup(t);
  process.env.OPENAI_CORRECTION_MODEL = '';
  const result = await transcribeMedia({ ...context, languages: ['he', 'en'] });
  assert.equal(context.textRequests.length, 1);
  assert.equal(result.models.correction, 'gpt-6-luna');
});

test('incomplete translation cannot mix translated captions with untranslated source cues', async t => {
  const context = await setup(t);
  t.mock.method(Responses.prototype, 'create', async () => ({ output_text: JSON.stringify({ segments: [] }) }));
  await assert.rejects(() => transcribeMedia({ ...context, languages: ['he', 'en'] }), /התמלול או התרגום/);
});

test('word limits and unlimited captions produce distinct output', async t => {
  const context = await setup(t);
  const limited = await transcribeMedia({ ...context, maxWordsPerSubtitle: 1 });
  const unlimited = await transcribeMedia({ ...context, maxWordsPerSubtitle: 0 });
  assert.deepEqual(limited.segments.map(s => s.text), ['שלום', 'עולם']);
  assert.deepEqual(unlimited.segments, [segment]);
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
