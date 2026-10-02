import test from 'node:test';
import assert from 'node:assert/strict';
import { audioTranscriptionCost, COST_USD_PER_CREDIT, creditsForCost, creditsToDollars, estimateTranscriptionCredits,
  LOWEST_CREDIT_PRICE_USD, PROFIT_MULTIPLE, textCost, transcriptionCredits, workflowCost } from '../src/creditCalculator.js';
import { configureUsageRecorder, instrumentOpenAI, measureAICost, usageContext } from '../src/aiUsage.js';
import { CREDIT_PACKAGES } from '../src/creditPackages.js';

test('every charge earns at least the profit multiple at the cheapest package, rounded up once', () => {
  assert.equal(PROFIT_MULTIPLE, 10);
  assert.equal(LOWEST_CREDIT_PRICE_USD, Math.min(...CREDIT_PACKAGES.map(p => Number(p.priceUSD) / p.credits)));
  for (const cost of [0.0001, 0.0047, 0.006, 0.0105, 0.0136, 0.05, 0.12, 0.72, 3.3]) {
    const credits = creditsForCost(cost);
    assert.ok(credits * LOWEST_CREDIT_PRICE_USD >= PROFIT_MULTIPLE * cost - 1e-12, `cost ${cost}`);
    assert.ok((credits - 1) * COST_USD_PER_CREDIT < cost, `cost ${cost} rounded more than once`);
  }
  assert.equal(creditsForCost(0), 0);
  assert.equal(creditsForCost(Number.NaN), 0);
  assert.equal(creditsForCost(0.003), 1);
  assert.equal(creditsToDollars(100), `$${(100 * LOWEST_CREDIT_PRICE_USD).toFixed(2)}`);
});

test('audio and text costs use the shared model rates, unknown models are not free', () => {
  assert.ok(Math.abs(audioTranscriptionCost(60, 'whisper-1') - 0.36) < 1e-12);
  assert.ok(Math.abs(audioTranscriptionCost(60, 'gpt-transcribe') - 0.27) < 1e-12);
  assert.equal(audioTranscriptionCost(60, 'future-audio-model'), audioTranscriptionCost(60, 'whisper-1'));
  assert.ok(Math.abs(textCost(100000, 100000, 50000, { model: 'gpt-6-luna' }) - 0.0555) < 1e-12);
  assert.ok(Math.abs(textCost(100000, 100000, 50000, { model: 'gpt-6-luna', serviceTier: 'fast' }) - 0.111) < 1e-12);
  assert.equal(textCost(1000, 1000, 0, { model: 'future-text-model' }), textCost(1000, 1000, 0, { model: 'gpt-5' }));
});

test('finished jobs are charged from the larger of measured cost and reported stage usage', () => {
  const usage = {
    timedTranscription: { model: 'whisper-1', durationMinutes: 1 },
    highAccuracy: { model: 'gpt-transcribe', durationMinutes: 1 },
    correction: { model: 'gpt-6-luna', inputTokens: 1500, outputTokens: 5000, cachedTokens: 0, serviceTier: 'default' },
  };
  const stages = workflowCost(usage);
  assert.ok(Math.abs(stages - 0.01315) < 1e-12);
  assert.equal(transcriptionCredits(usage), creditsForCost(stages));
  assert.equal(transcriptionCredits(usage, 0.02), creditsForCost(0.02));
  assert.equal(transcriptionCredits(usage, 0.001), creditsForCost(stages));
  assert.equal(transcriptionCredits({}, 0), 0);
});

test('the pre-check estimate covers a typical measured job', () => {
  const options = { timedModel: 'whisper-1', highAccuracyModel: 'gpt-transcribe', correctionModel: 'gpt-6-luna' };
  // Measured: 63 s of audio cost $0.0136 in total.
  assert.ok(estimateTranscriptionCredits(63 / 60, options) >= creditsForCost(0.0136));
  assert.equal(estimateTranscriptionCredits(1, { ...options, highAccuracyModel: 'none', correctionModel: 'none' }), creditsForCost(0.006));
});

test('measureAICost sums the priced calls made inside one job only', async t => {
  configureUsageRecorder(async () => {});
  t.after(() => configureUsageRecorder(undefined));
  const client = instrumentOpenAI({
    responses: { create: async () => ({ usage: { input_tokens: 1000, output_tokens: 2000 } }) },
    chat: { completions: { create: async () => ({}) } },
    audio: { transcriptions: { create: async ({ model }) => ({ text: 'x', ...(model === 'whisper-1' ? { duration: 60 } : {}) }) } },
  }, async () => 30);
  const measured = await new Promise((resolve, reject) => usageContext({ path: '/api/transcribe', body: {} }, null, () => {
    measureAICost(async () => {
      await client.audio.transcriptions.create({ model: 'whisper-1', file: { path: 'a.mp3' } });
      await client.audio.transcriptions.create({ model: 'gpt-transcribe', file: { path: 'a.mp3' } });
      await client.responses.create({ model: 'gpt-6-luna' });
      await client.responses.create({ model: 'unknown-model' });
      return 'done';
    }).then(resolve, reject);
  }));
  assert.equal(measured.value, 'done');
  assert.equal(measured.measured, true);
  assert.equal(measured.calls, 4);
  assert.equal(measured.unpricedCalls, 1);
  assert.ok(Math.abs(measured.costUSD - (0.006 + 0.00225 + 0.0011)) < 1e-12);
});
