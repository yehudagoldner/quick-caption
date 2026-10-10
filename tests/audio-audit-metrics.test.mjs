import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSamples, coverageSummary, qualitySummary } from '../scripts/audio-audit-metrics.mjs';

const signal = Float64Array.from({ length: 8000 }, (_, i) => Math.sin(i * 0.13) * Math.cos(i * 0.003) + Math.sin(i * 0.049) * 0.3);

test('sample comparison distinguishes delay and attenuation from dropped audio', () => {
  const delayed = new Float64Array(signal.length + 11);
  delayed.set(signal.map(x => x * 0.5), 11);
  const same = compareSamples(signal, delayed, { rate: 1000, maxLag: 20 });
  assert.ok(same.correlation > 0.999999);
  assert.equal(same.lagSeconds, 0.011);
  assert.ok(Math.abs(same.gainDb + 6.0206) < 0.0001);
  const missing = Float64Array.from(signal, (x, i) => i < 3500 ? 0 : x);
  const head = compareSamples(signal, missing, { rate: 1000, end: 3, maxLag: 20 });
  assert.equal(head.correlation, 0);
  assert.equal(head.candidateRmsDb, null);
});

test('coverage counts timestamped speech rather than treating silence as missing words', () => {
  assert.deepEqual(coverageSummary({ segments: [{ start: 27.32, end: 29, text: 'tail' }], words: [{ start: 27.5, word: 'tail' }] }),
    { firstStart: 27.32, lastEnd: 29, segments: 1, words: 1, wordsBeforeBoundary: 0, prefixText: '' });
  assert.equal(coverageSummary({ segments: [{ start: 2.7, end: 4, text: 'speech' }], words: [{ start: 2.8 }] }).wordsBeforeBoundary, 1);
});

test('raw model diagnostics expose a Hebrew decoding loop without treating silence probability as proof', () => {
  const samples = qualitySummary({ segments: [
    { start: 27.32, end: 28.72, text: 'ו'.repeat(220), compression_ratio: 29.733, no_speech_prob: 0.615 },
    { start: 2.72, end: 4.98, text: 'תודה רבה לכם, זה טוב!', compression_ratio: 2.145, no_speech_prob: 0.613 },
    { start: 10, end: 12, text: 'תודה רבה', no_speech_prob: 0.98 },
  ] });
  assert.equal(samples[0].repeatedLetter, true);
  assert.equal(samples[0].suspicious, true);
  assert.equal(samples[1].suspicious, false);
  assert.equal(samples[2].suspicious, false);
  assert.equal(samples[2].compressionRatio, null);
});
