import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import server from '../premiere-bridge/server.js';
import assets from '../premiere-bridge/native-graphic.js';
const target={projectPath:'C:/original.prproj',sequenceId:'original',clips:[{kind:'Audio',track:0,sourcePath:'C:/media.mp4',startTicks:'0',endTicks:'508032000000',inTicks:'0',outTicks:'508032000000',speed:1,reversed:false,disabled:false}]};
const payload={id:'test-graphics',target,segments:[{id:1,start:0,end:2,text:'שלום עולם'}],words:[{word:'שלום',start:0,end:1},{word:'עולם',start:1,end:2}],ranges:[{start:0,end:2,outputStart:0}],color:'#FFD45A'};
const info={ok:true,frameTicks:'10160640000',width:1920,height:1080};
const template=()=>({definition:{authorApp:'ppro',sourceInfoLocalized:{en_US:{hasaudio:false}},clientControls:[{type:6}]},doc:{mVersion:1,mTextParam:{mStyleSheet:{mText:'original'}}},node:'<ArbVideoComponentParam><Name>Source Text</Name><StartKeyframeValue>old</StartKeyframeValue></ArbVideoComponentParam>',xml:'<Project><ArbVideoComponentParam><Name>Source Text</Name><StartKeyframeValue>old</StartKeyframeValue></ArbVideoComponentParam></Project>'});
async function root(t){const directory=await mkdtemp(path.join(os.tmpdir(),'qc-native-test-'));t.after(async()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.match(path.basename(directory),/^qc-native-test-/);await rm(directory,{recursive:true,force:true});});return directory;}
test('serialized native builds create durable assets once and replay the same sequences after a bridge restart',async t=>{
  const directory=await root(t);let calls=0;
  const evalHost=async(method,data)=>{
    if(method==='prepare')return info;
    assert.equal(method,'buildGraphics');calls++;
    assert.match(await readFile(data.scaffoldPath,'utf8'),/<track\/>/);
    assert.equal(data.plan.phrases.length,1);assert.equal(data.plan.phrases[0].states.length,2);
    for(const state of data.plan.phrases[0].states)assert.equal(assets.readZip(await readFile(state.assetPath)).has('project.prgraphic'),true);
    return {...info,phrases:[{sequenceId:'nested',startFrame:0,endFrame:50,stateCount:2}]};
  };
  const service=server.createDeliveryService({root:directory,evalHost,loadTemplate:template});
  const [a,b]=await Promise.all([service.buildGraphics(payload),service.buildGraphics(payload)]);
  assert.equal(calls,1);assert.equal(b.replay,true);assert.equal(a.phrases[0].sequenceId,'nested');
  const restarted=server.createDeliveryService({root:directory,evalHost,loadTemplate:template});
  assert.equal((await restarted.buildGraphics(payload)).replay,true);assert.equal(calls,1);
  await assert.rejects(restarted.buildGraphics({...payload,color:'#63D8FF'}),{code:'delivery_conflict'});
});
test('an interrupted native build cannot blindly create a second set of graphics; committed host results can be recovered',async t=>{
  const directory=await root(t);let attempts=0;
  const service=server.createDeliveryService({root:directory,loadTemplate:template,evalHost:async method=>{
    if(method==='prepare')return info;
    attempts++;throw new Error('Lost callback');
  }});
  await assert.rejects(service.buildGraphics(payload),/Lost callback/);
  let cached=null;
  const restarted=server.createDeliveryService({root:directory,loadTemplate:template,evalHost:async method=>{assert.equal(method,'lookupGraphics');return {ok:true,result:cached};}});
  await assert.rejects(restarted.buildGraphics(payload),{code:'delivery_uncertain'});
  cached={...info,phrases:[{sequenceId:'existing',startFrame:0,endFrame:50,stateCount:2}]};
  assert.equal((await restarted.buildGraphics(payload)).phrases[0].sequenceId,'existing');assert.equal(attempts,1);
});
test('graphics preflight runs one non-rendering native probe per frame geometry and template failures stop before a build',async t=>{
  const directory=await root(t);let probes=0;
  const service=server.createDeliveryService({root:directory,loadTemplate:template,evalHost:async(method,data)=>{
    if(method==='prepare'||method==='graphicsInfo')return info;
    assert.equal(method,'inspectNativeGraphics');assert.equal(data.render,false);probes++;return {ok:true,compatible:true};
  }});
  await service.prepareGraphics(target);await service.prepareGraphics(target);assert.equal(probes,1);
  const missing=server.createDeliveryService({root:directory,evalHost:async()=>info,loadTemplate:()=>{throw new Error('Missing template');}});
  await assert.rejects(missing.prepareGraphics(target),/Missing template/);
});
