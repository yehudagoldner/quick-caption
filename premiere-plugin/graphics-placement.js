const { validateSelection } = require('./selection.js');
const guid = value => String(value).replace(/[{}]/g, '').toLowerCase();
const uncertain = () => new Error('הגרפיקה השתנתה מאז ניסיון ההצבה. בדקו את הטיימליין לפני שחזור; לא יבוצע תמלול נוסף.');
const ticks = (frame, timebase) => {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame > 86400000 || !/^\d+$/.test(String(timebase))) throw uncertain();
  // Common Adobe frame durations are exactly representable at these lengths.
  return String(frame * Number(timebase));
};
function transaction(project, build) {
  let success = false;
  project.lockedAccess(() => { success = project.executeTransaction(build, 'Quick Caption: active words'); });
  if (!success) throw new Error('פרימייר לא השלים את הצבת הגרפיקה. אפשר לבדוק שוב את אותה משימה.');
}
async function items(ppro, sequence, kind) {
  const rows = [];
  for (let index=0,count=await sequence[`get${kind}TrackCount`]();index<count;index++) {
    const track=await sequence[`get${kind}Track`](index);
    for (const item of await track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false)) {
      const source=await item.getProjectItem();
      rows.push({item,index,trackId:String(track.id),source:source?String(source.getId()):null,start:String((await item.getStartTime()).ticks),end:String((await item.getEndTime()).ticks)});
    }
  }
  return rows;
}
async function resolvePhrases(project, built) {
  if (!built?.ok || !built.phrases?.length || !/^\d+$/.test(built.frameTicks)) throw uncertain();
  const sequences=await project.getSequences(),seen=new Set(),phrases=[];
  let previousEnd=-1;
  for(const phrase of built.phrases) {
    const sequence=sequences.find(sequence=>guid(sequence.guid)===guid(phrase.sequenceId));
    if(!sequence || seen.has(guid(phrase.sequenceId)) || phrase.startFrame<previousEnd || phrase.endFrame<=phrase.startFrame) throw uncertain();
    seen.add(guid(phrase.sequenceId));previousEnd=phrase.endFrame;
    const source=await sequence.getProjectItem();
    phrases.push({...phrase,source,sourceId:String(source.getId()),start:ticks(phrase.startFrame,built.frameTicks),end:ticks(phrase.endFrame,built.frameTicks)});
  }
  return phrases;
}
function matching(phrases, rows, journal) {
  const missing=[];
  for(const phrase of phrases) {
    const found=rows.filter(row=>row.source===phrase.sourceId);
    if(found.length>1 || found.some(row=>row.start!==phrase.start||row.end!==phrase.end||row.index!==journal.videoIndex)) throw uncertain();
    if(!found.length)missing.push(phrase);
  }
  if(rows.some(row=>row.index===journal.videoIndex&&!phrases.some(phrase=>phrase.sourceId===row.source)))throw uncertain();
  return missing;
}
async function graphicsPlacementInfo(ppro, sequence, delivery) {
  if(!delivery?.built)return null;
  const project=await ppro.Project.getActiveProject();
  const phrases=await resolvePhrases(project,delivery.built),rows=await items(ppro,sequence,'Video');
  if(matching(phrases,rows,delivery).length)return null;
  return {kind:'graphics',cueCount:phrases.length,index:delivery.videoIndex,label:`V${delivery.videoIndex+1}`};
}
async function placeGraphics(ppro, snapshot, built, existingJournal, saveJournal) {
  const {project,original}=await validateSelection(ppro,snapshot,{requireAudible:false});
  if(String(await original.getTimebase())!==built.frameTicks)throw uncertain();
  const phrases=await resolvePhrases(project,built);
  if(phrases.some(phrase=>guid(phrase.sequenceId)===guid(original.guid)))throw uncertain();
  let journal=existingJournal;
  const before=await items(ppro,original,'Video');
  if(!journal) {
    if(before.some(row=>phrases.some(phrase=>phrase.sourceId===row.source)))throw uncertain();
    journal={kind:'graphics',status:'placing',built,videoIndex:await original.getVideoTrackCount(),audioIndex:await original.getAudioTrackCount()};
    // Persist ownership and destination before Premiere can commit anything.
    await saveJournal(journal);
  }
  if(!Number.isInteger(journal.videoIndex)||journal.videoIndex<0||!Number.isInteger(journal.audioIndex)||journal.audioIndex<0)throw uncertain();
  const missing=matching(phrases,before,journal);
  const editor=ppro.SequenceEditor.getEditor(original);
  if(missing.length) {
    const audio=await items(ppro,original,'Audio');
    if(audio.some(row=>row.index===journal.audioIndex&&!phrases.some(phrase=>row.source===phrase.sourceId)))throw uncertain();
    await validateSelection(ppro,snapshot,{requireAudible:false});
    transaction(project,compound=>{
      for(const phrase of missing)compound.addAction(editor.createInsertProjectItemAction(phrase.source,ppro.TickTime.createWithTicks(phrase.start),journal.videoIndex,journal.audioIndex,true));
    });
  }
  // Reference audio belongs inside the nest for editing, never in the master mix.
  // Only our new sources on
  // the reserved new audio track may be removed; source audio is never targeted.
  const audio=await items(ppro,original,'Audio');
  const ownedAudio=audio.filter(row=>phrases.some(phrase=>phrase.sourceId===row.source));
  if(ownedAudio.some(row=>row.index!==journal.audioIndex))throw uncertain();
  if(ownedAudio.length)transaction(project,compound=>{
    ppro.TrackItemSelection.createEmptySelection(selection=>{
      ownedAudio.forEach(row=>selection.addItem(row.item,false));
      compound.addAction(editor.createRemoveItemsAction(selection,false,ppro.Constants.MediaType.AUDIO,false));
    });
  });
  await validateSelection(ppro,snapshot,{requireAudible:false});
  const placed=await graphicsPlacementInfo(ppro,original,journal);
  if(!placed)throw uncertain();
  return {...journal,status:'delivered',cueCount:placed.cueCount,trackLabel:placed.label};
}
module.exports={placeGraphics,graphicsPlacementInfo};
