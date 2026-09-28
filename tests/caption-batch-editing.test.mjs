import test from 'node:test';
import assert from 'node:assert/strict';
import { canMergeCaptions, canSplitCaptionAtTime, editCaptionBatch } from '../src/captionBatchEditing.js';
import { EditHistory, snapshot } from '../src/timelineEditing.js';

const segments = [
  { id: 10, start: 0, end: 1, text: 'שלום עולם' },
  { id: 'second', start: 1.4, end: 2.5, text: 'שלום שוב' },
  { id: 30, start: 3, end: 4, text: 'סוף' },
];
const words = [
  { word: 'שלום', start: .1, end: .4, segmentId: 10, timingSource: 'original' },
  { word: 'עולם', start: .5, end: .9, segmentId: 10 },
  { word: 'שלום', start: 1.5, end: 1.8, segmentId: 'second' },
  { word: 'שוב', start: 2.1, end: 2.4, segmentId: 'second' },
  { word: 'סוף', start: 3.2, end: 3.9, segmentId: 30 },
];

test('merging preserves chronological text, silence, repeated words and their exact times', () => {
  const before = structuredClone({ segments, words });
  const next = editCaptionBatch(segments, words, ['second', 10], 'merge');
  assert.deepEqual(next.segments, [{ id: 10, start: 0, end: 2.5, text: 'שלום עולם שלום שוב' }, segments[2]]);
  assert.deepEqual(next.words.map(({ word, start, end }) => ({ word, start, end })), words.map(({ word, start, end }) => ({ word, start, end })));
  assert.deepEqual(next.words.slice(0, 4).map(w => [w.segmentId, w.wordIndex]), [[10, 0], [10, 1], [10, 2], [10, 3]]);
  assert.equal(next.words[0].timingSource, 'original');
  assert.deepEqual({ segments, words }, before);
});

test('merge requires adjacent captions and rejects stale selections', () => {
  assert.equal(canMergeCaptions(segments, [10, 30]), false);
  assert.equal(canMergeCaptions(segments, [10]), false);
  assert.equal(canMergeCaptions(segments, ['10', 'second']), true);
  assert.throws(() => editCaptionBatch(segments, words, [10, 30], 'merge'), /רצופות/);
  assert.throws(() => editCaptionBatch(segments, words, [10, 'missing'], 'delete'), /הבחירה השתנתה/);
  assert.throws(() => editCaptionBatch(segments, words, [], 'delete'), /הבחירה השתנתה/);
});

test('disjoint deletion removes only selected captions and their words, including legacy word data', () => {
  const next = editCaptionBatch(segments, words.map(({ segmentId, ...word }) => word), [10, 30], 'delete');
  assert.deepEqual(next.segments, [segments[1]]);
  assert.deepEqual(next.words.map(w => [w.word, w.start, w.end]), [['שלום', 1.5, 1.8], ['שוב', 2.1, 2.4]]);
  assert.deepEqual(editCaptionBatch(segments, words, [10, 'second', 30], 'delete'), { segments: [], words: [] });
});

test('each batch is one undoable revision and missing timing can still be merged', () => {
  for (const action of ['merge', 'delete']) {
    const before = snapshot(segments, words);
    const after = editCaptionBatch(segments, words, [10, 'second'], action);
    const history = new EditHistory();
    history.push(before, after);
    assert.deepEqual(history.undo(after), before);
    assert.deepEqual(history.redo(before), after);
  }
  const next = editCaptionBatch(segments, [], [10, 'second'], 'merge');
  assert.equal(next.words.length, 5);
  for (const word of next.words) {
    const owner = next.segments.find(s => s.id === word.segmentId);
    assert.ok(word.start >= owner.start && word.end <= owner.end && word.end > word.start);
  }
});

test('split uses the exact cursor in a pause and preserves all word times and neighbouring captions', () => {
  const original = { id: 10, start: 0, end: 2.5, text: 'שלום עולם שלום שוב' };
  const source = [original, segments[2]];
  const timed = words.map(word => ({ ...word, segmentId: word.segmentId === 'second' ? 10 : word.segmentId }));
  const next = editCaptionBatch(source, timed, [10], 'split', 1.2);
  assert.deepEqual(next.segments, [
    { id: 10, start: 0, end: 1.2, text: 'שלום עולם' },
    { id: '10-split', start: 1.2, end: 2.5, text: 'שלום שוב' },
    segments[2],
  ]);
  assert.deepEqual(next.words.map(({ word, start, end }) => ({ word, start, end })), timed.map(({ word, start, end }) => ({ word, start, end })));
  assert.deepEqual(next.words.map(word => word.wordIndex), [0, 1, 0, 1, 0]);
  const history = new EditHistory();
  const before = snapshot(source, timed);
  history.push(before, next);
  assert.deepEqual(history.undo(next), before);
});

test('split inside speech clips only crossing word timing and never duplicates or drops text', () => {
  for (const cut of [.05, .25, .7, .95]) {
    const next = editCaptionBatch(segments, words, [10], 'split', cut);
    assert.equal(next.segments[0].end, cut);
    assert.equal(next.segments[1].start, cut);
    assert.deepEqual(next.words.map(word => word.word), words.map(word => word.word));
    for (const word of next.words) {
      const owner = next.segments.find(segment => segment.id === word.segmentId);
      assert.ok(word.start >= owner.start && word.end <= owner.end && word.start < word.end);
    }
    assert.deepEqual(next.segments.slice(2), segments.slice(1));
  }
  const next = editCaptionBatch(segments, words, [10], 'split', .7);
  assert.equal(next.words[0].start, .1);
  assert.equal(next.words[0].end, .4);
  assert.equal(next.words[1].start, .7);
  assert.equal(next.words[1].end, .9);
});

test('split rejects invalid cursors and selections and supports missing times and existing split IDs', () => {
  for (const cut of [NaN, -1, 0, 1, 2]) {
    assert.equal(canSplitCaptionAtTime(segments[0], cut), false);
    assert.throws(() => editCaptionBatch(segments, words, [10], 'split', cut));
  }
  assert.equal(canSplitCaptionAtTime(segments[2], 3.5), false);
  assert.throws(() => editCaptionBatch(segments, words, [10, 'second'], 'split', .5));
  const source = [...segments, { id: '10-split', start: 5, end: 6, text: 'אחרת' }];
  const next = editCaptionBatch(source, [], [10], 'split', .4);
  assert.equal(next.segments[1].id, '10-split-2');
  assert.equal(next.words.length, 6);
  assert.equal(new Set(next.segments.map(segment => String(segment.id))).size, next.segments.length);
});
