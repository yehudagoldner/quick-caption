import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import reference from '../premiere-plugin/reference-audio.js';

function wav() {const bytes=new Uint8Array(100);bytes.set(Buffer.from('RIFF'));new DataView(bytes.buffer).setUint32(4,92,true);bytes.set(Buffer.from('WAVE'),8);return bytes.buffer;}
function storage() {
 const entries=new Map();let writes=0;
 const folder={async getEntry(name){if(!entries.has(name))throw new Error('missing');return entries.get(name);},async createFile(name,{overwrite}){assert.equal(overwrite,false);assert.ok(!entries.has(name));let bytes;const entry={nativePath:'C:/PluginData/reference-audio/'+name,read:async()=>bytes,write:async value=>{bytes=value;writes++;},delete:async()=>entries.delete(name),getMetadata:async()=>({size:bytes?.byteLength||0})};entries.set(name,entry);return entry;}};
 const root={getEntry:async()=>folder};
 const uxp={storage:{formats:{binary:'binary'},localFileSystem:{getDataFolder:async()=>root,createPersistentToken:async entry=>entry.nativePath,getEntryForPersistentToken:async token=>[...entries.values()].find(e=>e.nativePath===token)||Promise.reject(new Error('missing'))}}};
 return {uxp,entries,writes:()=>writes};
}
test('reference WAV survives deletion of the temporary upload and is reused without overwriting project media',async()=>{
 const fixture=storage(),snapshot={duration:4,ranges:[{start:10,end:12,outputStart:0},{start:30,end:32,outputStart:2}]};
 let present=true;const file={read:async()=>{assert.ok(present);return wav();}};
 const saved=await reference.retainReferenceAudio(fixture.uxp,file,'job:42',snapshot);present=false;
 assert.equal(await reference.referenceAudioExists(fixture.uxp,saved),true);
 assert.deepEqual((await reference.retainReferenceAudio(fixture.uxp,file,'job:42',snapshot)).ranges,snapshot.ranges);
 assert.equal(fixture.writes(),1);assert.match(saved.sourcePath,/job%3A42/);
 fixture.entries.clear();assert.equal(await reference.referenceAudioExists(fixture.uxp,saved),false);
});
test('an incomplete WAV or invalid identity cannot become persistent reference media',async()=>{
 const fixture=storage(),bytes=wav();new DataView(bytes).setUint32(4,1000,true);
 await assert.rejects(reference.retainReferenceAudio(fixture.uxp,{read:async()=>bytes},'job',{duration:1,ranges:[]}),/אינו שלם/);
 await assert.rejects(reference.retainReferenceAudio(fixture.uxp,{read:async()=>wav()},'../escape',{}));
 assert.equal(fixture.entries.size,0);assert.equal(fixture.writes(),0);
});

const hostSource=await readFile(new URL('../premiere-bridge/host.jsx',import.meta.url),'utf8');
const TPS=254016000000,frameTicks='10160640000';
function host({platform='Windows', userData='C:/Users/test/AppData/Roaming', pluginId='com.quickcaption.premiere.qa', hostFolder='25', mode='Developer'}={}) {
 function Time(){this.seconds=0;}Object.defineProperty(Time.prototype,'ticks',{get(){return String(Math.round(this.seconds*TPS));},set(value){this.seconds=Number(value)/TPS;}});
 const time=seconds=>{const value=new Time();value.seconds=seconds;return value;};
 // Array's count must remain dynamic when tracks are cleared between phrases.
 const list=(items,key)=>{Object.defineProperty(items,key,{get(){return items.length;}});return items;};
 const root={children:list([],'numItems'),createBin(name){const bin={type:2,name,nodeId:'bin',children:list([],'numItems'),deleteBin(){root.children.splice(root.children.indexOf(bin),1);}};root.children.push(bin);return bin;}};
 let id=0,imports=0;
 const sequences=list([],'numSequences');
 const projectItem=mediaPath=>({type:1,nodeId:'source-'+id++,getMediaPath:()=>mediaPath,moveBin(bin){bin.children.push(this);},setInPoint(value){this.input=value;},setOutPoint(value){this.output=value;}});
 const makeClip=(input,output,start,source)=>({inPoint:time(input),outPoint:time(output),start:time(start),end:time(start+output-input),projectItem:source,components:{numItems:1},getSpeed:()=>1,isSpeedReversed:()=>false,disabled:false});
 const sequence=()=>{
  const videos=list([],'numItems'),audios=list([],'numItems');
  const seq={sequenceID:'seq-'+id++,timebase:frameTicks,videoTracks:{numTracks:1,0:{clips:videos}},audioTracks:{numTracks:1,0:{clips:audios,overwriteClip(source,start){const clip=makeClip(source.input,source.output,start,source);clip.remove=()=>audios.splice(audios.indexOf(clip),1);audios.push(clip);}}},projectItem:projectItem(''),getSettings:()=>({}),setSettings(){},createCaptionTrack(){},setInPoint(){},setOutPoint(){},importMGT(asset,ticks){const clip=makeClip(0,2,Number(ticks)/TPS,null);clip.remove=()=>videos.splice(videos.indexOf(clip),1);videos.push(clip);return clip;},createSubsequence(){const nested=sequence();nested.videoTracks[0].clips.push(...videos.map(c=>({...c})));nested.audioTracks[0].clips.push(...audios.map(c=>({...c})));return nested;}};
  sequences.push(seq);return seq;
 };
 const original=sequence(),source=projectItem('C:/media.wav'),selected=makeClip(0,40,0,source);original.audioTracks[0].clips.push(selected);
 const project={path:'C:/original.prproj',rootItem:root,sequences,activeSequence:original,openSequence(){},deleteSequence(seq){sequences.splice(sequences.indexOf(seq),1);},importFiles(paths,quiet,bin){imports++;if(paths[0].endsWith('.xml'))sequence();else bin.children.push(projectItem(paths[0]));return true;}};
 const context=vm.createContext({$,app:{project},JSON,Time,File:function(value){this.fsName=value;this.exists=true;},Folder:{fs:platform,userData:{fsName:userData}},ProjectItemType:{BIN:2}});
 function $(){} // Only used as the ExtendScript namespace.
 vm.runInContext(hostSource,context);
 const data={id:'audio-job',target:{projectPath:project.path,sequenceId:original.sequenceID,clips:[{kind:'Audio',track:0,sourcePath:'C:/media.wav',startTicks:'0',endTicks:String(40*TPS),inTicks:'0',outTicks:String(40*TPS),speed:1,reversed:false,disabled:false}],referenceAudio:{sourcePath:'C:/Users/test/AppData/Roaming/Adobe/UXP/PluginsStorage/PPRO/25/Developer/com.quickcaption.premiere.qa/PluginData/reference-audio/selection-job.wav',durationSeconds:4,ranges:[{start:10,end:12,outputStart:0},{start:30,end:32,outputStart:2}]}},scaffoldPath:'C:/Users/test/AppData/Roaming/Quick Caption/Premiere Bridge QA/graphics/empty.xml',plan:{version:1,frameTicks,phrases:[{text:'first',startFrame:275,endFrame:300,states:[{assetPath:'C:/Users/test/AppData/Roaming/Quick Caption/Premiere Bridge QA/graphics/first.mogrt',startFrame:0,endFrame:25,word:'first'}]},{text:'second',startFrame:750,endFrame:775,states:[{assetPath:'C:/Users/test/AppData/Roaming/Quick Caption/Premiere Bridge QA/graphics/second.mogrt',startFrame:0,endFrame:25,word:'second'}]}]}};
 data.target.referenceAudio.sourcePath=userData+'/Adobe/UXP/PluginsStorage/PPRO/'+hostFolder+'/'+mode+'/'+pluginId+'/PluginData/reference-audio/selection-job.wav';
 data.scaffoldPath=userData+'/Quick Caption/Premiere Bridge QA/graphics/empty.xml';
 for(const phrase of data.plan.phrases)for(const state of phrase.states)state.assetPath=userData+'/Quick Caption/Premiere Bridge QA/graphics/word.mogrt';
 return {data,original,project,imports:()=>imports,invoke:()=>JSON.parse(context.$._quickCaptionBridge.buildGraphics(JSON.stringify(data))),upgrade:delivery=>JSON.parse(context.$._quickCaptionBridge.prepare(JSON.stringify({target:{...data.target,operation:'attach-reference-audio',id:data.id,graphicsDelivery:delivery}}))),place(result){for(const phrase of result.phrases){const seq=sequences.find(s=>s.sequenceID===phrase.sequenceId);const duration=(phrase.endFrame-phrase.startFrame)*Number(frameTicks)/TPS;original.videoTracks[0].clips.push(makeClip(0,duration,phrase.startFrame*Number(frameTicks)/TPS,seq.projectItem));seq.audioTracks[0].clips.length=0;}}};
}

for(const platform of ['Windows','Macintosh'])for(const pluginId of ['com.quickcaption.premiere.qa','com.quickcaption.premiere'])for(const mode of ['Developer','External']) {
 test(`reference audio host simulation: ${platform}, ${pluginId}, ${mode}, Unicode home and dotted host version`,()=>{
  const userData=platform==='Windows'?'D:/משתמשים/Élodie Gold/AppData/Roaming':'/Users/Élodie שלום/Library/Application Support';
  const fixture=host({platform,userData,pluginId,mode,hostFolder:'26.0'});
  const result=fixture.invoke();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.referenceAudio,true);
  assert.equal(fixture.project.sequences.find(seq=>seq.sequenceID===result.phrases[0].sequenceId).audioTracks[0].clips.length,1);
 });
}
test('release ID support does not allow an unrelated plugin to import reference audio',()=>{
 const fixture=host({platform:'Macintosh',userData:'/Users/test/Library/Application Support',pluginId:'com.unrelated.plugin'});
 assert.equal(fixture.invoke().code,'invalid_reference_audio');assert.equal(fixture.imports(),0);
});
test('native nests map disconnected timeline ranges into the compact WAV without inheriting audio from the preceding sentence',()=>{
 const fixture=host(),result=fixture.invoke();assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.referenceAudio,true);assert.equal(fixture.original.audioTracks[0].clips.length,1);
 const intervals=result.phrases.map(p=>{const seq=fixture.project.sequences.find(s=>s.sequenceID===p.sequenceId);assert.equal(seq.audioTracks[0].clips.length,1);const clip=seq.audioTracks[0].clips[0];return [clip.inPoint.seconds,clip.outPoint.seconds,clip.start.seconds,clip.end.seconds];});
 assert.deepEqual(intervals,[[1,2,0,1],[2,3,0,1]]);
 assert.equal(fixture.invoke().phrases[0].sequenceId,result.phrases[0].sequenceId);assert.equal(fixture.imports(),2);
});
test('native reference import rejects foreign media paths and corrupt range maps before importing anything',()=>{
 for(const kind of ['foreign','gap','duration']) {
  const fixture=host();
  if(kind==='foreign')fixture.data.target.referenceAudio.sourcePath='C:/private/other.wav';
  if(kind==='gap')fixture.data.target.referenceAudio.ranges[1].outputStart=7;
  if(kind==='duration')fixture.data.target.referenceAudio.durationSeconds=5;
  const result=fixture.invoke();assert.equal(result.ok,false);assert.equal(result.code,'invalid_reference_audio');assert.equal(fixture.imports(),0);assert.equal(fixture.project.sequences.length,1);
 }
});
test('rounding to a video frame preserves a fractional leading audio gap instead of shifting speech',()=>{
 const fixture=host();fixture.data.target.referenceAudio.ranges=[{start:10.015,end:12.015,outputStart:0}];fixture.data.target.referenceAudio.durationSeconds=2;
 fixture.data.plan.phrases=[{...fixture.data.plan.phrases[0],startFrame:250,endFrame:275}];
 const result=fixture.invoke();assert.equal(result.ok,true,JSON.stringify(result));
 const clip=fixture.project.sequences.find(s=>s.sequenceID===result.phrases[0].sequenceId).audioTracks[0].clips[0];
 assert.ok(Math.abs(clip.start.seconds-.015)<1e-9);assert.ok(Math.abs(clip.inPoint.seconds)<1e-9);assert.ok(Math.abs(clip.end.seconds-1)<1e-9);
});
test('legacy audio upgrade preserves word edits, original audio and tail trims, and can replay without duplicating or replacing reference clips',()=>{
 const f=host(),built=f.invoke();f.place(built);
 const delivery={status:'placing',built,videoIndex:0,audioIndex:1};
 f.original.videoTracks[0].clips[0].end.seconds-=.04;
 const nest=f.project.sequences.find(s=>s.sequenceID===built.phrases[0].sequenceId);
 nest.videoTracks[0].clips[0].name='User edited word';
 const before=JSON.stringify([f.original.audioTracks,f.original.videoTracks,nest.videoTracks]);
 const result=f.upgrade(delivery);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.delivery.status,'delivered');
 assert.equal(JSON.stringify([f.original.audioTracks,f.original.videoTracks,nest.videoTracks]),before);
 const owned=nest.audioTracks[0].clips[0];owned.end.seconds-=.02;
 assert.equal(f.upgrade(delivery).ok,true);assert.equal(nest.audioTracks[0].clips.length,1);assert.equal(nest.audioTracks[0].clips[0],owned);
});
test('legacy upgrade stops before any nest mutation for a moved caption, foreign audio or retained master reference audio',()=>{
 for(const problem of ['moved','audio','master-audio']){
  const f=host(),built=f.invoke();f.place(built);
  if(problem==='moved')f.original.videoTracks[0].clips[0].start.seconds+=1;
  else if(problem==='audio')f.project.sequences.find(s=>s.sequenceID===built.phrases[1].sequenceId).audioTracks[0].clips.push({name:'User audio',projectItem:{getMediaPath:()=> 'C:/other.wav'}});
  else f.original.audioTracks[0].clips.push({projectItem:f.project.sequences.find(s=>s.sequenceID===built.phrases[0].sequenceId).projectItem});
  const result=f.upgrade({built,videoIndex:0});assert.equal(result.ok,false);assert.equal(result.code,'changed_graphics');
  assert.equal(f.project.sequences.find(s=>s.sequenceID===built.phrases[0].sequenceId).audioTracks[0].clips.length,0);
 }
});
