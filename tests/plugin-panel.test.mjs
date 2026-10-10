import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import clientModule from '../premiere-plugin/client.js';
import selection from '../premiere-plugin/selection.js';
import storageJson from '../premiere-plugin/storage-json.js';
import bridgeModule from '../premiere-plugin/bridge.js';
import settingsModule from '../premiere-plugin/transcription-settings.js';
import captionPlacement from '../premiere-plugin/caption-placement.js';
import { pluginPolicy } from '../src/pluginPolicy.js';
import { parseTranscriptionSettings } from '../src/transcriptionSettings.js';

const source = await readFile(new URL('../premiere-plugin/panel.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../premiere-plugin/index.html', import.meta.url), 'utf8');

async function openPanel({ connected = true, offline = false, finished = true, job = null, placement = null, selectionSnapshot = null, policy = pluginPolicy(), savedSettings = null } = {}) {
  const makeNode = () => ({ children: [], handlers: new Map(), appendChild(child) { this.children.push(child); }, addEventListener(name, callback) { this.handlers.set(name, callback); } });
  const nodes = new Map([...html.matchAll(/<[\w-]+\b[^>]*\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => [id, {
    id, hidden: /\bhidden\b/.test(tag), textContent: '', value: id === 'language' ? 'he' : '', attributes: new Map(), handlers: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    children: [], appendChild(child) { this.children.push(child); }, remove() {}, addEventListener(name, callback) { this.handlers.set(name, callback); },
  }]));
  const stored = new Map();
  if (savedSettings) stored.set('transcription-settings', JSON.stringify(savedSettings));
  if (connected) stored.set('account', JSON.stringify({ user: { uid: 'fixture-user' }, accessToken: 'fixture-token', expiresAt: Date.now() + 600000 }));
  stored.set('pending-job:fixture-user', JSON.stringify(job || { uid: 'fixture-user', id: 'fixture-job', finished }));
  const calls = [];
  const requests = [];
  const openedPanels = [];
  let entrypoints;
  const fetcher = async (url, options) => {
    calls.push(url);
    requests.push({ url, options });
    if (offline) throw new Error('אין חיבור לשרת');
    if (url.includes('/api/transcribe/jobs/')) return { ok: true, status: 200, json: async () => ({ status: 'completed', result: { videoId: 42, creditsUsed: 3 } }) };
    if (url.endsWith('/subtitles')) return { ok: true, status: 200, json: async () => ({ srt: '1\n00:00:00,500 --> 00:00:02,000\nשלום\n\n2\n00:00:04,500 --> 00:00:05,500\nמעבר\n' }) };
    if (url.endsWith('/api/plugin/quote')) return { ok: true, status: 200, json: async () => ({ jobId: 'quoted-job', estimatedCredits: 3, credits: 64, canStart: true, policyVersion: policy.version, expiresAt: new Date(Date.now() + 60000).toISOString() }) };
    return { ok: true, status: 200, json: async () => url.endsWith('/logout') ? {} : ({
      user: { uid: 'fixture-user', displayName: 'Fixture account' }, credits: 64,
      policy,
    }) };
  };
  const context = vm.createContext({
    document: { querySelectorAll: () => [...nodes.values()], getElementById(id) { if (!nodes.has(id)) throw new Error(`Missing UI control: ${id}`); return nodes.get(id); }, createElement: makeNode },
    require(name) {
      if (name === 'uxp') return { storage: { localFileSystem: {}, secureStorage: {
        async getItem(key) { if (!stored.has(key)) throw new Error('not found'); return Buffer.from(stored.get(key)); },
        async setItem(key, value) { stored.set(key, value); }, async removeItem(key) { stored.delete(key); },
      } }, entrypoints: { setup(value) { entrypoints = value; } }, pluginManager: { plugins: [{ id: 'com.quickcaption.premiere.qa', async showPanel(id) { openedPanels.push(id); } }] } };
      if (name === 'premierepro') return { Constants: { TrackItemType: { CLIP: 1 } } };
      if (name === './client.js') return { PluginClient: class extends clientModule.PluginClient { constructor(options) { super({ ...options, fetcher }); } } };
      if (name === './selection.js' && selectionSnapshot) return { ...selection,
        captureSelection: async () => selectionSnapshot,
        validateSelection: async () => ({ project: { path: 'C:/fixture.prproj' }, original: { guid: 'fixture-sequence' }, selectedRows: [] }),
      };
      if (name === './selection.js') return placement ? { ...selection, validateSelection: async () => ({ original: {
        getCaptionTrackCount: async () => placement.trackIds.length,
        getCaptionTrack: async i => ({ id: placement.trackIds[i], getTrackItems: async () => placement.items || [{}, {}, {}] }),
      } }) } : selection;
      if (name === './storage-json.js') return storageJson;
      if (name === './bridge.js' && selectionSnapshot) return { TimelineBridge: class extends bridgeModule.TimelineBridge { async target() { return {}; } } };
      if (name === './bridge.js') return placement ? { TimelineBridge: class { async prepare() {} async deliver(ppro, snapshot, id, srt) { return placement.deliver({ snapshot, id, srt }); } } } : bridgeModule;
      if (name === './transcription-settings.js') return settingsModule;
      if (name === './language-labels.json') return {};
      if (name === './caption-placement.js') return captionPlacement;
      if (name === './bridge-config.json') throw new Error('Not installed in the fixture');
      if (name === './config.js') return { baseUrl: 'https://fixture.invalid/qa', version: '1.0.0' };
      throw new Error(`Unexpected module ${name}`);
    },
    setInterval: () => 1, clearInterval() {}, setTimeout,
    FormData: class { values = new Map(); append(key, value) { this.values.set(key, value); } },
  });
  vm.runInContext(source, context);
  await vm.runInContext('ready', context);
  return { node: id => nodes.get(id), calls, requests, context, stored, openedPanels, entrypoints };
}

test('the compact panel mounts only its icon and launches the existing selection flow without a paid request', async () => {
  const panel = await openPanel({ selectionSnapshot: { sequenceName: 'Selected clips', duration: 24 } });
  const toolbar = [], main = [];
  panel.entrypoints.panels.quickCaptionToolbar.show({ appendChild: node => toolbar.push(node.id) });
  panel.entrypoints.panels.quickCaption.show({ appendChild: node => main.push(node.id) });
  assert.deepEqual(toolbar, ['quick-caption-toolbar']); assert.deepEqual(main, ['plugin-main']);
  await vm.runInContext('openTimelineAction()', panel.context);
  assert.deepEqual(panel.openedPanels, ['quickCaption']);
  assert.match(panel.node('selection-summary').textContent, /Selected clips/);
  assert.equal(panel.calls.some(url => url.endsWith('/api/transcribe')), false);
});

test('the icon opens a pending job for recovery without recapturing clips or starting another job', async () => {
  const panel = await openPanel({ job: { ...selectedJob, finished: true, result: { videoId: 42 }, delivery: { status: 'pending' } } });
  await vm.runInContext('openTimelineAction()', panel.context);
  assert.deepEqual(panel.openedPanels, ['quickCaption']);
  assert.equal(panel.node('resume').hidden, false);
  assert.equal(panel.calls.some(url => url.includes('/api/transcribe') || url.endsWith('/api/plugin/quote')), false);
});

test('the icon rejects overlapping preparation clicks and keeps the shared account timer active for the visible panel', async () => {
  const panel = await openPanel();
  vm.runInContext('preparing = true; controls();', panel.context);
  assert.equal(panel.node('toolbar-caption').disabled, true);
  await vm.runInContext('openTimelineAction()', panel.context);
  assert.equal(panel.openedPanels.length, 0);
  panel.entrypoints.panels.quickCaptionToolbar.show({ appendChild() {} });
  panel.entrypoints.panels.quickCaption.show({ appendChild() {} });
  panel.entrypoints.panels.quickCaption.hide();
  assert.equal(vm.runInContext('shown', panel.context), true);
});

test('a restored account opens directly on the timeline action without login, history or finished jobs', async () => {
  const panel = await openPanel();
  assert.equal(panel.node('login-section').hidden, true);
  assert.equal(panel.node('account-menu').hidden, false);
  assert.equal(panel.node('account-settings').hidden, true);
  assert.equal(panel.node('quote-section').hidden, true);
  assert.equal(panel.node('resume').hidden, true);
  assert.equal(panel.node('balance').textContent, '64 קרדיטים');
  assert.equal(panel.node('selected').disabled, false);
  assert.deepEqual(panel.calls, ['https://fixture.invalid/qa/api/plugin/account']);
});

test('a balance outage keeps the connected account and does not show an unnecessary login', async () => {
  const panel = await openPanel({ offline: true });
  assert.equal(panel.node('login-section').hidden, true);
  assert.equal(panel.node('account-menu').hidden, false);
  assert.equal(panel.node('balance').textContent, 'היתרה לא זמינה');
  assert.equal(panel.node('send').hidden, true);
});

test('login appears for a disconnected user; resume appears only for an unfinished job', async () => {
  const guest = await openPanel({ connected: false });
  assert.equal(guest.node('login-section').hidden, false);
  assert.equal(guest.node('account-menu').hidden, true);
  assert.equal(guest.calls.length, 0);
  const pending = await openPanel({ finished: false });
  assert.equal(pending.node('resume').hidden, false);
});

test('changing the spoken language reveals repricing and hides the previously approved paid action', async () => {
  const panel = await openPanel();
  vm.runInContext("file = {}; quote = { estimatedCredits: 5, canStart: true, expiresAt: new Date(Date.now() + 60000).toISOString() }; controls();", panel.context);
  assert.equal(panel.node('send').hidden, false);
  assert.equal(panel.node('quote').hidden, true);
  panel.node('language').handlers.get('change')();
  assert.equal(panel.node('send').hidden, true);
  assert.equal(panel.node('quote').hidden, false);
  assert.equal(panel.node('send').attributes.has('disabled'), true);
});

const selectedJob = { uid: 'fixture-user', id: 'fixture-job', selection: {
  projectId: 'original', sequenceId: 'sequence', sequenceName: 'Original sequence',
  ranges: [{ start: 10, end: 15, outputStart: 0 }, { start: 30, end: 35, outputStart: 5 }],
} };
test('completed transcription places mapped captions without a save picker or another paid POST', async () => {
  const placement = { trackIds: ['existing'], async deliver(data) {
    assert.equal(data.id, 'fixture-job:42');
    assert.match(data.srt, /00:00:10,500 --> 00:00:12,000/);
    assert.match(data.srt, /00:00:14,500 --> 00:00:15,000/);
    assert.match(data.srt, /00:00:30,000 --> 00:00:30,500/);
    this.trackIds.push('new-captions'); return { ok: true };
  } };
  const panel = await openPanel({ job: selectedJob, placement });
  await vm.runInContext('pendingJob().then(watchJob)', panel.context);
  const saved = JSON.parse(panel.stored.get('pending-job:fixture-user'));
  assert.equal(saved.finished, true); assert.equal(saved.delivery.status, 'delivered'); assert.equal(saved.delivery.trackId, 'new-captions');
  assert.equal(panel.node('resume').hidden, true);
  assert.match(panel.node('progress').textContent, /3 כתוביות נוספו לערוץ C2.*3 קרדיטים/);
  assert.match(panel.node('status').textContent, /C2.*Original sequence/);
  assert.equal(panel.calls.some(url => url.endsWith('/api/transcribe')), false);
});

test('an empty newly created track does not report success or erase the paid result', async () => {
  const placement = { trackIds: ['existing'], items: [], async deliver() { if (!this.trackIds.includes('new-captions')) this.trackIds.push('new-captions'); return { ok: true }; } };
  const panel = await openPanel({ job: selectedJob, placement });
  await assert.rejects(vm.runInContext('pendingJob().then(watchJob)', panel.context), /לא נמצאו בו כתוביות/);
  const saved = JSON.parse(panel.stored.get('pending-job:fixture-user'));
  assert.equal(saved.result.videoId, 42);
  assert.equal(saved.delivery.status, 'placing');
  assert.equal(panel.node('resume').hidden, false);
  assert.equal(panel.calls.some(url => url.endsWith('/api/transcribe')), false);
});

test('placement failure survives a reload and retries only the same completed subtitles', async () => {
  const placement = { trackIds: ['existing'], async deliver() { throw new Error('Bridge temporarily unavailable'); } };
  const panel = await openPanel({ job: selectedJob, placement });
  await assert.rejects(vm.runInContext('pendingJob().then(watchJob)', panel.context), /temporarily unavailable/);
  const saved = JSON.parse(panel.stored.get('pending-job:fixture-user'));
  assert.equal(saved.result.videoId, 42); assert.equal(saved.delivery.status, 'placing');
  assert.equal(panel.node('resume').hidden, false);
  placement.deliver = async function () { this.trackIds.push('new-captions'); return { ok: true }; };
  const resumed = await openPanel({ job: saved, placement });
  await vm.runInContext('pendingJob().then(watchJob)', resumed.context);
  assert.equal(resumed.calls.some(url => url.includes('/api/transcribe/jobs/')), false);
  assert.equal(resumed.calls.some(url => url.endsWith('/api/transcribe')), false);
  assert.equal(JSON.parse(resumed.stored.get('pending-job:fixture-user')).delivery.status, 'delivered');
});

test('a new quote cannot replace a completed job that is still awaiting caption placement', async () => {
  const job = { ...selectedJob, finished: true, result: { videoId: 42 }, delivery: { status: 'pending' } };
  const panel = await openPanel({ job });
  vm.runInContext('file = {}; selectionContext = {};', panel.context);
  await assert.rejects(vm.runInContext('getQuote()', panel.context), /הצבת הכתוביות/);
  assert.equal(panel.calls.some(url => url.endsWith('/api/plugin/quote')), false);
  assert.equal(JSON.parse(panel.stored.get('pending-job:fixture-user')).result.videoId, 42);
});

test('an unavailable placement component leaves an actionable retry, no stale audio preparation or paid request', async () => {
  const panel = await openPanel({ selectionSnapshot: { sequenceName: 'Selected clips', duration: 24 } });
  await vm.runInContext('captionSelection()', panel.context);
  assert.match(panel.node('status').textContent, /קובץ הגדרת הפיתוח/);
  assert.equal(panel.node('selection-state').textContent, 'נדרשת הפעלה');
  assert.equal(panel.node('selected').disabled, false);
  assert.match(panel.node('selected').textContent, /בדיקת חיבור/);
  assert.equal(panel.node('intro').hidden, true);
  assert.equal(panel.node('footer-note').hidden, true);
  assert.match(panel.node('file').textContent, /טרם הוכן.*לא בוצע חיוב/);
  assert.equal(panel.node('quote-section').hidden, true);
  const previousCalls = panel.calls.length;
  await vm.runInContext('captionSelection()', panel.context);
  assert.equal(panel.calls.length, previousCalls, 'a disconnected retry checks only the local connection');
  assert.equal(panel.calls.some(url => url.endsWith('/api/transcribe')), false);
  assert.equal(panel.calls.some(url => url.endsWith('/api/plugin/quote')), false);
});

test('a preparation in progress rejects an overlapping click and keeps the action disabled', async () => {
  const panel = await openPanel();
  vm.runInContext('preparing = true; controls();', panel.context);
  const before = panel.calls.length;
  await vm.runInContext('captionSelection()', panel.context);
  assert.equal(panel.node('selected').disabled, true);
  assert.equal(panel.calls.length, before);
});

test('length controls, additional languages and presentation modes invalidate an approved quote and persist across reopening', async () => {
  const panel = await openPanel();
  vm.runInContext("file = {}; quote = { estimatedCredits: 3, canStart: true, expiresAt: new Date(Date.now() + 60000).toISOString() }; controls();", panel.context);
  panel.node('limit-words').handlers.get('click')();
  assert.equal(panel.node('send').hidden, true);
  assert.equal(panel.node('limit-label').textContent, 'מספר מילים');
  panel.node('limit-value').value = '9'; panel.node('limit-value').handlers.get('change')();
  const english = panel.node('additional-options').children.find(node => node.textContent === 'en');
  english.checked = true; english.handlers.get('change')();
  panel.node('mode-transliterate').handlers.get('click')();
  await vm.runInContext('settingsSaving', panel.context);
  const savedSettings = JSON.parse(panel.stored.get('transcription-settings'));
  assert.deepEqual(savedSettings.languages, ['he', 'en']);
  assert.equal(savedSettings.words, 9); assert.equal(savedSettings.secondaryLanguageMode, 'transliterate');
  const restored = await openPanel({ savedSettings });
  assert.equal(restored.node('limit-value').value, '9');
  assert.match(restored.node('additional-toggle').textContent, /en/);
  assert.match(restored.node('mode-help').textContent, /גוד מורנינג/);
  restored.node('language-search').value = 'ar'; restored.node('language-search').handlers.get('input')();
  assert.equal(restored.node('language-empty').hidden, true);
  restored.node('language-search').value = 'not-a-language'; restored.node('language-search').handlers.get('input')();
  assert.equal(restored.node('language-empty').hidden, false);
  await vm.runInContext('updateAccount()', restored.context);
  assert.equal(restored.node('limit-value').value, '9');
});

test('primary language changes deduplicate additional languages; current server language and mode restrictions take effect', async () => {
  const savedSettings = { mode: 'characters', characters: 18, words: 5, languages: ['he', 'en', 'ar'], secondaryLanguageMode: 'translate' };
  const policy = pluginPolicy();
  const panel = await openPanel({ savedSettings, policy });
  panel.node('language').value = 'en'; panel.node('language').handlers.get('change')();
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(settings.languages)', panel.context)), ['en', 'ar']);
  policy.languages = ['he', 'ar']; policy.secondaryLanguageModes = ['original']; policy.version += '-changed';
  await vm.runInContext('updateAccount()', panel.context);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(settings.languages)', panel.context)), ['ar']);
  assert.equal(panel.node('mode-translate').hidden, true);
  assert.equal(panel.node('language').value, 'ar');
  assert.match(panel.node('mode-help').textContent, /בכתב המקורי/);
});

test('a simulated upload sends the selected website settings, never the server defaults, and rejects a stale settings approval', async () => {
  const savedSettings = { mode: 'characters', characters: 13, words: 5, languages: ['he', 'en', 'ar'], secondaryLanguageMode: 'translate' };
  const panel = await openPanel({ savedSettings, placement: { trackIds: [] } });
  vm.runInContext("file = { name: 'fixture.wav', getMetadata: async () => ({ size: 100 }) }; selectionContext = {}; watchJob = async () => {};", panel.context);
  await vm.runInContext('getQuote();', panel.context);
  await vm.runInContext('send();', panel.context);
  const request = panel.requests.find(request => request.url.endsWith('/api/transcribe'));
  const fields = Object.fromEntries(request.options.body.values);
  assert.deepEqual(parseTranscriptionSettings(fields), { maxCharactersPerSubtitle: 13, maxWordsPerSubtitle: 0, languages: ['he', 'en', 'ar'], secondaryLanguageMode: 'translate' });
  assert.equal(fields.billingPolicyVersion, pluginPolicy().version);
  const stale = await openPanel({ savedSettings, placement: { trackIds: [] } });
  vm.runInContext("file = { getMetadata: async () => ({ size: 100 }) }; selectionContext = {};", stale.context);
  await vm.runInContext('getQuote()', stale.context);
  vm.runInContext('settings.characters = 15;', stale.context);
  await assert.rejects(vm.runInContext('send()', stale.context), /המחיר או החיבור השתנו/);
  assert.equal(stale.calls.some(url => url.endsWith('/api/transcribe')), false);
});

test('invalid numeric drafts hide paid confirmation, committed values are bounded and settings stay locked while a job is pending', async () => {
  const panel = await openPanel();
  vm.runInContext("file = {}; quote = { estimatedCredits: 3, canStart: true, expiresAt: new Date(Date.now() + 60000).toISOString() }; controls();", panel.context);
  panel.node('limit-value').value = ''; panel.node('limit-value').handlers.get('input')();
  assert.equal(panel.node('send').hidden, true);
  panel.node('limit-value').value = '100'; panel.node('limit-value').handlers.get('change')();
  assert.equal(panel.node('limit-value').value, '20');
  panel.node('limit-none').handlers.get('click')();
  assert.equal(panel.node('limit-controls').hidden, true);
  assert.equal(panel.node('limit-unrestricted').hidden, false);
  vm.runInContext('hasPending = true; controls();', panel.context);
  assert.equal(panel.node('limit-words').disabled, true);
  panel.node('limit-words').handlers.get('click')();
  assert.equal(vm.runInContext('settings.mode', panel.context), 'none');
});
