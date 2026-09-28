import test from 'node:test';
import assert from 'node:assert/strict';
import { canMergeCaptions, editCaptionBatch } from '../src/captionBatchEditing.js';
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
