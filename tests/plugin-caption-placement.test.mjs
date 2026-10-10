import test from 'node:test';
import assert from 'node:assert/strict';
import placement from '../premiere-plugin/caption-placement.js';
const { captionPlacementInfo, savedPlacementInfo } = placement;
function fixture() {
  const tracks = [[], [], [], Array(8).fill({}), Array(18).fill({})];
  const sequence = { guid: 'original-sequence', name: 'Original timeline',
    getCaptionTrackCount: async () => tracks.length,
    getCaptionTrack: async index => ({ id: index + 1, getTrackItems: async (type, empty) => {
      assert.equal(type, 1); assert.equal(empty, false); return tracks[index];
    } }),
  };
  const project = { guid: 'original-project', getSequences: async () => [sequence] };
  const ppro = { Constants: { TrackItemType: { CLIP: 1 } }, Project: { getActiveProject: async () => project } };
  const job = { selection: { projectId: project.guid, sequenceId: sequence.guid }, delivery: { status: 'delivered', trackId: '5' } };
  return { ppro, sequence, project, job, tracks };
}
test('a delivered track above empty tracks is identified by ID and reports its actual cue count', async () => {
  const { ppro, sequence, job } = fixture();
  assert.deepEqual(await captionPlacementInfo(ppro, sequence, '5'), { trackId: '5', index: 4, label: 'C5', cueCount: 18 });
  assert.equal((await savedPlacementInfo(ppro, job)).sequenceName, 'Original timeline');
});
test('completion status is not restored into another project, a missing sequence, an empty or removed caption track', async () => {
  const { ppro, project, job, tracks } = fixture();
  project.guid = 'another-project'; assert.equal(await savedPlacementInfo(ppro, job), null);
  project.guid = job.selection.projectId;
  job.selection.sequenceId = 'missing-sequence'; assert.equal(await savedPlacementInfo(ppro, job), null);
  job.selection.sequenceId = 'original-sequence';
  tracks[4] = []; assert.equal(await savedPlacementInfo(ppro, job), null);
  tracks.pop(); assert.equal(await savedPlacementInfo(ppro, job), null);
});
