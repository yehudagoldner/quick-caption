import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadClient(fetcher) {
  const events = [];
  const context = { exports: {}, require: () => ({ clearVideoLibrary() {} }), Headers, Response,
    Request, URL, fetch: fetcher, window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
  const source = ts.transpile(readFileSync(new URL('../src/client/api.ts', import.meta.url), 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
  vm.runInNewContext(source, context);
  return { api: context.exports, events };
}
const revoked = () => new Response(JSON.stringify({ code: 'CONNECTION_REVOKED' }), { status: 401 });
const user = () => ({ uid: 'owner', getIdToken: async () => 'token' });
test('browser revocation clears display via event while network/ordinary 401 preserve login', async () => {
  let response = revoked();
  const { api, events } = loadClient(async () => response);
  api.setApiUser(user());
  await api.apiFetch('/api/users/credits');
  assert.equal(events.length, 1); assert.equal(events[0].detail.uid, 'owner');
  response = new Response('{}', { status: 401 });
  await api.apiFetch('/api/users/credits'); assert.equal(events.length, 1);
});
test('delayed revoked response cannot sign out a new login to the same account', async () => {
  let complete;
  const { api, events } = loadClient(() => new Promise(resolve => { complete = resolve; }));
  api.setApiUser(user()); const pending = api.apiFetch('/api/users/credits');
  await new Promise(resolve => setTimeout(resolve, 0));
  api.setApiUser(user()); complete(revoked()); await pending;
  assert.equal(events.length, 0);
});
