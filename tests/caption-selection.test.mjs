import test from 'node:test';
import assert from 'node:assert/strict';
import { moveCaptionSelection } from '../src/captionSelection.js';
import { retimeCaption } from '../src/timelineEditing.js';
const clips = [{ id: 1, start: .505, end: 1.205, text: 'one' }, { id: 2, start: 1.605, end: 2.305, text: 'two' }, { id: 3, start: 3, end: 3.5, text: 'three' }];
test('group nudges use one common frame delta without quantizing original boundaries or gaps', () => {
  const result = moveCaptionSelection(clips, [1, 2], .04, 4, 25);
  for (let i = 0; i < 2; i++) {
    assert.ok(Math.abs(result[i].start - clips[i].start - .04) < 1e-9);
    assert.ok(Math.abs(result[i].end - clips[i].end - .04) < 1e-9);
  }
  assert.equal(result[2], clips[2]);
  assert.deepEqual(clips[0], { id: 1, start: .505, end: 1.205, text: 'one' });
});
test('dragging clamps all captions before neighbours and recording edges, in whole frames', () => {
  const right = moveCaptionSelection(clips, [1, 2], 100, 4, 25);
  assert.ok(Math.abs(right[1].end - 2.985) < 1e-9);
  const left = moveCaptionSelection(clips, [1, 2], -100, 4, 25);
  assert.ok(Math.abs(left[0].start - .025) < 1e-9);
  const all = moveCaptionSelection(clips, [1, 2, 3], 100, 4, 25);
  assert.ok(all[2].end <= 4);
  assert.ok(all[2].end > 3.95);
});
test('unselected captions between selections remain barriers, never crossed by large drags', () => {
  const result = moveCaptionSelection(clips, [1, 3], 100, 4, 25);
  assert.equal(result[1], clips[1]);
  assert.ok(result[0].end <= clips[1].start + 1e-6);
  assert.ok(Math.abs(result[0].start - clips[0].start - (result[2].start - clips[2].start)) < 1e-9);
  assert.equal(moveCaptionSelection(clips, [], 1, 4), clips);
  assert.equal(moveCaptionSelection(clips, [1], NaN, 4), clips);
});
test('group move translates each owned word once, including legacy words without IDs', () => {
  const words = [{ word: 'one', start: .6, end: 1 }, { word: 'two', start: 1.7, end: 2, segmentId: 2 }, { word: 'three', start: 3, end: 3.5, segmentId: 3 }];
  const result = moveCaptionSelection(clips, [1, 2], .2, 4);
  let nextWords = words;
  result.forEach((next, index) => {
    const retimed = retimeCaption(clips[index], next, words);
    nextWords = nextWords.map((word, i) => retimed[i] !== words[i] ? retimed[i] : word);
  });
  assert.ok(Math.abs(nextWords[0].start - .8) < 1e-9);
  assert.ok(Math.abs(nextWords[1].start - 1.9) < 1e-9);
  assert.equal(nextWords[2].start, 3);
});
