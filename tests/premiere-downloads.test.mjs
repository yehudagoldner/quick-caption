import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createPremiereDownloadsRouter } from '../routes/premiereDownloads.js';
import { PREMIERE_DOWNLOADS, PREMIERE_VERSION } from '../src/premiereRelease.js';

async function fixture(t, enabled = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'caption-downloads-'));
  const app = express();
  app.use('/downloads/premiere', createPremiereDownloadsRouter({ directory, enabled }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { directory, base: `http://127.0.0.1:${server.address().port}/downloads/premiere/` };
}

test('QA visitors can download the exact installer bytes without an account; HEAD and filenames work', async t => {
  const { directory, base } = await fixture(t);
  const payload = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 255]);
  await writeFile(path.join(directory, PREMIERE_DOWNLOADS[0]), payload);
  const response = await fetch(base + PREMIERE_DOWNLOADS[0]);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + PREMIERE_DOWNLOADS[0], { method: 'HEAD' })).status, 200);
});

test('the Windows link downloads executable bytes with its filename, including a resumed download', async t => {
  const {directory,base}=await fixture(t);
  const filename=PREMIERE_DOWNLOADS.find(name=>name.endsWith('-Windows.exe'));
  const payload=Buffer.concat([Buffer.from('MZ'),Buffer.alloc(256,0xff)]);
  await writeFile(path.join(directory,filename),payload);
  const full=await fetch(base+filename);
  assert.equal(full.status,200);assert.match(full.headers.get('content-disposition'),new RegExp(filename.replaceAll('.','\\.')));
  assert.deepEqual(Buffer.from(await full.arrayBuffer()),payload);
  const resumed=await fetch(base+filename,{headers:{Range:'bytes=128-'}});
  assert.equal(resumed.status,206);assert.deepEqual(Buffer.from(await resumed.arrayBuffer()),payload.subarray(128));
});

test('unpublished packages return a visible error, private and unknown files stay inaccessible', async t => {
  const { directory, base } = await fixture(t);
  await writeFile(path.join(directory, '.env'), 'private');
  await writeFile(path.join(directory, 'unlisted.zip'), 'private');
  const missing = await fetch(base + PREMIERE_DOWNLOADS[0]);
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /קובץ ההתקנה/);
  for (const name of ['.env', 'unlisted.zip', '%2eenv', 'README.md', 'nested/file.zip']) {
    assert.equal((await fetch(base + name)).status, 404);
  }
  assert.equal((await fetch(base + PREMIERE_DOWNLOADS[0], { method: 'POST' })).status, 404);
});

test('the download router is disabled outside QA', async t => {
  const { directory, base } = await fixture(t, false);
  await writeFile(path.join(directory, PREMIERE_DOWNLOADS[0]), 'fixture');
  assert.equal((await fetch(base + PREMIERE_DOWNLOADS[0])).status, 404);
});

test('the download page, package builders and both installer version checks agree', async () => {
  const page = await readFile(new URL('../public/premiere.html', import.meta.url), 'utf8');
  for (const filename of PREMIERE_DOWNLOADS) assert.ok(page.includes(`downloads/premiere/${filename}`));
  const mac = await readFile(new URL('../installer/macos/installer.sh', import.meta.url), 'utf8');
  const windows = await readFile(new URL('../installer/windows/QuickCaptionSetup.cs', import.meta.url), 'utf8');
  assert.ok(mac.includes(`QC_VERSION=${PREMIERE_VERSION}`));
  assert.ok(windows.includes(`QuickCaption-Premiere-${PREMIERE_VERSION}.ccx`));
  assert.ok(windows.includes(`QuickCaption-Timeline-Bridge-${PREMIERE_VERSION}.zxp`));
  assert.ok(windows.includes(`manifest["version"] != "${PREMIERE_VERSION}"`));
});
