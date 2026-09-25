import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateActualCredits, calculateAudioTranscriptionCredits, calculateTextCredits,
  calculateGPT5Credits, estimateTranscriptionCredits } from '../src/creditCalculator.js';

test('new transcription uses its duration rate without changing Whisper pricing', () => {
  assert.equal(calculateAudioTranscriptionCredits(60, 'gpt-transcribe'), 11);
  assert.equal(calculateAudioTranscriptionCredits(60, 'whisper-1'), 15);
});

test('Luna uses actual Standard/Fast tier, cached input and long-context prices', () => {
  const usage = { model: 'gpt-6-luna', inputTokens: 100000, outputTokens: 100000, cachedTokens: 50000 };
  assert.equal(calculateActualCredits({ ...usage, serviceTier: 'default' }), 3);
  assert.equal(calculateActualCredits({ ...usage, serviceTier: 'fast' }), 5);
  assert.equal(calculateActualCredits({ ...usage, serviceTier: 'priority' }), 5);
  assert.equal(calculateTextCredits(300000, 100000, 0, { model: 'gpt-6-luna', serviceTier: 'fast' }), 11);
});

test('legacy text pricing is unchanged and workflow estimate uses new model prices', () => {
  assert.equal(calculateTextCredits(10000, 1000, 2000, { model: 'gpt-5' }), calculateGPT5Credits(10000, 1000, 2000));
  assert.equal(estimateTranscriptionCredits(60, {
    timedModel: 'whisper-1', highAccuracyModel: 'gpt-transcribe', correctionModel: 'gpt-6-luna', serviceTier: 'fast',
  }), 27);
});
