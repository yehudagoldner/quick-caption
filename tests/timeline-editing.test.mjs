import test from 'node:test';
import assert from 'node:assert/strict';
import { EditHistory, snapshot, retimeCaption, validateCaptionRange, validateWordRange, timelineZoomForWindow, timelineScrollForTime, mobileTimelineWindowSeconds, placeCaption, placeMobileCaption } from '../src/timelineEditing.js';
import { placeMobileWord } from '../src/timelineEditing.js';

test('mobile word dragging clamps to the caption and neighbours without moving other words', () => {
  const segment = { id: 9, start: 4.13, end: 7.89, text: 'one two three' };
  const input = [{ word: 'one', start: 4.3, end: 4.9 }, { word: 'two', start: 5.2, end: 5.9 }, { word: 'three', start: 6.2, end: 7.5 }];
  for (const fps of [24, 25, 30, 60]) for (let index = 0; index < input.length; index++) {
    for (const mode of ['move', 'start', 'end']) for (const delta of [-100, -.23, .31, 100]) {
      const next = placeMobileWord(input, index, segment, delta, mode, fps);
      assert.equal(validateWordRange(next[index], segment, next.filter((_, other) => other !== index)), null);
      for (let other = 0; other < input.length; other++) if (other !== index) assert.equal(next[other], input[other]);
      if (mode === 'move') assert.ok(Math.abs(next[index].end - next[index].start - (input[index].end - input[index].start)) < 1e-6);
      assert.ok(next[index].end - next[index].start >= 1 / fps - 1e-6);
    }
  }
  assert.equal(placeMobileWord(input, 0, segment, -100, 'move')[0].start, segment.start);
  assert.equal(placeMobileWord(input, 2, segment, 100, 'end')[2].end, segment.end);
  assert.equal(placeMobileWord(input, 0, segment, NaN, 'move'), input);
  assert.equal(placeMobileWord(input, 0, segment, 0, 'move'), input);
});

test('mobile word dragging protects touching and sub-frame words', () => {
  const segment = { id: 1, start: 0, end: 1, text: 'a b' };
  const input = [{ word: 'a', start: 0, end: .01 }, { word: 'b', start: .01, end: 1 }];
  assert.equal(placeMobileWord(input, 0, segment, 1, 'move'), input);
  assert.equal(placeMobileWord(input, 0, segment, -1, 'end'), input);
  assert.equal(placeMobileWord(input, 0, segment, 1, 'start'), input);
});
test('automatic zoom fits 30 seconds, or the whole shorter recording', () => {
  for (const duration of [6, 30, 90, 3600, 14400]) {
    const zoom = timelineZoomForWindow(duration);
    assert.ok(Math.abs(duration / 2 ** (zoom / 25) - Math.min(30, duration)) < .000001);
  }
});
test('mobile timing opens an editable window instead of the whole recording', () => {
  const segments = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, start: i * 3, end: (i + 1) * 3, text: 'א' }));
  const seconds = mobileTimelineWindowSeconds(segments, 360, 90);
  assert.ok(seconds >= 3 && seconds <= 8);
  assert.ok(seconds < 30);
  const captionPx = 3 / seconds * 360;
  assert.ok(captionPx >= 150 && captionPx <= 170);
  assert.equal(mobileTimelineWindowSeconds([{ id: 1, start: 0, end: 2, text: 'א' }], 360, 2), 2);
});
test('placing a caption keeps neighbours and timed words', () => {
  const segments = [a, b];
  const moved = placeCaption(a, segments, words, 6, .5, 'move', 30);
  assert.equal(moved.end - moved.start, a.end - a.start);
  assert.ok(moved.end <= b.start);
  const blocked = placeCaption(a, segments, words, 6, 5, 'move', 30);
  assert.ok(blocked.end <= b.start + 1e-9);
  assert.equal(blocked.end - blocked.start, a.end - a.start);
  const intoWord = placeCaption(a, segments, words, 6, 1.2, 'start', 30);
  assert.ok(intoWord.start <= words[0].start + 1e-6);
  const endTrim = placeCaption(a, segments, words, 6, -.4, 'end', 30);
  assert.ok(endTrim.end >= words[1].end - 1e-6);
});
test('seeking in either direction reveals the playhead without changing zoom', () => {
  const width = 940, pixelsPerSecond = 30;
  assert.equal(timelineScrollForTime(10, pixelsPerSecond, width, 0), 0);
  const forward = timelineScrollForTime(75, pixelsPerSecond, width, 0);
  assert.ok(forward > 0);
  assert.equal(timelineScrollForTime(75, pixelsPerSecond, width, forward), forward);
  assert.equal(timelineScrollForTime(0, pixelsPerSecond, width, forward), 0);
});
const a = { id: 1, start: 0, end: 2, text: 'שלום עולם' };
const b = { id: 2, start: 3, end: 5, text: 'עוד כתובית' };
const words = [{ word: 'שלום', start: .3, end: .8, segmentId: 1 }, { word: 'עולם', start: 1, end: 1.7, segmentId: 1 }];
test('overlap is rejected without changing the neighbour', () => {
  assert.ok(validateCaptionRange({ ...b, start: 1, end: 3 }, [a, b], 6));
  assert.equal(a.end, 2);
  assert.equal(validateCaptionRange({ ...b, start: 2, end: 4 }, [a, b], 6), null);
});
test('caption moves translate but never stretch word intervals', () => {
  const moved = retimeCaption(a, { ...a, start: 1, end: 3 }, words);
  assert.equal(moved[0].start, 1.3);
  assert.equal(moved[0].end, 1.8);
  assert.deepEqual(words[0], { word: 'שלום', start: .3, end: .8, segmentId: 1 });
});
test('trimming silence leaves every word timestamp unchanged', () => {
  assert.deepEqual(retimeCaption(a, { ...a, start: .2, end: 1.8 }, words), words);
  assert.throws(() => retimeCaption(a, { ...a, end: 1.5 }, words), /מילה מתוזמנת/);
});
test('word edits reject outside, inverted, overlapping, blank and multiword values', () => {
  for (const w of [{ word: 'א', start: 10, end: 11 }, { word: 'א', start: -.1, end: .1 }, { word: 'א', start: 1, end: 0 }, { word: '', start: 0, end: .2 }, { word: 'א ב', start: 0, end: .2 }, { word: 'א', start: NaN, end: .2 }]) assert.ok(validateWordRange(w, a));
  assert.ok(validateWordRange({ word: 'א', start: .4, end: .6 }, a, words));
  assert.equal(validateWordRange({ word: 'א', start: 0, end: .3 }, a, words), null);
});
test('undo/redo restores text, boundaries and word timing together', () => {
  const history = new EditHistory(), before = snapshot([a], words), after = snapshot([{ ...a, text: 'חדש' }], [{ ...words[0], word: 'חדש' }]);
  history.push(before, after);
  assert.deepEqual(history.undo(after), before);
  assert.deepEqual(history.redo(before), after);
  history.undo(after); history.push(before, snapshot([b], []));
  assert.equal(history.redo(before), null);
});
test('history snapshots do not retain mutable references and are bounded', () => {
  const history = new EditHistory();
  for (let i = 0; i < 150; i++) history.push(snapshot([{ ...a, text: String(i) }], words), snapshot([{ ...a, text: String(i + 1) }], words));
  assert.equal(history.past.length, 100);
  words[0].word = 'changed';
  assert.equal(history.past[0].words[0].word, 'שלום');
});


test('mobile trims timed speech down to half a second and protects both neighbours', () => {
  const clips = [{ id: 1, start: 0, end: 2, text: 'a' }, { id: 2, start: 2, end: 4, text: 'b' }, { id: 3, start: 4, end: 6, text: 'c' }];
  for (const fps of [24, 25, 30, 60]) {
    const minimum = Math.ceil(.5 * fps) / fps;
    const trim = placeMobileCaption(clips[1], clips, 6, 100, 'start', fps);
    assert.ok(Math.abs(trim[1].end - trim[1].start - minimum) < 1e-6);
    const right = placeMobileCaption(clips[1], clips, 6, 100, 'end', fps);
    assert.equal(right[1].end, right[2].start);
    assert.ok(Math.abs(right[2].end - right[2].start - minimum) < 1e-6);
    assert.deepEqual(right[0], clips[0]);
    const left = placeMobileCaption(clips[1], clips, 6, -100, 'start', fps);
    assert.equal(left[0].end, left[1].start);
    assert.ok(Math.abs(left[0].end - left[0].start - minimum) < 1e-6);
    assert.deepEqual(left[2], clips[2]);
    for (const delta of [-100, -.4, .4, 100]) {
      const moved = placeMobileCaption(clips[1], clips, 6, delta, 'move', fps);
      assert.ok(Math.abs(moved[1].end - moved[1].start - 2) < 1e-6);
      for (const item of moved) assert.equal(validateCaptionRange(item, moved, 6), null);
    }
  }
  assert.equal(clips[0].end, 2);
  assert.equal(clips[2].start, 4);
});

test('mobile protects existing short captions and the recording edges', () => {
  const clips = [{ id: 1, start: 0, end: 1, text: 'a' }, { id: 2, start: 1, end: 1.2, text: 'b' }];
  assert.deepEqual(placeMobileCaption(clips[0], clips, 1.2, 5, 'end'), clips);
  assert.deepEqual(placeMobileCaption(clips[1], clips, 1.2, -5, 'end'), clips);
  assert.deepEqual(placeMobileCaption(clips[0], clips, 1.2, -5, 'move'), clips);
  const last = placeMobileCaption(clips[1], clips, 2, 5, 'end');
  assert.equal(last[1].end, 2);
});

test('mobile fits words without losing text and undo restores the whole boundary edit', () => {
  const clips = [{ id: 1, start: 0, end: 2, text: 'a b' }, { id: 2, start: 2, end: 4, text: 'c d' }];
  const originalWords = [{ word: 'a', start: 0, end: 1, segmentId: 1 }, { word: 'b', start: 1, end: 2, segmentId: 1 }, { word: 'c', start: 2, end: 3, segmentId: 2 }, { word: 'd', start: 3, end: 4, segmentId: 2 }];
  const next = placeMobileCaption(clips[0], clips, 4, 10, 'end');
  const fitted = retimeCaption(clips[1], next[1], originalWords, true);
  assert.deepEqual(fitted.slice(0, 2), originalWords.slice(0, 2));
  assert.deepEqual(fitted.map(w => w.word), ['a', 'b', 'c', 'd']);
  assert.equal(fitted[2].start, 3.5);
  assert.equal(fitted[3].end, 4);
  assert.ok(fitted[2].end <= fitted[3].start);
  const history = new EditHistory();
  const before = snapshot(clips, originalWords), after = snapshot(next, fitted);
  history.push(before, after);
  assert.deepEqual(history.undo(after), before);
  assert.deepEqual(history.redo(before), after);
  const trimmed = retimeCaption(clips[0], { ...clips[0], end: .5 }, originalWords, true);
  assert.equal(trimmed[0].start, 0);
  assert.equal(trimmed[1].end, .5);
});
