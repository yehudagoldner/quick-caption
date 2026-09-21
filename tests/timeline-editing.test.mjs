import test from 'node:test';
import assert from 'node:assert/strict';
import { EditHistory, snapshot, retimeCaption, validateCaptionRange, validateWordRange, timelineZoomForWindow, timelineScrollForTime, mobileTimelineWindowSeconds, placeCaption } from '../src/timelineEditing.js';
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
