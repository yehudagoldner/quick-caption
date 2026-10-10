// Real private media stays in ignored tmp/. Run explicitly with
// QC_AUDIO_AUDIT_DIR=.../local-prepared; this test never invokes an API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { qualitySummary } from '../scripts/audio-audit-metrics.mjs';

const directory = process.env.QC_AUDIO_AUDIT_DIR;
test('the actual Brits Premiere export retains the intro and canonical WAV keeps every sample', { skip: !directory }, () => {
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'preparation.json')));
  const raw = report.variants.find(v => v.name === 'premiere.wav');
  assert.ok(Math.abs(raw.duration - report.source.duration) < 0.1);
  assert.ok(raw.prefix.correlation > 0.995, 'intro PCM must match, allowing decoder delay');
  assert.ok(Math.abs(raw.prefix.gainDb) < 0.1, 'float mono decode retains source level; this does not prove identical integer mono conversion');
  assert.ok(Math.abs(raw.prefix.lagSeconds) < 0.05, 'the difference is milliseconds, not a missing 27-second intro');
  const decodedHash = filename => execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(directory, filename),
    '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).trim();
  assert.equal(decodedHash('premiere.wav'), decodedHash('premiere-canonical.wav'),
    'a container/control comparison must keep exactly the same decoded audio samples');
  for (const name of ['app.mp3', 'premiere-normalized.mp3', 'premiere-mono16.wav', 'premiere-mono48.wav']) {
    const v = report.variants.find(v => v.name === name);
    assert.ok(v.prefix.correlation > 0.995, `${name} must retain the spoken intro`);
    assert.ok(Math.abs(v.duration - report.source.duration) < 0.15);
  }
});

const resultsPath = process.env.QC_AUDIO_AUDIT_RESULTS;
test('recorded paid QA evidence reproduces the missing intro, gain controls and raw decoding loop', { skip: !resultsPath }, () => {
  // Read recorded responses only. Re-running this test cannot incur API charges.
  const evidence = JSON.parse(fs.readFileSync(resultsPath, 'utf8').replace(/^\uFEFF/, ''));
  const main = evidence.documents['calls.json'], controls = evidence.documents['control-calls.json'];
  assert.equal(main.length, 12);
  assert.equal(controls.length, 4);
  assert.ok([...main, ...controls].every(call => call.status === 'completed'));
  for (const call of main) {
    const successful = call.id.startsWith('app.mp3:');
    assert.equal(call.summary.wordsBeforeBoundary, successful ? 58 : 0);
    const resultName = call.id.replace(/:(\d+)$/, '.$1.json');
    const first = qualitySummary(evidence.documents[resultName])[0];
    assert.equal(first.repeatedLetter, !successful, resultName);
  }
  const find = name => controls.find(call => call.id === `${name}:1`).summary;
  assert.equal(find('app-attenuated.mp3').wordsBeforeBoundary, 0);
  assert.equal(find('premiere-padded.wav').wordsBeforeBoundary, 0);
  assert.equal(find('premiere-boosted.mp3').wordsBeforeBoundary, 55);
  assert.equal(find('premiere-first26.wav').wordsBeforeBoundary, 44);
  // Gain-filter insertion changes FFmpeg's sample negotiation as well as gain:
  // measured boost is ~6 dB, so claiming a pure +3 dB recovery would be wrong.
  const rms = name => evidence.volumes[name].prefixRmsDb;
  assert.ok(Math.abs(rms('app.mp3') - rms('premiere-normalized.mp3') - 3) < 0.1);
  assert.ok(Math.abs(rms('app-attenuated.mp3') - rms('premiere-normalized.mp3')) < 0.1);
  assert.ok(rms('premiere-boosted.mp3') - rms('premiere-normalized.mp3') > 5.5);
});

const fixDirectory = process.env.QC_AUDIO_FIX_DIR;
test('the actual fixed Premiere upload matches the application level and retains intro samples', { skip: !fixDirectory }, () => {
  const report = JSON.parse(fs.readFileSync(path.join(fixDirectory, 'preparation.json')));
  const app = report.variants.find(variant => variant.name === 'app.mp3');
  const premiere = report.variants.find(variant => variant.name === 'premiere-upload.mp3');
  assert.equal(premiere.channels, 1);
  assert.equal(premiere.sample_rate, '16000');
  assert.equal(premiere.codec_name, 'mp3');
  assert.ok(premiere.prefix.correlation > 0.995);
  assert.ok(Math.abs(premiere.prefix.gainDb - app.prefix.gainDb) < 0.1, 'the codec-dependent ~3 dB reduction must not return');
});

const fixResults = process.env.QC_AUDIO_FIX_RESULTS;
test('saved real QA fix responses recover the intro and source-PCM recovery preserves global times', { skip: !fixResults }, () => {
  const evidence = JSON.parse(fs.readFileSync(fixResults, 'utf8').replace(/^\uFEFF/, ''));
  const full = evidence.documents['normalized-premiere.json'];
  const recovery = evidence.documents['source-pcm-loop-recovery.json'];
  assert.ok(full.segments[0].start < 5);
  assert.ok(full.words.filter(word => word.start < 27.3).length >= 40);
  assert.ok(recovery.words.filter(word => word.start < 27.3).length >= 40);
  assert.ok(recovery.words.some(word => word.start > 70));
  assert.ok(recovery.words.every(word => word.start >= 0 && word.start < word.end && word.end < 76));
  assert.equal(recovery.recovery.calls, 2);
  assert.equal(evidence.documents['ledger.json'].length, 4);
  assert.ok(evidence.documents['ledger.json'].every(call => call.status === 'completed'));
  assert.ok(evidence.documents['summary.json'].estimatedUSD <= 0.04);
});
