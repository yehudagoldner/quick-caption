import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import bridgeServer from '../premiere-bridge/server.js';
import bridgeClient from '../premiere-plugin/bridge.js';

const srt = '1\n00:00:10,500 --> 00:00:12,000\nשלום עולם\n\n2\n00:00:30,000 --> 00:00:30,500\nמעבר\n';
const clip = { kind: 'Audio', track: 0, sourcePath: 'C:/media/amit.mp4', startTicks: '10000', endTicks: '15000', inTicks: '0', outTicks: '5000', speed: 1, reversed: false, disabled: false };
const target = { projectPath: 'C:/projects/Original.prproj', sequenceId: '{ABC-123}', clips: [clip] };
const payload = { id: 'fixture-job:42', target, srt };
async function temporaryRoot(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qc-bridge-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^qc-bridge-test-/);
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('simultaneous delivery and restart reuse one permanent SRT and one caption-track creation', async t => {
  const root = await temporaryRoot(t); let placements = 0;
  const evalHost = async (method, data) => {
    if (method === 'prepare') return { ok: true };
    assert.equal(method, 'deliver'); placements++;
    assert.deepEqual(data.target, target);
    assert.equal(await readFile(data.srtPath, 'utf8'), '\uFEFF' + srt);
    return { ok: true, sequenceId: target.sequenceId, sourcePath: data.srtPath };
  };
  const service = bridgeServer.createDeliveryService({ root, evalHost });
  const [first, second] = await Promise.all([service.deliver(payload), service.deliver(payload)]);
  assert.equal(first.ok, true); assert.equal(second.replay, true); assert.equal(placements, 1);
  const restarted = bridgeServer.createDeliveryService({ root, evalHost });
  assert.equal((await restarted.deliver(payload)).replay, true); assert.equal(placements, 1);
  assert.equal((await readdir(path.join(root, 'captions'))).length, 1);
  await assert.rejects(restarted.deliver({ ...payload, srt: srt.replace('שלום', 'שינוי') }), { code: 'delivery_conflict' });
  assert.equal(placements, 1);
});

test('an ambiguous interruption cannot blindly create a second caption track', async t => {
  const root = await temporaryRoot(t); let attempts = 0;
  const service = bridgeServer.createDeliveryService({ root, evalHost: async method => {
    if (method === 'prepare') return { ok: true };
    attempts++; throw new Error('Response lost after host mutation');
  } });
  await assert.rejects(service.deliver(payload), /Response lost/);
  const restarted = bridgeServer.createDeliveryService({ root, evalHost: async method => {
    assert.equal(method, 'lookup'); return { ok: true, result: null };
  } });
  await assert.rejects(restarted.deliver(payload), { code: 'delivery_uncertain' });
  assert.equal(attempts, 1);
});

test('host memory can recover a committed track after receipt persistence was interrupted', async t => {
  const root = await temporaryRoot(t); let committed = null;
  const service = bridgeServer.createDeliveryService({ root, evalHost: async (method, data) => {
    if (method === 'prepare') return { ok: true };
    committed = { ok: true, sequenceId: data.target.sequenceId }; throw new Error('Lost callback');
  } });
  await assert.rejects(service.deliver(payload));
  const restarted = bridgeServer.createDeliveryService({ root, evalHost: async method => {
    assert.equal(method, 'lookup'); return { ok: true, result: committed };
  } });
  assert.equal((await restarted.deliver(payload)).replay, true);
});

test('a definite rejection before caption creation can be retried without a new transcription', async t => {
  const root = await temporaryRoot(t); let attempts = 0;
  const service = bridgeServer.createDeliveryService({ root, evalHost: async method => {
    if (method === 'prepare') return { ok: true };
    if (++attempts === 1) throw Object.assign(new Error('Import rejected'), { code: 'import_failed' });
    return { ok: true };
  } });
  await assert.rejects(service.deliver(payload), { code: 'import_failed' });
  assert.equal((await service.deliver(payload)).ok, true); assert.equal(attempts, 2);
});

test('the HTTP bridge requires the local pairing key and rejects browser origins and arbitrary script routes', async t => {
  const root = await temporaryRoot(t); const token = 'a'.repeat(64);
  const server = bridgeServer.startBridge({ root, token, port: 0, evalHost: async () => ({ ok: true, protocolVersion: 1 }) });
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + '/health')).status, 403);
  assert.equal((await fetch(url + '/health', { headers: { 'X-Quick-Caption-Bridge': token, Origin: 'https://example.invalid' } })).status, 403);
  const hostStatus = host => new Promise((resolve, reject) => {
    http.get(url + '/health', { headers: { 'X-Quick-Caption-Bridge': token, Host: host } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(await hostStatus(`attacker.invalid:${server.address().port}`), 403);
  assert.equal(await hostStatus(`localhost:${server.address().port}`), 200);
  assert.equal((await fetch(url + '/eval', { method: 'POST', headers: { 'X-Quick-Caption-Bridge': token } })).status, 404);
  assert.equal((await fetch(url + '/prepare', { method: 'POST', headers: { 'X-Quick-Caption-Bridge': token, 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  const client = new bridgeClient.TimelineBridge({ configuration: { token, port: server.address().port } });
  assert.equal((await client.request('/health')).protocolVersion, 1);
});

const hostSource = await readFile(new URL('../premiere-bridge/host.jsx', import.meta.url), 'utf8');

test('a host permission rejection is distinct from a disconnected companion', async () => {
  const client = new bridgeClient.TimelineBridge({ configuration: { token: 'a'.repeat(64), port: 37289 }, fetcher: async () => { throw new Error('Permission denied to the url. Manifest entry not found.'); } });
  await assert.rejects(client.request('/health'), { code: 'bridge_permissions' });
});
const jsonSource = await readFile(new URL('../premiere-bridge/vendor/json2.jsx', import.meta.url), 'utf8');
function hostFixture() {
  const media = { type: 1, nodeId: 'source', getMediaPath: () => clip.sourcePath };
  const av = { start: { ticks: clip.startTicks }, end: { ticks: clip.endTicks }, inPoint: { ticks: clip.inTicks }, outPoint: { ticks: clip.outTicks }, projectItem: media, getSpeed: () => 1, isSpeedReversed: () => false, disabled: false };
  const makeSequence = id => ({ sequenceID: id, audioTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: av } } }, videoTracks: { numTracks: 0 }, created: [], createCaptionTrack(item, start) { this.created.push({ item, start }); return true; } });
  const original = makeSequence('ABC-123'), other = makeSequence('OTHER');
  const children = { numItems: 1, 0: media };
  const project = { path: target.projectPath, activeSequence: other, sequences: { numSequences: 2, 0: other, 1: original }, rootItem: { children }, getInsertionBin: () => ({ children }), importFiles(paths) {
    children[children.numItems++] = { type: 1, nodeId: 'captions', getMediaPath: () => paths[0] };
    children[children.numItems++] = { type: 1, nodeId: 'unrelated-import', getMediaPath: () => 'C:/unrelated/file.srt' };
    return true;
  } };
  const context = vm.createContext({ JSON: undefined, $: {}, app: { project, version: '25.6.6' }, Folder: { fs: 'Windows' }, File: function (value) { this.fsName = value; }, ProjectItemType: { BIN: 2 } });
  vm.runInContext(jsonSource, context); vm.runInContext(hostSource, context);
  return { original, other, av, project, reload() { vm.runInContext(hostSource,context); }, invoke(method, data) { return JSON.parse(context.$._quickCaptionBridge[method](JSON.stringify(data))); } };
}
test('the real JSX targets the original sequence, identifies the exact SRT and places mapped cues from zero', () => {
  const host = hostFixture();
  const data = { id: payload.id, target, srtPath: 'C:/captions/owned.srt' };
  assert.equal(host.invoke('deliver', data).ok, true);
  assert.equal(host.original.created.length, 1); assert.equal(host.other.created.length, 0);
  assert.equal(host.original.created[0].item.nodeId, 'captions'); assert.equal(host.original.created[0].start, 0);
  assert.equal(host.av.start.ticks, clip.startTicks);
  host.reload();
  assert.equal(host.invoke('deliver', data).ok, true); assert.equal(host.original.created.length, 1);
});
test('changed clips or another project are rejected by the JSX before import or track creation', () => {
  const host = hostFixture(); host.av.start.ticks = '11000';
  assert.equal(host.invoke('deliver', { id: payload.id, target, srtPath: 'C:/captions/owned.srt' }).code, 'changed_clip');
  assert.equal(host.project.rootItem.children.numItems, 1); assert.equal(host.original.created.length, 0);
  host.project.path = 'C:/projects/Different.prproj';
  assert.equal(host.invoke('prepare', { target }).code, 'wrong_project');
});
test('UXP extended-length Windows paths match the same JSX project and media without weakening identity', () => {
  const host = hostFixture();
  const extended = value => '//?/' + value;
  const prefixed = { ...target, projectPath: extended(target.projectPath), clips: [{ ...clip, sourcePath: extended(clip.sourcePath) }] };
  assert.equal(host.invoke('prepare', { target: prefixed }).ok, true);
  host.project.path = '//server/share/project.prproj';
  assert.equal(host.invoke('prepare', { target: { ...prefixed, projectPath: '//?/UNC/server/share/project.prproj' } }).ok, true);
  assert.equal(host.invoke('prepare', { target: { ...prefixed, projectPath: '//?/UNC/other/share/project.prproj' } }).code, 'wrong_project');
});
