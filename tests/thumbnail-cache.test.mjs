import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import express from 'express';
import { createThumbnailCache, thumbnailVersion } from '../src/thumbnailCache.js';
import { createVideoThumbnailHandler, withVideoThumbnail } from '../src/videoThumbnails.js';
import { createVideoTokens } from '../src/videoTokens.js';

const ref = 'bunny://123/11111111-1111-4111-8111-111111111111';
const jpeg = Buffer.from([255,216,255,217]);
const setup = async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-cover-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return { directory:path.join(root,'.thumbnails'),localDir:root };
};

test('duplicate requests share generation and cached covers survive restart and provider outage', async t => {
  const options = await setup(t); let opened=0,rendered=0;
  const cache=createThumbnailCache({...options,bunny:{async openThumbnail(){opened++;return new Response(jpeg,{headers:{'Content-Type':'image/jpeg'}});}},render:async (_input,output)=>{rendered++;await fs.writeFile(output,jpeg);}});
  const [first,second]=await Promise.all([cache.get({stored_path:ref}),cache.get({stored_path:ref})]);
  assert.deepEqual(first,second);assert.equal(opened,1);assert.equal(rendered,1);
  const restarted=createThumbnailCache({...options,bunny:{openThumbnail(){throw Error('Provider unavailable');}}});
  assert.deepEqual(await restarted.get({stored_path:ref}),jpeg);
  assert.deepEqual(await fs.readdir(options.directory),[thumbnailVersion(ref)+'.jpg']);
  await fs.writeFile(path.join(options.directory,thumbnailVersion(ref)+'.jpg'),'interrupted-write');
  assert.deepEqual(await cache.get({stored_path:ref}),jpeg);
  assert.equal(opened,2);
});

test('transient failures do not poison the cache and generation is bounded', async t => {
  const options=await setup(t);let unavailable=true,active=0,maxActive=0;
  const cache=createThumbnailCache({...options,concurrency:2,bunny:{async openThumbnail(){if(unavailable)throw Object.assign(Error('Not ready'),{status:404});return new Response(jpeg,{headers:{'Content-Type':'image/jpeg'}});}},render:async(_input,output)=>{active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,10));await fs.writeFile(output,jpeg);active--;}});
  await assert.rejects(cache.get({stored_path:ref}),{status:404});
  unavailable=false;
  await Promise.all(Array.from({length:6},(_,i)=>cache.get({stored_path:`bunny://123/${String(i+1).padStart(8,'0')}-1111-4111-8111-111111111111`})));
  assert.equal(maxActive,2);
  assert.deepEqual(await cache.get({stored_path:ref}),jpeg);
  assert.ok((await fs.readdir(options.directory)).every(file=>/^[a-f0-9]{24}\.jpg$/.test(file)));
});

test('a cover is generated from the upload before Bunny creates its thumbnail', async t => {
  const options=await setup(t);const input=path.join(options.localDir,'upload.mp4');
  await promisify(execFile)('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=1280x720:d=0.2','-y',input],{windowsHide:true});
  const cache=createThumbnailCache({...options,bunny:{openThumbnail(){throw Error('Provider is still processing');}}});
  const image=await cache.prime(ref,input);
  assert.deepEqual(image.subarray(0,2),Buffer.from([255,216]));assert.ok(image.length<50000);
  const output=path.join(options.directory,thumbnailVersion(ref)+'.jpg');
  const {stdout}=await promisify(execFile)('ffprobe',['-v','error','-show_entries','stream=width,height','-of','json',output],{windowsHide:true});
  assert.deepEqual(JSON.parse(stdout).streams.map(s=>[s.width,s.height]),[[480,270]]);
  assert.deepEqual(await cache.get({stored_path:ref}),image);await fs.access(input);
});

test('cached images still require ownership, preserve versions and support HEAD', async t => {
  const options=await setup(t);const cache=createThumbnailCache({...options,bunny:{},render:async(_input,output)=>fs.writeFile(output,jpeg)});
  await cache.prime(ref,'fixture-upload');let reads=0;
  const guarded=express();guarded.use((req,_res,next)=>{req.identity={uid:req.get('X-Owner')||'owner'};next();});
  guarded.get('/:id',createVideoThumbnailHandler({getVideoById:async({userUid,touch})=>{assert.equal(touch,false);return userUid==='owner'?{stored_path:ref,media_type:'video'}:null;},cache:{get(video){reads++;return cache.get(video);}}}));
  const server=guarded.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/42?v=${thumbnailVersion(ref)}`;
  assert.equal((await fetch(url,{headers:{'X-Owner':'stranger'}})).status,404);assert.equal(reads,0);
  assert.equal((await fetch(url.replace(thumbnailVersion(ref),'old-version'))).status,404);assert.equal(reads,0);
  const response=await fetch(url);assert.equal(response.headers.get('cache-control'),'private, max-age=3600, immutable');assert.deepEqual(Buffer.from(await response.arrayBuffer()),jpeg);
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('cover URLs are stable within an hour but still expire and cannot authorize media', () => {
  let now=3_600_000*100+1000;const tokens=createVideoTokens('test-key',()=>now);
  const video={id:42,stored_path:ref,media_type:'video'};const first=withVideoThumbnail(video,'owner',tokens).thumbnail_url;
  now+=20000;assert.equal(withVideoThumbnail(video,'owner',tokens).thumbnail_url,first);
  const grant=new URL(first,'https://test.example').searchParams.get('thumbnailToken');
  assert.equal(tokens.verify(grant,'thumbnail').userUid,'owner');assert.equal(tokens.verify(grant,'media'),null);
  assert.notEqual(withVideoThumbnail(video,'another-owner',tokens).thumbnail_url,first);
  now+=24*3600000;assert.equal(tokens.verify(grant,'thumbnail'),null);
});
