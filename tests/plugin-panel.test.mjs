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
import graphicsPlacement from '../premiere-plugin/graphics-placement.js';
import pricing from '../premiere-plugin/credit-estimate.js';
import diagnosticsModule from '../premiere-plugin/diagnostics.js';
import { pluginPolicy } from '../src/pluginPolicy.js';
import { parseTranscriptionSettings } from '../src/transcriptionSettings.js';

const source = await readFile(new URL('../premiere-plugin/panel.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../premiere-plugin/index.html', import.meta.url), 'utf8');

async function openPanel({ connected = true, offline = false, finished = true, job = null, placement = null, graphics = null, selectionSnapshot = null, policy = pluginPolicy(), savedSettings = null, exportFixture = null, quoteOverride = {} } = {}) {
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
    if (url.endsWith('/api/plugin/diagnostics')) return { ok: true, status: 202, json: async () => ({ accepted: true, id: JSON.parse(options.body).id }) };
    if (url.includes('/api/transcribe/jobs/')) return { ok: true, status: 200, json: async () => ({ status: 'completed', result: { videoId: 42, creditsUsed: 3 } }) };
    if (url.endsWith('/subtitles')) return { ok: true, status: 200, json: async () => ({ srt: '1\n00:00:00,500 --> 00:00:02,000\nשלום\n\n2\n00:00:04,500 --> 00:00:05,500\nמעבר\n' }) };
    if (/\/api\/videos\/\d+$/.test(url)) return {ok:true,status:200,json:async()=>({video:{subtitle_json:[{id:1,start:0,end:1,text:'שלום עולם'}],words_json:[{word:'שלום',start:0,end:.5},{word:'עולם',start:.5,end:1}]}})};
    if (url.endsWith('/api/plugin/quote')) return { ok: true, status: 200, json: async () => ({ jobId: 'quoted-job', estimatedCredits: pricing.estimateCreditsFromRules(JSON.parse(options.body).durationSeconds,policy.creditEstimate), credits: 64, canStart: true, policyVersion: policy.version, expiresAt: new Date(Date.now() + 60000).toISOString(), ...quoteOverride }) };
    return { ok: true, status: 200, json: async () => url.endsWith('/logout') ? {} : ({
      user: { uid: 'fixture-user', displayName: 'Fixture account' }, credits: 64,
      policy,
    }) };
  };
  const context = vm.createContext({
    document: { querySelectorAll: () => [...nodes.values()], getElementById(id) { if (!nodes.has(id)) throw new Error(`Missing UI control: ${id}`); return nodes.get(id); }, createElement: makeNode },
    require(name) {
      if (name === 'uxp') return { storage: { localFileSystem: exportFixture?.fs || {}, formats: {binary:'binary'}, secureStorage: {
        async getItem(key) { if (!stored.has(key)) throw new Error('not found'); return Buffer.from(stored.get(key)); },
        async setItem(key, value) { stored.set(key, value); }, async removeItem(key) { stored.delete(key); },
      } }, entrypoints: { setup(value) { entrypoints = value; } }, pluginManager: { plugins: [{ id: 'com.quickcaption.premiere.qa', async showPanel(id) { openedPanels.push(id); } }] } };
      if (name === 'premierepro') return exportFixture?.ppro || { Constants: { TrackItemType: { CLIP: 1 } } };
      if (name === './client.js') return { PluginClient: class extends clientModule.PluginClient { constructor(options) { super({ ...options, fetcher }); } } };
      if (name === './selection.js' && selectionSnapshot) return { ...selection,
        captureSelection: async () => selectionSnapshot,
        validateSelection: async () => ({ project: { path: 'C:/fixture.prproj' }, original: { guid: 'fixture-sequence' }, selectedRows: [] }),
        isolatedSelection: async () => { exportFixture.events.push('isolate'); return {sequence:exportFixture.sequence,cleanup:async()=>exportFixture.events.push('cleanup')}; },
      };
      if (name === './selection.js') return placement ? { ...selection, validateSelection: async () => ({ original: {
        getCaptionTrackCount: async () => placement.trackIds.length,
        getCaptionTrack: async i => ({ id: placement.trackIds[i], getTrackItems: async () => placement.items || [{}, {}, {}] }),
      } }) } : selection;
      if (name === './storage-json.js') return storageJson;
      if (name === './bridge.js' && selectionSnapshot) return { TimelineBridge: class extends bridgeModule.TimelineBridge { async target() { return {}; } async prepare(){if(!exportFixture)return super.prepare();exportFixture.events.push('preflight');} async prepareGraphics(){return this.prepare();} async buildGraphics(){graphics.builds.push({});return graphics.built;} } };
      if (name === './bridge.js') return placement ? { TimelineBridge: class { async prepare() {} async deliver(ppro, snapshot, id, srt) { return placement.deliver({ snapshot, id, srt }); } async buildGraphics(ppro,snapshot,id,video,color){graphics.builds.push({snapshot,id,video,color});return graphics.built;} } } : bridgeModule;
      if (name === './transcription-settings.js') return settingsModule;
      if (name === './credit-estimate.js') return pricing;
      if (name === './diagnostics.js') return diagnosticsModule;
      if (name === './language-labels.json') return {};
      if (name === './caption-placement.js') return captionPlacement;
      if (name === './graphics-placement.js') return graphics ? {async placeGraphics(ppro,snapshot,built,journal,save){graphics.placements.push({snapshot,built,journal});await save({status:'placing',kind:'graphics',built,videoIndex:1,audioIndex:1});if(graphics.fail)throw new Error('placement interrupted');return {status:'delivered',kind:'graphics',built,videoIndex:1,audioIndex:1,cueCount:1,trackLabel:'V2'};}} : graphicsPlacement;
      if (name === './reference-audio.js') return {referenceAudioExists:async()=>true,retainReferenceAudio:async()=>({sourcePath:'C:/persistent/selection.wav',token:'reference-token',durationSeconds:6,ranges:[]})};
      if (name === './bridge-config.json') throw new Error('Not installed in the fixture');
      if (name === './config.js') return { baseUrl: 'https://fixture.invalid/qa', version: '1.0.0' };
      throw new Error(`Unexpected module ${name}`);
    },
    setInterval: () => 1, clearInterval() {}, setTimeout(callback) { callback(); return 1; },
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
  assert.deepEqual(panel.openedPanels, ['quickCaption'], 'the same panel entrypoint is brought forward');
  assert.match(panel.node('selection-summary').textContent, /Selected clips/);
  assert.equal(panel.calls.some(url => url.endsWith('/api/transcribe')), false);
});

test('the icon opens a pending job for recovery without recapturing clips or starting another job', async () => {
  const panel = await openPanel({ job: { ...selectedJob, finished: true, result: { videoId: 42 }, delivery: { status: 'pending' } } });
  await vm.runInContext('openTimelineAction()', panel.context);
  assert.deepEqual(panel.openedPanels, ['quickCaption']);
  assert.match(panel.node('selected').textContent, /ללא חיוב נוסף/);
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
  assert.doesNotMatch(panel.node('selected').textContent, /נסיון חוזר/);
  assert.equal(panel.node('balance').textContent, '64 קרדיטים');
  assert.equal(panel.node('selected').disabled, true, 'no selected clips yet');
  assert.deepEqual(panel.calls, ['https://fixture.invalid/qa/api/plugin/account']);
});

test('a balance outage keeps the connected account and does not show an unnecessary login', async () => {
  const panel = await openPanel({ offline: true });
  assert.equal(panel.node('login-section').hidden, true);
  assert.equal(panel.node('account-menu').hidden, false);
  assert.equal(panel.node('balance').textContent, 'היתרה לא זמינה');
  assert.equal(panel.node('selected').disabled, true);
});

test('login appears for a disconnected user; resume appears only for an unfinished job', async () => {
  const guest = await openPanel({ connected: false });
  assert.equal(guest.node('login-section').hidden, false);
  assert.equal(guest.node('account-menu').hidden, true);
  assert.equal(guest.calls.length, 0);
  const pending = await openPanel({ finished: false });
  assert.match(pending.node('selected').textContent, /ללא חיוב נוסף/);
});

test('changing the spoken language recomputes a local approval without another quote request', async () => {
  const panel = await openPanel({selectionSnapshot:{sequenceName:'Selected',duration:24}});
  const previous=vm.runInContext('quote.settingsKey',panel.context);
  panel.node('language').value='en';
  panel.node('language').handlers.get('change')();
  assert.notEqual(vm.runInContext('quote.settingsKey',panel.context),previous);
  assert.equal(panel.node('selected').disabled,false);
  assert.equal(panel.calls.some(url=>url.endsWith('/api/plugin/quote')),false);
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
  assert.doesNotMatch(panel.node('selected').textContent, /נסיון חוזר/);
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
  assert.match(panel.node('selected').textContent, /ללא חיוב נוסף/);
  assert.equal(panel.calls.some(url => url.endsWith('/api/transcribe')), false);
});

test('active words deliver native graphics with the approved style and existing word timings, without another paid POST',async()=>{
  const graphics={builds:[],placements:[],built:{ok:true,frameTicks:'10160640000',phrases:[{sequenceId:'nested',startFrame:250,endFrame:275}]}};
  const job={...selectedJob,style:{activeWord:true,activeWordColor:'#63D8FF'}};
  const panel=await openPanel({job,placement:{trackIds:[]},graphics,savedSettings:{activeWord:false}});
  await vm.runInContext('pendingJob().then(watchJob)',panel.context);
  assert.equal(graphics.builds.length,1);assert.equal(graphics.builds[0].color,'#63D8FF');
  assert.equal(graphics.builds[0].video.words_json.length,2);
  assert.equal(panel.calls.some(url=>url.endsWith('/subtitles')||url.endsWith('/api/transcribe')),false);
  const saved=JSON.parse(panel.stored.get('pending-job:fixture-user'));
  assert.equal(saved.delivery.kind,'graphics');assert.equal(saved.delivery.status,'delivered');
  assert.match(panel.node('status').textContent,/V2.*ציר הזמן הפנימי/);
});

test('interrupted graphic placement restores its built sequences and journal without rebuilding or transcribing',async()=>{
  const graphics={builds:[],placements:[],fail:true,built:{ok:true,frameTicks:'10160640000',phrases:[{sequenceId:'nested',startFrame:250,endFrame:275}]}};
  const job={...selectedJob,style:{activeWord:true,activeWordColor:'#FFD45A'}};
  const panel=await openPanel({job,placement:{trackIds:[]},graphics});
  await assert.rejects(vm.runInContext('pendingJob().then(watchJob)',panel.context),/placement interrupted/);
  const saved=JSON.parse(panel.stored.get('pending-job:fixture-user'));
  assert.equal(saved.delivery.status,'placing');assert.ok(saved.delivery.built);
  graphics.fail=false;
  const resumed=await openPanel({job:saved,placement:{trackIds:[]},graphics});
  await vm.runInContext('pendingJob().then(watchJob)',resumed.context);
  assert.equal(graphics.builds.length,1);assert.equal(graphics.placements[1].journal.videoIndex,1);
  assert.equal(resumed.calls.some(url=>url.includes('/api/videos/')||url.includes('/api/transcribe')),false);
});

test('active-word controls update the local approval, persist the choice and lock during paid work',async()=>{
  const panel=await openPanel({selectionSnapshot:{sequenceName:'Selected',duration:24}});
  panel.node('active-word').checked=true;panel.node('active-word').handlers.get('change')();
  await vm.runInContext('settingsSaving',panel.context);
  assert.equal(panel.node('selected').disabled,false);assert.equal(panel.node('active-word-options').hidden,false);
  assert.equal(JSON.parse(vm.runInContext('quote.settingsKey',panel.context)).activeWord,true);
  panel.node('active-word-color').value='#78E6A5';panel.node('active-word-color').handlers.get('change')();
  await vm.runInContext('settingsSaving',panel.context);
  const saved=JSON.parse(panel.stored.get('transcription-settings'));
  assert.equal(saved.activeWord,true);assert.equal(saved.activeWordColor,'#78E6A5');
  await vm.runInContext('hasPending=true;controls()',panel.context);
  assert.equal(panel.node('active-word').disabled,true);assert.equal(panel.node('active-word-color').disabled,true);
});

test('placement failure survives a reload and retries only the same completed subtitles', async () => {
  const placement = { trackIds: ['existing'], async deliver() { throw new Error('Bridge temporarily unavailable'); } };
  const panel = await openPanel({ job: selectedJob, placement });
  await assert.rejects(vm.runInContext('pendingJob().then(watchJob)', panel.context), /temporarily unavailable/);
  const saved = JSON.parse(panel.stored.get('pending-job:fixture-user'));
  assert.equal(saved.result.videoId, 42); assert.equal(saved.delivery.status, 'placing');
  assert.match(panel.node('selected').textContent, /ללא חיוב נוסף/);
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
  vm.runInContext('selectionContext = {duration:24};', panel.context);
  await assert.rejects(vm.runInContext('getQuote({})', panel.context), /הצבת הכתוביות/);
  assert.equal(panel.calls.some(url => url.endsWith('/api/plugin/quote')), false);
  assert.equal(JSON.parse(panel.stored.get('pending-job:fixture-user')).result.videoId, 42);
});

test('an unavailable placement component leaves an actionable retry, no stale audio preparation or paid request', async () => {
  const panel = await openPanel({ selectionSnapshot: { sequenceName: 'Selected clips', duration: 24 } });
  await vm.runInContext('captionSelection()', panel.context);
  assert.match(panel.node('status').textContent, /קובץ הגדרת הפיתוח/);
  assert.equal(panel.node('selection-state').textContent, 'נדרשת הפעלה');
  assert.equal(panel.node('selected').disabled, false);
  assert.match(panel.node('selected').textContent, /קרדיטים/);
  assert.equal(panel.node('progress-bar').hidden, true);
  assert.equal(panel.node('quote-section').hidden, false);
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
  const panel = await openPanel({selectionSnapshot:{sequenceName:'Selected',duration:24}});
  panel.node('limit-words').handlers.get('click')();
  assert.equal(panel.node('selected').disabled, false);
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
  vm.runInContext("file = { name: 'fixture.wav', getMetadata: async () => ({ size: 100 }) }; selectionContext = {duration:24}; watchJob = async () => {};invalidateQuote();", panel.context);
  await vm.runInContext('getQuote(quote).then(send)', panel.context);
  const request = panel.requests.find(request => request.url.endsWith('/api/transcribe'));
  const fields = Object.fromEntries(request.options.body.values);
  assert.deepEqual(parseTranscriptionSettings(fields), { maxCharactersPerSubtitle: 13, maxWordsPerSubtitle: 0, languages: ['he', 'en', 'ar'], secondaryLanguageMode: 'translate' });
  assert.equal(fields.billingPolicyVersion, pluginPolicy().version);
  const stale = await openPanel({ savedSettings, placement: { trackIds: [] } });
  vm.runInContext("file = { getMetadata: async () => ({ size: 100 }) }; selectionContext = {duration:24};invalidateQuote();", stale.context);
  await vm.runInContext('getQuote(quote).then(value=>globalThis.approved=value)', stale.context);
  vm.runInContext('settings.characters = 15;', stale.context);
  await assert.rejects(vm.runInContext('send(approved)', stale.context), /המחיר או החיבור השתנו/);
  assert.equal(stale.calls.some(url => url.endsWith('/api/transcribe')), false);
});

test('invalid numeric drafts hide paid confirmation, committed values are bounded and settings stay locked while a job is pending', async () => {
  const panel = await openPanel({selectionSnapshot:{sequenceName:'Selected',duration:24}});
  panel.node('limit-value').value = ''; panel.node('limit-value').handlers.get('input')();
  assert.equal(panel.node('selected').disabled, true);
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

function audioExportFixture() {
  const events=[], bytes=new Uint8Array(48), view=new DataView(bytes.buffer);
  bytes.set([...Buffer.from('RIFF')],0);bytes.set([...Buffer.from('WAVE')],8);view.setUint32(4,40,true);
  const sequence={guid:'fixture-sequence'};
  const file={name:'selected.wav',nativePath:'C:/selected.wav',getMetadata:async()=>({size:48}),read:async()=>bytes.buffer,delete:async()=>events.push('delete')};
  return {events,sequence,
    fs:{getFileForOpening:async()=>({nativePath:'C:/audio.epr'}),createPersistentToken:async()=> 'preset-token',getTemporaryFolder:async()=>({createFile:async()=>file})},
    ppro:{Constants:{ExportType:{IMMEDIATELY:1}},Project:{getActiveProject:async()=>({guid:'fixture-project',getSequences:async()=>[sequence]})},EncoderManager:{getExportFileExtension:async()=> 'wav',getManager:()=>({exportSequence:async()=>{events.push('export');return true;}})}}};
}

test('one approved click exports, submits once and places active words automatically with a single progress indicator',async()=>{
  const fixture=audioExportFixture(),snapshot={projectId:'fixture-project',sequenceId:'fixture-sequence',sequenceName:'Two selected clips',duration:24,rows:[{},{}],ranges:[{start:0,end:12,outputStart:0},{start:30,end:42,outputStart:12}]};
  const graphics={builds:[],placements:[],built:{ok:true,phrases:[]}};
  const panel=await openPanel({selectionSnapshot:snapshot,exportFixture:fixture,graphics,savedSettings:{activeWord:true}});
  const estimate=pricing.estimateCreditsFromRules(24,pluginPolicy().creditEstimate);
  assert.match(panel.node('selected').textContent,new RegExp(`${estimate} קרדיטים`));
  assert.equal(panel.calls.some(url=>url.endsWith('/api/plugin/quote')),false,'the displayed price is computed locally');
  await Promise.all([vm.runInContext('captionSelection()',panel.context),vm.runInContext('captionSelection()',panel.context)]);
  assert.equal(panel.requests.filter(r=>r.url.endsWith('/api/transcribe')).length,1);
  assert.equal(graphics.builds.length,1);assert.equal(graphics.placements.length,1);
  assert.equal(JSON.parse(panel.stored.get('pending-job:fixture-user')).delivery.status,'delivered');
  assert.deepEqual(fixture.events,['preflight','isolate','export','cleanup','preflight','delete']);
  assert.equal(panel.node('progress-bar').hidden,true);
  assert.equal([...html.matchAll(/<sp-progressbar\b/g)].length,1);
  assert.equal(panel.node('resume'),undefined);assert.equal(panel.node('send'),undefined);
});

test('a more expensive server quote cannot start an export or paid transcription under the displayed price',async()=>{
  const fixture=audioExportFixture();
  const panel=await openPanel({selectionSnapshot:{projectId:'fixture-project',sequenceId:'fixture-sequence',sequenceName:'Two clips',duration:24},exportFixture:fixture,quoteOverride:{estimatedCredits:100}});
  await vm.runInContext('captionSelection()',panel.context);
  assert.match(panel.node('status').textContent,/המחיר השתנה/);
  assert.equal(fixture.events.includes('export'),false);
  assert.equal(panel.calls.some(url=>url.endsWith('/api/transcribe')),false);
});

test('changing selection after the displayed estimate requires approval of the new clips before any request',async()=>{
  const fixture=audioExportFixture(),snapshot={projectId:'fixture-project',sequenceId:'fixture-sequence',sequenceName:'Two clips',duration:24};
  const panel=await openPanel({selectionSnapshot:snapshot,exportFixture:fixture});
  snapshot.duration=60;
  await vm.runInContext('captionSelection()',panel.context);
  assert.match(panel.node('status').textContent,/הבחירה השתנתה/);
  assert.equal(panel.calls.some(url=>url.endsWith('/api/transcribe')||url.endsWith('/api/plugin/quote')),false);
});

test('a long export renews an expired admission quote within the original approval and submits only once',async()=>{
  const panel=await openPanel({placement:{trackIds:[]}});
  vm.runInContext("file={name:'long.wav',getMetadata:async()=>({size:48})};selectionContext={duration:24};watchJob=async()=>{};invalidateQuote();",panel.context);
  await vm.runInContext('getQuote(quote).then(value=>{value.expiresAt=new Date(0).toISOString();return send(value);})',panel.context);
  assert.equal(panel.calls.filter(url=>url.endsWith('/api/plugin/quote')).length,2);
  assert.equal(panel.calls.filter(url=>url.endsWith('/api/transcribe')).length,1);
});
