import test from 'node:test';
import assert from 'node:assert/strict';
import { pluginPolicy, currentTranscriptionModels, quoteTranscription, pluginVersionSupported } from '../src/pluginPolicy.js';
import { estimateTranscriptionCredits } from '../src/creditCalculator.js';
import { pluginRouteAllowed } from '../src/pluginSessions.js';
import { segmentsToSrt } from '../src/subtitleSrt.js';
import pricing from '../premiere-plugin/credit-estimate.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('local estimates use published current rules and match server quotes including token and credit rounding',()=>{
  const saved={...process.env};
  try {
    for(const correction of ['gpt-5','gpt-5-mini','none','unknown']) for(const accuracy of ['gpt-4o-transcribe','none']) for(const tier of ['default','priority','flex']) {
      process.env.OPENAI_CORRECTION_MODEL=correction;process.env.OPENAI_HIGH_ACCURACY_MODEL=accuracy;process.env.OPENAI_TEXT_SERVICE_TIER=tier;
      const policy=pluginPolicy();
      for(const seconds of [.001,1,24,59.999,60,60.001,168.234397,301,3600]) assert.equal(pricing.estimateCreditsFromRules(seconds,policy.creditEstimate),quoteTranscription(seconds),`${correction}/${accuracy}/${tier}/${seconds}`);
    }
  } finally { for(const key of ['OPENAI_CORRECTION_MODEL','OPENAI_HIGH_ACCURACY_MODEL','OPENAI_TEXT_SERVICE_TIER']) { if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]; } }
});

test('the plugin estimator is generated from the shared calculation and rejects unknown rules',async()=>{
  const source=await readFile(new URL('../src/creditEstimate.js',import.meta.url),'utf8'),copy=await readFile(new URL('../premiere-plugin/credit-estimate.js',import.meta.url),'utf8');
  assert.ok(copy.includes(createHash('sha256').update(source).digest('hex')));
  assert.throws(()=>pricing.estimateCreditsFromRules(60,{version:2}));
});

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
