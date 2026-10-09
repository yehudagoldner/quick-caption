import test from 'node:test';
import assert from 'node:assert/strict';
import { pluginPolicy, currentTranscriptionModels, quoteTranscription, pluginVersionSupported } from '../src/pluginPolicy.js';
import { estimateTranscriptionCredits } from '../src/creditCalculator.js';
import { pluginRouteAllowed } from '../src/pluginSessions.js';
import { segmentsToSrt } from '../src/subtitleSrt.js';

test('plugin quotes and uploads use the same model settings and credit rules', () => {
  for (const seconds of [1, 60, 300, 3600]) assert.equal(quoteTranscription(seconds), estimateTranscriptionCredits(seconds / 60, currentTranscriptionModels()));
  for (const duration of [0, -1, '60', Infinity, NaN, null]) assert.throws(() => quoteTranscription(duration));
});
test('changing server model rules changes the policy version and estimate immediately', () => {
  const original = process.env.OPENAI_HIGH_ACCURACY_MODEL;
  try {
    process.env.OPENAI_HIGH_ACCURACY_MODEL = 'gpt-4o-transcribe';
    const version = pluginPolicy().version, credits = quoteTranscription(600);
    process.env.OPENAI_HIGH_ACCURACY_MODEL = 'none';
    assert.notEqual(pluginPolicy().version, version);
    assert.ok(quoteTranscription(600) < credits);
  } finally {
    if (original === undefined) delete process.env.OPENAI_HIGH_ACCURACY_MODEL;
    else process.env.OPENAI_HIGH_ACCURACY_MODEL = original;
  }
});
test('plugin sessions cannot reach payment, admin or editing endpoints', () => {
  for (const path of ['/admin/session', '/payments/capture-order', '/users/sync', '/videos/1/subtitles', '/ai-edit-subtitles']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.equal(pluginRouteAllowed(method, path), false, `${method} ${path}`);
  }
  assert.ok(pluginRouteAllowed('GET', '/plugin/videos/1/subtitles'));
  assert.ok(pluginRouteAllowed('GET', '/users/credits'));
  assert.ok(pluginRouteAllowed('POST', '/transcribe'));
  assert.equal(pluginRouteAllowed('DELETE', '/transcribe'), false);
});
test('the server can require a plugin update before paid processing', () => {
  const policy = { minPluginVersion: '1.2.0' };
  assert.equal(pluginVersionSupported('1.1.9', policy), false);
  assert.equal(pluginVersionSupported('1.2.0', policy), true);
  assert.equal(pluginVersionSupported('2.0.0', policy), true);
  assert.equal(pluginVersionSupported(undefined, policy), false);
});
test('website and plugin SRT share rounding, Unicode and line breaks', () => {
  assert.equal(segmentsToSrt([{ start: 59.9996, end: 62.5, text: 'שלום\nעולם' }]), '1\n00:01:00,000 --> 00:01:02,500\nשלום\nעולם\n');
});
