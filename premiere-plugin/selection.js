const guid = value => value.toString();
const key = row => JSON.stringify([row.media, row.source, row.track, row.startTicks, row.endTicks, row.inTicks, row.outTicks, row.name]);

function planRanges(rows) {
  const ranges = [];
  for (const row of [...rows].sort((a, b) => a.start - b.start)) {
    if (!Number.isFinite(row.start) || !Number.isFinite(row.end) || row.start < 0 || row.end <= row.start) throw new Error('קטע עם תזמון לא תקין');
    const last = ranges[ranges.length - 1];
    if (last && row.start <= last.end + 0.000001) last.end = Math.max(last.end, row.end);
    else ranges.push({ start: row.start, end: row.end });
  }
  let cursor = 0;
  return ranges.map(range => { const result = { ...range, outputStart: cursor }; cursor += range.end - range.start; return result; });
}

async function describe(item) {
  const [media, track, start, end, input, output, name, speed, reversed, disabled, source] = await Promise.all([
    item.getMediaType(), item.getTrackIndex(), item.getStartTime(), item.getEndTime(),
    item.getInPoint(), item.getOutPoint(), item.getName(), item.getSpeed(), item.isSpeedReversed(), item.isDisabled(), item.getProjectItem(),
  ]);
  return { media: guid(media), source: source.getId(), track, start: start.seconds, end: end.seconds,
    startTicks: start.ticks, endTicks: end.ticks, inTicks: input.ticks, outTicks: output.ticks,
    name, speed, reversed: Boolean(reversed), disabled };
}

async function inventory(ppro, sequence) {
  const rows = [];
  for (const kind of ['Audio', 'Video']) {
    const count = await sequence[`get${kind}TrackCount`]();
    for (let i = 0; i < count; i++) {
      const track = await sequence[`get${kind}Track`](i);
      const muted = await track.isMuted();
      for (const item of await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)) {
        rows.push({ ...await describe(item), kind, muted, item });
      }
    }
  }
  return rows;
}

async function captureSelection(ppro) {
  const project = await ppro.Project.getActiveProject();
  const sequence = project && await project.getActiveSequence();
  if (!sequence) throw new Error('פתחו סיקוונס ובחרו קטעים בטיימליין');
  const selected = await (await sequence.getSelection()).getTrackItems();
  if (!selected.length) throw new Error('בחרו את הקטעים הרצויים בטיימליין, כולל קטעי האודיו שלהם');
  const rows = await Promise.all(selected.map(describe));
  const all = await inventory(ppro, sequence);
  const selectedKeys = new Set(rows.map(key));
  const audio = all.filter(row => row.kind === 'Audio' && selectedKeys.has(key(row)) && !row.disabled && !row.muted);
  if (!audio.length) throw new Error('בחרו גם קטעי אודיו שאינם מושתקים כדי ליצור תמלול');
  const ranges = planRanges(rows);
  return { projectId: guid(project.guid), sequenceId: guid(sequence.guid), sequenceName: sequence.name,
    rows, ranges, duration: ranges.reduce((sum, range) => sum + range.end - range.start, 0) };
}

function transact(project, label, build) {
  let success = false;
  project.lockedAccess(() => { success = project.executeTransaction(build, label); });
  if (!success) throw new Error('פרימייר לא השלים את הכנת הבחירה');
}

async function validateSelection(ppro, snapshot, { requireAudible = true } = {}) {
  const project = await ppro.Project.getActiveProject();
  if (!project || guid(project.guid) !== snapshot.projectId) throw new Error('הפרויקט השתנה. בחרו שוב את הקטעים');
  const original = (await project.getSequences()).find(sequence => guid(sequence.guid) === snapshot.sequenceId);
  if (!original) throw new Error('הסיקוונס המקורי אינו זמין');
  const beforeRows = await inventory(ppro, original);
  const selectedKeys = new Set(snapshot.rows.map(key));
  for (const row of snapshot.rows) {
    const current = beforeRows.find(candidate => key(candidate) === key(row));
    if (!current || current.speed !== row.speed || current.reversed !== row.reversed || current.disabled !== row.disabled) {
      throw new Error('אחד הקטעים השתנה מאז הבחירה. בחרו שוב כדי לקבל תזמון נכון');
    }
  }
  if (requireAudible && !beforeRows.some(row => selectedKeys.has(key(row)) && row.kind === 'Audio' && !row.muted && !row.disabled)) {
    throw new Error('קטעי האודיו שנבחרו הושתקו. בחרו שוב את הקטעים');
  }
  return { project, original, selectedKeys, selectedRows: beforeRows.filter(row => selectedKeys.has(key(row))) };
}

async function isolatedSelection(ppro, snapshot) {
  const { project, original, selectedKeys } = await validateSelection(ppro, snapshot);
  const before = new Set((await project.getSequences()).map(sequence => guid(sequence.guid)));
  transact(project, 'Quick Caption: prepare selected clips', compound => compound.addAction(original.createCloneAction()));
  const created = (await project.getSequences()).filter(sequence => !before.has(guid(sequence.guid)));
  if (created.length !== 1) throw new Error('לא ניתן לזהות בבטחה את עותק הסיקוונס לתמלול');
  const clone = created[0];
  // Only this positively identified new sequence may be edited or cleaned up.
  const cleanup = async () => {
    if (guid(clone.guid) === snapshot.sequenceId || before.has(guid(clone.guid))) throw new Error('לא ניתן לנקות עותק לא מזוהה');
    await project.deleteSequence(clone);
  };
  try {
    const projectItem = ppro.ClipProjectItem.cast(await clone.getProjectItem());
    transact(project, 'Quick Caption: name export copy', compound => compound.addAction(projectItem.createSetNameAction(`Quick Caption selection ${Date.now()}`)));
    const all = await inventory(ppro, clone);
    const retained = all.filter(row => selectedKeys.has(key(row)));
    if (retained.length !== snapshot.rows.length) throw new Error('עותק הבחירה אינו תואם למקור');
    const remove = all.filter(row => !selectedKeys.has(key(row)));
    const editor = ppro.SequenceEditor.getEditor(clone);
    if (remove.length) transact(project, 'Quick Caption: isolate selected clips', compound => {
      for (const kind of ['Audio', 'Video']) {
        const group = remove.filter(row => row.kind === kind);
        if (!group.length) continue;
        ppro.TrackItemSelection.createEmptySelection(selection => {
          group.forEach(row => selection.addItem(row.item, true));
          compound.addAction(editor.createRemoveItemsAction(selection, false, ppro.Constants.MediaType[kind.toUpperCase()], false));
        });
      }
    });
    // Collapse only gaps between selected ranges, preserving simultaneous tracks.
    transact(project, 'Quick Caption: compact export copy', compound => {
      for (const row of retained) {
        const range = snapshot.ranges.find(candidate => row.start >= candidate.start - 0.000001 && row.end <= candidate.end + 0.000001);
        if (!range) throw new Error('לא ניתן להתאים קטע למפת התזמון');
        const delta = range.outputStart - range.start;
        if (Math.abs(delta) > 0.000001) compound.addAction(row.item.createMoveAction(ppro.TickTime.createWithSeconds(delta)));
      }
      compound.addAction(clone.createSetInPointAction(ppro.TickTime.createWithSeconds(0)));
      compound.addAction(clone.createSetOutPointAction(ppro.TickTime.createWithSeconds(snapshot.duration)));
    });
    const after = await inventory(ppro, clone);
    if (after.length !== retained.length) throw new Error('עותק הייצוא מכיל קטעים נוספים');
    const expected = retained.map(row => {
      const range = snapshot.ranges.find(candidate => row.start >= candidate.start - 0.000001 && row.end <= candidate.end + 0.000001);
      const delta = range.outputStart - range.start;
      return { ...row, start: row.start + delta, end: row.end + delta };
    });
    for (const row of after) {
      const index = expected.findIndex(candidate => candidate.media === row.media && candidate.source === row.source && candidate.track === row.track &&
        candidate.inTicks === row.inTicks && candidate.outTicks === row.outTicks && candidate.speed === row.speed && candidate.reversed === row.reversed &&
        Math.abs(candidate.start - row.start) < 0.000001 && Math.abs(candidate.end - row.end) < 0.000001);
      if (index < 0) throw new Error('תזמון עותק הייצוא אינו תקין');
      expected.splice(index, 1);
    }
    return { sequence: clone, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

const parseTime = value => {
  const match = /^(\d+):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
  if (!match) throw new Error('תזמון SRT אינו תקין');
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
};
const formatTime = seconds => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
function restoreTimelineSrt(srt, ranges) {
  const cues = [];
  for (const block of srt.replace(/\r/g, '').trim().split(/\n\s*\n/)) {
    if (!block) continue;
    const lines = block.split('\n');
    const times = /^(\d+:\d{2}:\d{2},\d{3}) --> (\d+:\d{2}:\d{2},\d{3})/.exec(lines[1] || '');
    if (!times) throw new Error('מבנה SRT אינו תקין');
    const begin = parseTime(times[1]), finish = parseTime(times[2]);
    for (const range of ranges) {
      const a = Math.max(begin, range.outputStart), b = Math.min(finish, range.outputStart + range.end - range.start);
      if (b > a) cues.push({ start: a - range.outputStart + range.start, end: b - range.outputStart + range.start, text: lines.slice(2).join('\n') });
    }
  }
  return cues.sort((a, b) => a.start - b.start).map((cue, i) => `${i + 1}\n${formatTime(cue.start)} --> ${formatTime(cue.end)}\n${cue.text}`).join('\n\n') + '\n';
}
module.exports = { captureSelection, validateSelection, isolatedSelection, planRanges, restoreTimelineSrt };
