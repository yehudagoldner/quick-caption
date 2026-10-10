// A new track ID alone does not establish that captions reached the timeline.
async function captionPlacementInfo(ppro, sequence, trackId) {
  for (let index = 0, count = await sequence.getCaptionTrackCount(); index < count; index++) {
    const track = await sequence.getCaptionTrack(index);
    if (String(track.id) !== String(trackId)) continue;
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    return { trackId: String(track.id), index, label: `C${index + 1}`, cueCount: items.length };
  }
  return null;
}
async function savedPlacementInfo(ppro, job) {
  if (job?.delivery?.status !== 'delivered' || !job.selection) return null;
  const project = await ppro.Project.getActiveProject();
  if (!project || String(project.guid) !== job.selection.projectId) return null;
  const sequence = (await project.getSequences()).find(item => String(item.guid) === job.selection.sequenceId);
  if (!sequence) return null;
  const info = await captionPlacementInfo(ppro, sequence, job.delivery.trackId);
  return info?.cueCount ? { ...info, sequenceName: sequence.name || job.selection.sequenceName } : null;
}
module.exports = { captionPlacementInfo, savedPlacementInfo };
