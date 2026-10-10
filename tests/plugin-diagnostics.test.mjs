import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { createDiagnosticStore, startDiagnosticCleanup, DIAGNOSTIC_LIMITS } from '../src/pluginDiagnostics.js';
import { createPluginPrivateRouter } from '../routes/plugin.js';
import { pluginRouteAllowed } from '../src/pluginSessions.js';
import schema from '../premiere-plugin/diagnostics-schema.js';
import module from '../premiere-plugin/diagnostics.js';
import bridgeModule from '../premiere-bridge/diagnostics.js';
import fs from 'node:fs';

const report = (now=Date.now(), extra={}) => ({id:randomUUID(),deviceId:randomUUID(),at:now,source:'uxp',environment:{os:'darwin',arch:'arm64',pluginVersion:'1.0.0',hostVersion:'26.0.1',paired:true},events:[{stage:'preflight',outcome:'error',code:'unsupported_graphics'}],...extra});
async function root(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'qc-diagnostics-test-'));
  t.after(async()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.match(path.basename(directory),/^qc-diagnostics-test-/);await rm(directory,{recursive:true,force:true});});
  return directory;
}
function storage() {const entries=new Map();return {entries,async getItem(key){if(!entries.has(key))throw Error('missing');return Buffer.from(entries.get(key));},async setItem(key,value){entries.set(key,value);}};}
test('diagnostic allowlist excludes paths, media, transcripts, identities, raw errors and credentials',()=>{
  const input=report();input.token='SENSITIVE';input.userUid='SENSITIVE';input.srt='SENSITIVE';input.environment.homedir='SENSITIVE';input.environment.hostVersion='SENSITIVE';
  input.events.push({stage:'SENSITIVE',message:'SENSITIVE',stack:'SENSITIVE',code:'SENSITIVE',elapsedMs:123.45,durationSeconds:864000,clipCount:4,status:503});
  const safe=schema.sanitizeReport(input);assert.doesNotMatch(JSON.stringify(safe),/SENSITIVE/);
  assert.equal(safe.events.at(-1).status,503);assert.equal(safe.events.at(-1).durationSeconds,86400);assert.equal(safe.events.at(-1).elapsedMs,123);
  assert.equal(schema.errorCode({code:'unsupported_graphics',message:'Template checksum mismatch'}),'template_corrupt');
  assert.equal(schema.errorCode({code:'EADDRINUSE',message:'SENSITIVE'}),'EADDRINUSE');
});
test('server accepts a Mac report once, survives restart, and exposes it only to its account',async t=>{
  const directory=await root(t),input=report(),store=createDiagnosticStore({directory});
  await store.accept('owner-one',input);await store.accept('owner-one',input);
  const restarted=createDiagnosticStore({directory});
  assert.equal((await restarted.list('owner-one')).length,1);assert.equal((await restarted.list('owner-two')).length,0);
  assert.equal((await restarted.list('owner-one'))[0].environment.arch,'arm64');
  assert.doesNotMatch(await readFile(path.join(directory,'reports.json'),'utf8'),/owner-one/);
  assert.deepEqual(await readdir(directory),['reports.json']);
});
test('seven-day expiry is enforced on restart, read, ingestion and scheduled idle cleanup',async t=>{
  const directory=await root(t);let now=Date.now();const store=createDiagnosticStore({directory,now:()=>now});
  await store.accept('owner',report(now));now+=schema.TTL+1;
  let callback;const scheduled=[];startDiagnosticCleanup(store,{schedule:(fn,ms)=>{callback=fn;scheduled.push(ms);return {unref(){}};}});
  assert.deepEqual(scheduled,[15*60000]);callback();await store.sweep();
  assert.equal((await store.list('owner')).length,0);assert.equal(await readFile(path.join(directory,'reports.json'),'utf8'),'[]');
  await assert.rejects(store.accept('owner',report(NaN)),{status:400});
  assert.equal((await createDiagnosticStore({directory,now:()=>now}).list('owner')).length,0);
});
test('a different computer clock is diagnosed while server time controls retention',async t=>{
  const directory=await root(t),now=Date.now(),store=createDiagnosticStore({directory,now:()=>now});
  for(const offset of [-10*schema.TTL,10*schema.TTL])await store.accept('owner',report(now+offset));
  const rows=await store.list('owner');assert.equal(rows.length,2);
  assert.ok(rows.every(row=>row.at===now&&row.environment.clockSkewed&&Date.parse(row.expiresAt)===now+schema.TTL));
});
test('global count, per-account cap and byte budget bound storage; duplicates cannot renew expiry',async t=>{
  const directory=await root(t);let now=Date.now();const store=createDiagnosticStore({directory,now:()=>now,limits:{...DIAGNOSTIC_LIMITS,maxReports:12,perAccount:3,maxBytes:5000}});
  const original=report(now);await store.accept('single-owner',original);const expiry=(await store.list('single-owner'))[0].expiresAt;
  now+=1000;await store.accept('single-owner',original);assert.equal((await store.list('single-owner'))[0].expiresAt,expiry);
  for(let i=0;i<24;i++)await store.accept(i<10?'single-owner':'owner-'+i,report(now));
  const rows=JSON.parse(await readFile(path.join(directory,'reports.json'),'utf8'));
  assert.ok(rows.length<=12);assert.ok((await stat(path.join(directory,'reports.json'))).size<=5000);
  assert.ok((await store.list('single-owner')).length<=3);assert.deepEqual(await readdir(directory),['reports.json']);
});
test('oversized input is rejected and a corrupt diagnostic file recovers without accumulating archives',async t=>{
  const directory=await root(t),store=createDiagnosticStore({directory});
  await assert.rejects(store.accept('owner',report(Date.now(),{raw:'a'.repeat(20000)})),{status:413});
  await writeFile(path.join(directory,'reports.json'),'broken');await store.accept('owner',report());
  assert.equal((await store.list('owner')).length,1);assert.deepEqual(await readdir(directory),['reports.json']);
});
test('a full or read-only server disk returns a monitoring error without damaging prior reports',async t=>{
  const directory=await root(t),store=createDiagnosticStore({directory});await store.accept('owner',report());
  const original=await readFile(path.join(directory,'reports.json'),'utf8');
  for(const code of ['ENOSPC','EACCES']) {
    const failing=createDiagnosticStore({directory,io:{...await import('node:fs/promises'),writeFile:async()=>{throw Object.assign(Error('SENSITIVE path'),{code});}}});
    await assert.rejects(failing.accept('owner',report()),{code});
    assert.equal(await readFile(path.join(directory,'reports.json'),'utf8'),original);
  }
});
test('offline client queue is bounded, expires while logged out, and never uploads another account’s reports',async()=>{
  let now=Date.now(),offline=true;const saved=storage(),sent=[];
  const client={session:{user:{uid:'first'}},request:async(url,options)=>{assert.equal(url,'/api/plugin/diagnostics');if(offline)throw Error('offline');const row=JSON.parse(options.body);sent.push(row);return {accepted:true,id:row.id};}};
  const diagnostics=new module.Diagnostics({storage:saved,client,now:()=>now,environment:{os:'win32',arch:'x64'}});await diagnostics.restore();
  for(let i=0;i<15;i++)diagnostics.failure({code:'bridge_unavailable',message:'SENSITIVE'});
  await diagnostics.flushing;await diagnostics.writes;assert.equal(diagnostics.queue.length,10);assert.doesNotMatch(saved.entries.get('diagnostics-v1'),/SENSITIVE/);
  client.session={user:{uid:'second'}};offline=false;now+=31000;await diagnostics.flush();assert.equal(sent.length,0);
  client.session={user:{uid:'first'}};now+=31000;await diagnostics.flush();assert.equal(sent.length,10);assert.equal(diagnostics.queue.length,0);
  client.session=null;diagnostics.failure(Error('anonymous startup'));now+=schema.TTL+1;await diagnostics.flush();await diagnostics.writes;assert.equal(diagnostics.queue.length,0);
});
test('invalid server receipts retain the same report ID for idempotent retry; diagnostics never invoke transcription',async()=>{
  let now=Date.now(),valid=false;const sent=[];
  const client={session:{user:{uid:'owner'}},request:async(url,options)=>{sent.push({url,body:JSON.parse(options.body)});return valid?{accepted:true,id:JSON.parse(options.body).id}:{};}};
  const diagnostics=new module.Diagnostics({storage:storage(),client,now:()=>now});await diagnostics.restore();
  const id=diagnostics.failure({status:503});await diagnostics.flushing;assert.equal(diagnostics.queue.length,1);
  now+=31000;valid=true;await diagnostics.flush();assert.equal(diagnostics.queue.length,0);
  assert.ok(sent.every(row=>row.url==='/api/plugin/diagnostics'&&row.body.id===id));
});
test('disabled client storage does not interrupt the original workflow',async()=>{
  const diagnostics=new module.Diagnostics({storage:{getItem:async()=>{throw Error('disabled');},setItem:async()=>{throw Error('disabled');}},client:{session:null}});
  await diagnostics.restore();assert.match(diagnostics.failure({code:'EACCES'}),schema.UUID);await diagnostics.writes;
});
test('bridge diagnostics rotate at 32 events, delete the legacy log, expire, and tolerate read-only storage',async t=>{
  const directory=await root(t);let now=Date.now();await writeFile(path.join(directory,'bridge.log'),'SENSITIVE legacy');
  const diagnostics=bridgeModule.createBridgeDiagnostics({root:directory,now:()=>now});
  for(let i=0;i<50;i++)diagnostics.record('bridge-start',{code:'EADDRINUSE',message:'SENSITIVE'});
  assert.equal(diagnostics.read().length,32);assert.deepEqual(await readdir(directory),['diagnostics.json']);
  assert.ok((await stat(path.join(directory,'diagnostics.json'))).size<=16384);assert.doesNotMatch(await readFile(path.join(directory,'diagnostics.json'),'utf8'),/SENSITIVE/);
  now+=schema.TTL+1;diagnostics.sweep();assert.deepEqual(diagnostics.read(),[]);
  const readonly=bridgeModule.createBridgeDiagnostics({root:directory,io:{...fs,writeFileSync:()=>{throw Object.assign(Error('denied'),{code:'EACCES'});}}});
  assert.doesNotThrow(()=>readonly.record('bridge-start',Error('failure')));
});
test('authenticated diagnostic HTTP ingestion/read is isolated, rate limited, and rejects unsafe input',async t=>{
  const directory=await root(t),store=createDiagnosticStore({directory});
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{if(!['Bearer first','Bearer second'].includes(req.headers.authorization))return res.sendStatus(401);req.identity={uid:req.headers.authorization.slice(7)};next();});
  app.use('/api/plugin',createPluginPrivateRouter({diagnostics:store}));
  const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/plugin/diagnostics`;
  const input=report();const headers={Authorization:'Bearer first','Content-Type':'application/json'};
  assert.equal((await fetch(url)).status,401);
  const accepted=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(accepted.status,202);assert.equal((await accepted.json()).id,input.id);
  assert.equal((await (await fetch(url,{headers})).json()).reports[0].id,input.id);
  assert.equal((await (await fetch(url,{headers:{Authorization:'Bearer second'}})).json()).reports.length,0);
  assert.equal((await fetch(url,{method:'POST',headers,body:'{"id":"bad"}'})).status,400);
  for(let i=0;i<17;i++)await fetch(url,{headers});assert.equal((await fetch(url,{headers})).status,429);
  assert.ok(pluginRouteAllowed('GET','/plugin/diagnostics'));assert.ok(pluginRouteAllowed('POST','/plugin/diagnostics'));assert.equal(pluginRouteAllowed('DELETE','/plugin/diagnostics'),false);
});
