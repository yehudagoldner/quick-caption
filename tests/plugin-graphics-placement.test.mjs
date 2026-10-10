import test from 'node:test';
import assert from 'node:assert/strict';
import selection from '../premiere-plugin/selection.js';
import placement from '../premiere-plugin/graphics-placement.js';
const frameTicks='10160640000',TPS=254016000000;
function fixture() {
  const time=seconds=>({seconds,ticks:String(seconds*TPS)});
  const makeItem=(kind,index,source,start,end,name=source)=>({kind,index,source,start,end,
    getMediaType:async()=>kind,getTrackIndex:async()=>index,getStartTime:async()=>time(start),getEndTime:async()=>time(end),
    getInPoint:async()=>time(0),getOutPoint:async()=>time(end-start),getName:async()=>name,getSpeed:async()=>1,isSpeedReversed:async()=>false,isDisabled:async()=>false,
    getProjectItem:async()=>({getId:()=>source}),
  });
  const originals=[makeItem('Audio',0,'media',0,60),makeItem('Video',0,'media',0,60)];
  const video=[originals.filter(item=>item.kind==='Video')],audio=[originals.filter(item=>item.kind==='Audio')];
  const track=(kind,index)=>({id:`${kind}-${index}`,isMuted:async()=>false,getTrackItems:async()=>[...(kind==='Video'?video:audio)[index]]});
  const original={guid:'original',name:'Original',getTimebase:async()=>frameTicks,
    getVideoTrackCount:async()=>video.length,getAudioTrackCount:async()=>audio.length,getVideoTrack:async index=>track('Video',index),getAudioTrack:async index=>track('Audio',index),
    getSelection:async()=>({getTrackItems:async()=>originals})};
  const nests=[{guid:'n1',getProjectItem:async()=>({getId:()=> 'n1',duration:1})},{guid:'n2',getProjectItem:async()=>({getId:()=> 'n2',duration:2})}];
  let locked=false,transactions=0,inserts=0,removed=0;
  const project={guid:'project',getActiveSequence:async()=>original,getSequences:async()=>[original,...nests],
    lockedAccess(callback){locked=true;try{callback();}finally{locked=false;}},
    executeTransaction(callback){assert.equal(locked,true);const actions=[];callback({addAction:action=>actions.push(action)});transactions++;actions.forEach(action=>action());return true;}};
  const ppro={Project:{getActiveProject:async()=>project},Constants:{TrackItemType:{CLIP:1},MediaType:{AUDIO:'Audio'}},TickTime:{createWithTicks:ticks=>({ticks})},
    TrackItemSelection:{createEmptySelection(callback){const items=[];callback({addItem:item=>items.push(item),items});}},
    SequenceEditor:{getEditor:sequence=>{assert.equal(sequence,original);return {
      createInsertProjectItemAction(source,time,v,a,limitShift){assert.equal(locked,true);assert.equal(limitShift,true);assert.equal(v,1);assert.equal(a,1);return()=>{
        inserts++;video[v]||=[];audio[a]||=[];const start=Number(time.ticks)/TPS;
        video[v].push(makeItem('Video',v,source.getId(),start,start+source.duration));
        audio[a].push(makeItem('Audio',a,source.getId(),start,start+source.duration));
      };},
      createRemoveItemsAction(selected,ripple,kind,shift){assert.equal(locked,true);assert.equal(ripple,false);assert.equal(shift,false);assert.equal(kind,'Audio');return()=>{
        selected.items.forEach(item=>{assert.ok(!originals.includes(item));audio[item.index].splice(audio[item.index].indexOf(item),1);removed++;});
      };},
    };}},
  };
  const built={ok:true,frameTicks,phrases:[{sequenceId:'{N1}',startFrame:250,endFrame:275},{sequenceId:'n2',startFrame:750,endFrame:800}]};
  return {ppro,original,project,video,audio,nests,built,originals,stats:()=>({transactions,inserts,removed}),makeItem};
}
test('nested graphics use dedicated tracks without shifting footage or retaining empty nested audio',async()=>{
  const host=fixture(),snapshot=await selection.captureSelection(host.ppro);let journal;
  const before=JSON.stringify(host.originals);
  const result=await placement.placeGraphics(host.ppro,snapshot,host.built,null,async value=>{
    assert.equal(host.stats().inserts,0);journal=value;
  });
  assert.equal(result.status,'delivered');assert.equal(result.trackLabel,'V2');assert.equal(result.cueCount,2);
  assert.equal(JSON.stringify(host.originals),before);assert.equal(host.audio[1].length,0);
  assert.deepEqual(host.video[1].map(item=>[item.source,item.start,item.end]),[['n1',10,11],['n2',30,32]]);
  assert.deepEqual(host.stats(),{transactions:2,inserts:2,removed:2});
  await placement.placeGraphics(host.ppro,snapshot,host.built,journal,async()=>assert.fail('A replay must not reserve another track'));
  assert.equal(host.stats().inserts,2);
});
test('a persisted journal recovers a partially committed insertion without duplicating completed phrases',async()=>{
  const host=fixture(),snapshot=await selection.captureSelection(host.ppro);
  host.video[1]=[host.makeItem('Video',1,'n1',10,11)];host.audio[1]=[];
  const journal={kind:'graphics',status:'placing',built:host.built,videoIndex:1,audioIndex:1};
  assert.equal((await placement.placeGraphics(host.ppro,snapshot,host.built,journal,async()=>{})).cueCount,2);
  assert.equal(host.stats().inserts,1);
});
test('moved or duplicate nested clips, occupied target tracks and missing sources stop automatic replay',async()=>{
  for(const problem of ['moved','duplicate','occupied','missing']) {
    const host=fixture(),snapshot=await selection.captureSelection(host.ppro);
    host.video[1]=[host.makeItem('Video',1,'n1',problem==='moved'?12:10,problem==='moved'?13:11)];host.audio[1]=[];
    if(problem==='duplicate')host.video[1].push(host.makeItem('Video',1,'n1',10,11));
    if(problem==='occupied')host.video[1].push(host.makeItem('Video',1,'foreign',50,51));
    if(problem==='missing')host.nests.pop();
    await assert.rejects(placement.placeGraphics(host.ppro,snapshot,host.built,{kind:'graphics',status:'placing',built:host.built,videoIndex:1,audioIndex:1},async()=>{}));
    assert.equal(host.stats().inserts,0);
  }
});
test('journal persistence failure stops all timeline mutation',async()=>{
  const host=fixture(),snapshot=await selection.captureSelection(host.ppro);
  await assert.rejects(placement.placeGraphics(host.ppro,snapshot,host.built,null,async()=>{throw new Error('Storage failed');}),/Storage failed/);
  assert.deepEqual(host.stats(),{transactions:0,inserts:0,removed:0});
});
