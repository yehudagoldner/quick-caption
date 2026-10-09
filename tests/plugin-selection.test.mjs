import test from 'node:test';
import assert from 'node:assert/strict';
import selection from '../premiere-plugin/selection.js';
const { planRanges, restoreTimelineSrt, captureSelection, validateSelection, isolatedSelection } = selection;

test('linked audio/video and overlapping selections are counted once; gaps are omitted', () => {
  assert.deepEqual(planRanges([{ start: 30, end: 40 }, { start: 10, end: 20 }, { start: 10, end: 20 }, { start: 15, end: 22 }]),
    [{ start: 10, end: 22, outputStart: 0 }, { start: 30, end: 40, outputStart: 12 }]);
  assert.throws(() => planRanges([{ start: 0, end: NaN }]));
});
test('captions regain their original timeline positions, splitting at omitted gaps', () => {
  const srt = '1\n00:00:00,500 --> 00:00:02,000\nשלום\n\n2\n00:00:04,500 --> 00:00:05,500\nמעבר\n\n3\n00:00:11,000 --> 00:00:12,000\noutside\n';
  const result = restoreTimelineSrt(srt, [{ start: 10, end: 15, outputStart: 0 }, { start: 30, end: 35, outputStart: 5 }]);
  assert.match(result, /00:00:10,500 --> 00:00:12,000/);
  assert.match(result, /00:00:14,500 --> 00:00:15,000/);
  assert.match(result, /00:00:30,000 --> 00:00:30,500/);
  assert.doesNotMatch(result, /outside/);
});

function hostFixture() {
  const time = seconds => ({ seconds, ticks: String(seconds * 1000) });
  const trackItem = (kind, name, start, end, selected = false) => ({ kind, name, start, end, selected, source: name, disabled: false, speed: 1,
    async getMediaType() { return kind; }, async getTrackIndex() { return 0; },
    async getStartTime() { return time(this.start); }, async getEndTime() { return time(this.end); },
    async getInPoint() { return time(0); }, async getOutPoint() { return time(end - start); },
    async getName() { return name; }, async getSpeed() { return this.speed; }, async isSpeedReversed() { return false; },
    async getProjectItem() { return { getId: () => this.source }; },
    async isDisabled() { return this.disabled; }, createMoveAction(delta) { return () => { this.start += delta.seconds; this.end += delta.seconds; }; },
  });
  const originalRows = [trackItem('Audio', 'first', 10, 15, true), trackItem('Video', 'first', 10, 15, true),
    trackItem('Audio', 'unselected', 20, 25), trackItem('Audio', 'last', 30, 35, true)];
  const sequences = [];
  const makeSequence = (id, rows) => ({ guid: id, name: id, rows,
    getAudioTrackCount: async () => 1, getVideoTrackCount: async () => 1,
    async getAudioTrack() { return { isMuted: async () => false, getTrackItems: () => this.rows.filter(row => row.kind === 'Audio') }; },
    async getVideoTrack() { return { isMuted: async () => false, getTrackItems: () => this.rows.filter(row => row.kind === 'Video') }; },
    async getSelection() { return { getTrackItems: async () => this.rows.filter(row => row.selected) }; },
    createCloneAction() { return () => sequences.push(makeSequence('clone', this.rows.map(row => trackItem(row.kind, row.name, row.start, row.end, row.selected)))); },
    async getProjectItem() { return { createSetNameAction: name => () => { this.name = name; } }; },
    createSetInPointAction: () => () => {}, createSetOutPointAction: () => () => {},
  });
  const original = makeSequence('original', originalRows); sequences.push(original);
  let locked = false;
  const deleted = [];
  const project = { guid: 'project', getActiveSequence: async () => original, getSequences: async () => [...sequences],
    lockedAccess(callback) { locked = true; try { callback(); } finally { locked = false; } },
    executeTransaction(callback) { assert.equal(locked, true); const actions = []; callback({ addAction: action => actions.push(action) }); actions.forEach(action => action()); return true; },
    async deleteSequence(sequence) { assert.notEqual(sequence.guid, 'original'); deleted.push(sequence.guid); sequences.splice(sequences.indexOf(sequence), 1); },
  };
  const ppro = { Project: { getActiveProject: async () => project }, ClipProjectItem: { cast: value => value },
    TickTime: { createWithSeconds: time }, Constants: { TrackItemType: { CLIP: 1 }, MediaType: { AUDIO: 'Audio', VIDEO: 'Video' } },
    TrackItemSelection: { createEmptySelection(callback) { const items = []; callback({ addItem: item => items.push(item), items }); } },
    SequenceEditor: { getEditor: sequence => ({ createRemoveItemsAction(selected, ripple) {
      assert.equal(ripple, false); const items = [...selected.items]; return () => { sequence.rows = sequence.rows.filter(row => !items.includes(row)); };
    } }) },
  };
  return { ppro, original, sequences, deleted };
}
test('only the new clone is edited and cleaned up; unselected speech cannot be exported', async () => {
  const host = hostFixture(); const before = host.original.rows.map(row => [row.name, row.start, row.end]);
  const snapshot = await captureSelection(host.ppro);
  assert.equal(snapshot.duration, 10);
  const isolated = await isolatedSelection(host.ppro, snapshot);
  assert.deepEqual(isolated.sequence.rows.map(row => [row.name, row.start, row.end]), [['first', 0, 5], ['first', 0, 5], ['last', 5, 10]]);
  assert.deepEqual(host.original.rows.map(row => [row.name, row.start, row.end]), before);
  await isolated.cleanup(); assert.deepEqual(host.deleted, ['clone']); assert.equal(host.sequences.length, 1);
});
test('editing a captured clip during sign-in aborts before cloning or exporting', async () => {
  const host = hostFixture(); const snapshot = await captureSelection(host.ppro);
  host.original.rows[0].speed = 2;
  await assert.rejects(isolatedSelection(host.ppro, snapshot), /השתנה/);
  assert.equal(host.sequences.length, 1);
});
test('video-only selections request audio before any export', async () => {
  const host = hostFixture(); host.original.rows.forEach(row => { row.selected = row.kind === 'Video'; });
  await assert.rejects(captureSelection(host.ppro), /אודיו/);
});

test('a replacement with matching name and timing cannot reuse a prepared selection', async () => {
  const host = hostFixture(); const snapshot = await captureSelection(host.ppro);
  host.original.rows[0].source = 'different recording';
  await assert.rejects(validateSelection(host.ppro, snapshot), /השתנה/);
  assert.equal(host.sequences.length, 1);
});

test('a host move that changes source timing instead of timeline position is rejected and cleaned up', async () => {
  const host = hostFixture(); const snapshot = await captureSelection(host.ppro);
  host.original.createCloneAction = () => () => {
    const clone = { ...host.original, guid: 'clone', rows: host.original.rows.map(row => ({ ...row, createMoveAction: () => () => {} })) };
    host.sequences.push(clone);
  };
  await assert.rejects(isolatedSelection(host.ppro, snapshot), /תזמון/);
  assert.deepEqual(host.deleted, ['clone']);
  assert.equal(host.original.rows[0].start, 10);
});
