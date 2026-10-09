import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import clientModule from '../premiere-plugin/client.js';
const { PluginClient } = clientModule;
const storage = () => {
  const data = new Map();
  return { setItem: async (key, value) => data.set(key, value), removeItem: async key => data.delete(key),
    getItem: async key => { if (!data.has(key)) throw Error('missing'); return new TextEncoder().encode(data.get(key)); } };
};
const session = { accessToken: 'old', refreshToken: 'refresh', expiresIn: 900, user: { uid: 'owner' } };
const response = (status, body) => ({ status, ok: status < 400, json: async () => body });

test('Premiere restores stored UTF-8 account and jobs without TextDecoder', async () => {
  const context = { module: { exports: {} } };
  vm.runInNewContext(readFileSync(new URL('../premiere-plugin/storage-json.js', import.meta.url), 'utf8'), context);
  const saved = { ...session, user: { uid: 'owner', displayName: 'יהודה 😀 العربية' } };
  const bytes = new TextEncoder().encode(JSON.stringify(saved));
  assert.deepEqual(JSON.parse(JSON.stringify(context.module.exports.readStoredJson(bytes))), saved);
  const persistent = storage();
  await new PluginClient({ baseUrl: 'https://qa.invalid', storage: persistent, now: () => 1000 }).accept(saved);
  const reloaded = new PluginClient({ baseUrl: 'https://qa.invalid', storage: persistent, now: () => 1000 });
  await reloaded.restore();
  assert.equal(reloaded.session.user.displayName, saved.user.displayName);
  assert.equal(reloaded.session.refreshToken, saved.refreshToken);
});

test('concurrent balance and library refresh rotate a session only once', async () => {
  let refreshes = 0;
  const client = new PluginClient({ baseUrl: 'https://qa.invalid', storage: storage(), now: () => 1000,
    fetcher: async (url, options) => {
      if (url.endsWith('/refresh')) { refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); return response(200, { ...session, accessToken: 'new' }); }
      return options.headers.Authorization === 'Bearer old' ? response(401, {}) : response(200, { credits: 49 });
    } });
  await client.accept(session);
  await Promise.all([client.request('/api/plugin/account'), client.request('/api/videos')]);
  assert.equal(refreshes, 1);
  assert.equal(client.session.accessToken, 'new');
});
test('a paid upload is never resubmitted automatically on an authentication failure', async () => {
  let requests = 0;
  const client = new PluginClient({ baseUrl: 'https://qa.invalid', storage: storage(), now: () => 1000,
    fetcher: async () => { requests++; return response(401, { error: 'expired' }); } });
  await client.accept(session);
  await assert.rejects(client.request('/api/transcribe', { method: 'POST', body: 'media' }, false));
  assert.equal(requests, 1);
});
test('disconnecting while a refresh is running cannot restore the old account', async () => {
  let complete;
  const client = new PluginClient({ baseUrl: 'https://qa.invalid', storage: storage(), now: () => 1000,
    fetcher: () => new Promise(resolve => { complete = resolve; }) });
  await client.accept(session);
  const refreshing = client.refresh();
  await client.clear();
  complete(response(200, { ...session, accessToken: 'new' }));
  await assert.rejects(refreshing, /החשבון השתנה/);
  assert.equal(client.session, null);
  await client.restore(); assert.equal(client.session, null);
});
test('balances from a previous account are discarded after disconnect', async () => {
  let complete;
  const client = new PluginClient({ baseUrl: 'https://qa.invalid', storage: storage(), now: () => 1000,
    fetcher: () => new Promise(resolve => { complete = resolve; }) });
  await client.accept(session);
  const pending = client.request('/api/plugin/account');
  await client.clear();
  complete(response(200, { credits: 999 }));
  await assert.rejects(pending, /החשבון השתנה/);
});
test('network failure preserves login for retry without fabricating a balance', async () => {
  const client = new PluginClient({ baseUrl: 'https://qa.invalid', storage: storage(), now: () => 1000,
    fetcher: async () => { throw new Error('offline'); } });
  await client.accept(session);
  await assert.rejects(client.request('/api/plugin/account'), /offline/);
  assert.equal(client.session.user.uid, 'owner');
});
test('an unresolved earlier upload blocks a second paid job until its outcome is known', async () => {
  let state = response(404, { error: 'not yet accepted' });
  const client = new PluginClient({ baseUrl: 'https://qa.invalid', storage: storage(), now: () => 1000, fetcher: async () => state });
  await client.accept(session);
  const job = { id: 'fixture', uid: 'owner' };
  await assert.rejects(client.settlePreviousJob(job), /עדיין אינו ידוע/);
  state = response(200, { status: 'processing' });
  await assert.rejects(client.settlePreviousJob(job), /עדיין מתבצע/);
  state = response(200, { status: 'completed' });
  assert.deepEqual(await client.settlePreviousJob(job), { ...job, finished: true });
});
