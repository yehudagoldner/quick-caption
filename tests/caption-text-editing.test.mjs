import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticCaptionEnd, editCaptionText, applyCaptionTextEdit } from '../src/captionTextEditing.js';
import { synchronizeWords } from '../src/wordAlignment.js';
import { EditHistory } from '../src/timelineEditing.js';
import { editVideoTranscript, linkVideoRevisions } from '../src/sharedVideoTranscript.js';

const cue = { id: 1, start: 1, end: 2, text: 'שלום עולם' };
const words = [{ word: 'שלום', start: 1, end: 1.5, segmentId: 1, sourceId: 'first', style: { fontColor: '#ff0000' } },
  { word: 'עולם', start: 1.5, end: 2, segmentId: 1, sourceId: 'second' }];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

for (const fps of [24, 25, 30, 60, 120]) test(`inserted words get four frames at ${fps}fps without rescaling existing words`, () => {
  const original = structuredClone(words);
  const next = editCaptionText(cue, words, 'שלום ממש עוד עולם', fps);
  const step = 4 / fps;
  assert.deepEqual(next.words.map(w => w.word), ['שלום', 'ממש', 'עוד', 'עולם']);
  assert.deepEqual(next.words[0], { ...words[0], wordIndex: 0, timingSource: 'original' });
  for (const w of next.words.slice(1, 3)) close(w.end - w.start, step);
  close(next.words[3].start, 1.5 + 2 * step);
  close(next.words[3].end - next.words[3].start, .5);
  close(next.segment.end, 2 + 2 * step);
  assert.equal(next.words[3].sourceId, 'second');
  assert.deepEqual(words, original);
});

test('an insertion uses an existing gap and leaves anchors and caption bounds intact', () => {
  const source = [{ ...words[0], end: 1.2 }, { ...words[1], start: 1.8 }];
  const next = editCaptionText(cue, source, 'שלום ממש עולם', 25);
  close(next.words[1].start, 1.2); close(next.words[1].end, 1.36);
  close(next.words[2].start, 1.8); close(next.words[2].end, 2);
  assert.deepEqual(next.segment, { ...cue, text: 'שלום ממש עולם' });
});

test('splitting a token with a space allocates four frames instead of splitting the original duration', () => {
  const segment = { id: 1, start: 0, end: .1, text: 'something' };
  const next = editCaptionText(segment, [{ word: 'something', start: 0, end: .1, segmentId: 1 }], 'some thing', 25);
  close(next.words[0].end, .1);
  close(next.words[1].end - next.words[1].start, 4 / 25);
  close(next.segment.end, .26);
});

test('existing replacements, deletions and whitespace changes preserve surviving word timing', () => {
  for (const text of ['שלום לכולם', 'עולם', ' שלום\nעולם ']) {
    const next = editCaptionText(cue, words, text, 25);
    assert.equal(next.segment.end, cue.end);
    for (const w of next.words) {
      const before = words.find(old => old.sourceId === w.sourceId);
      close(w.start, before.start); close(w.end, before.end);
    }
  }
});

test('new captions redistribute on every edit and grow in four-frame steps when required', () => {
  const segment = { ...cue, end: 1.5, wordTimingMode: 'automatic' };
  let next = editCaptionText(segment, [], 'אחת שתיים', 25);
  assert.deepEqual(next.words.map(w => [w.start, w.end]), [[1, 1.25], [1.25, 1.5]]);
  next = editCaptionText(next.segment, next.words, 'אחת שתיים שלוש ארבע', 25);
  close(next.segment.end, 1.66);
  for (const word of next.words) close(word.end - word.start, .165);
  next = editCaptionText(next.segment, next.words, 'אחת שתיים שלוש ארבע חמש', 25);
  close(next.segment.end, 1.82);
  for (const word of next.words) close(word.end - word.start, .164);
  next = editCaptionText(next.segment, next.words, 'אחת שתיים', 25);
  close(next.segment.end, 1.82);
  for (const word of next.words) close(word.end - word.start, .41);
  assert.equal(automaticCaptionEnd(next.segment, next.segment.text, 25), next.segment.end);
});

test('extending trims the next caption, keeps its words owned, and undo restores both', () => {
  const neighbour = { id: 2, start: 2, end: 3, text: 'הכתובית הבאה' };
  const initial = { segments: [cue, neighbour], words: synchronizeWords([cue, neighbour], words) };
  const edited = editCaptionText(cue, initial.words, 'שלום עולם נוסף', 25);
  const next = applyCaptionTextEdit(initial.segments, initial.words, edited.segment, edited.words);
  close(next.segments[0].end, 2.16); close(next.segments[1].start, 2.16);
  assert.equal(next.segments[1].end, 3);
  assert.deepEqual(next.words.filter(w => w.segmentId === 1).map(w => w.word), ['שלום', 'עולם', 'נוסף']);
  assert.deepEqual(next.words.filter(w => w.segmentId === 2).map(w => w.word), ['הכתובית', 'הבאה']);
  for (const w of next.words.filter(w => w.segmentId === 2)) assert.ok(w.start >= 2.16 && w.end <= 3);
  const history = new EditHistory(); history.push(initial, next);
  assert.deepEqual(history.undo(next), initial); assert.deepEqual(history.redo(initial), next);
});

test('fully covered captions disappear without leaking their words; JSON reload preserves the policy', () => {
  const neighbour = { id: 2, start: 2, end: 2.1, text: 'למחיקה' };
  const initialWords = synchronizeWords([cue, neighbour], words);
  const edited = editCaptionText(cue, initialWords, 'שלום עולם נוסף', 25);
  const next = applyCaptionTextEdit([cue, neighbour], initialWords, edited.segment, edited.words);
  assert.equal(next.segments.length, 1);
  assert.ok(next.words.every(w => w.segmentId === 1));
  assert.deepEqual(synchronizeWords(next.segments, JSON.parse(JSON.stringify(next.words))), next.words);
  const automatic = JSON.parse(JSON.stringify({ ...cue, wordTimingMode: 'automatic' }));
  const authored = editCaptionText(automatic, words, 'שלום עולם נוסף', 25);
  for (const word of authored.words) close(word.end - word.start, 1 / 3);
});

test('overlong edits stop at the recording boundary without changing the source', () => {
  const before = structuredClone({ cue, words });
  assert.throws(() => editCaptionText(cue, words, 'שלום עולם נוסף', 25, 2), /סוף הסרטון/);
  assert.deepEqual({ cue, words }, before);
});

test('extended text and trimmed neighbours remain synchronized across video versions', () => {
  const neighbour = { id: 2, start: 2, end: 3, text: 'הכתובית הבאה' };
  const revision = { segments: [cue, neighbour], words: synchronizeWords([cue, neighbour], words) };
  const before = linkVideoRevisions({ original: revision, vertical: structuredClone(revision) });
  const edited = editCaptionText(before.original.segments[0], before.original.words, 'שלום עולם נוסף', 25);
  const next = applyCaptionTextEdit(before.original.segments, before.original.words, edited.segment, edited.words);
  const after = editVideoTranscript(before, 'original', next);
  for (const revision of Object.values(after)) {
    assert.deepEqual(revision.words.map(w => w.word), ['שלום', 'עולם', 'נוסף', 'הכתובית', 'הבאה']);
    const inserted = revision.words.find(w => w.word === 'נוסף');
    close(inserted.end - inserted.start, 4 / 25);
    close(revision.segments[0].end, 2.16);
    close(revision.segments[1].start, 2.16);
  }
});
