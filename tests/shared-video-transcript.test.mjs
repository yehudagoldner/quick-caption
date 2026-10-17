import test from 'node:test';
import assert from 'node:assert/strict';
import { editVideoTranscript, linkVideoRevisions } from '../src/sharedVideoTranscript.js';
import { editCaptionBatch } from '../src/captionBatchEditing.js';
import { synchronizeWords } from '../src/wordAlignment.js';

function fixture() {
  const segments = [{ id: 1, start: 0, end: 5, text: 'שלום שלום עולם יפה' }];
  const words = ['שלום', 'שלום', 'עולם', 'יפה'].map((word, i) => ({ word, start: i + .1, end: i + .6, segmentId: 1 }));
  const original = { segments, words };
  const vertical = editCaptionBatch(segments, words, [1], 'split', 2);
  vertical.segments[1].style = { fontColor: '#ff0000' };
  return linkVideoRevisions({ original, vertical, square: structuredClone(original) });
}
const edit = (revision, index, word) => {
  const next = structuredClone(revision); next.words[index] = { ...next.words[index], ...word };
  next.segments = next.segments.map(s => ({ ...s, text: next.words.filter(w => w.segmentId === s.id).map(w => w.word).join(' ') }));
  return next;
};
const tokens = r => r.words.map(w => w.word);

test('corrects only the selected repeated word across different splits, preserving ranges/styles and inputs', () => {
  const before = fixture(), snapshot = structuredClone(before);
  const after = editVideoTranscript(before, 'vertical', edit(before.vertical, 1, { word: 'שולם' }));
  for (const r of Object.values(after)) assert.deepEqual(tokens(r), ['שלום', 'שולם', 'עולם', 'יפה']);
  assert.deepEqual(after.vertical.segments.map(s => [s.id, s.start, s.end, s.style]), before.vertical.segments.map(s => [s.id, s.start, s.end, s.style]));
  assert.equal(after.original.segments.length, 1); assert.equal(after.vertical.segments.length, 2);
  assert.deepEqual(before, snapshot);
});
test('word times follow source identity across captions, including independently clipped presentation', () => {
  let before = fixture();
  const trimmed = structuredClone(before.vertical); trimmed.segments[1].start = 2.4;
  before = editVideoTranscript(before, 'vertical', trimmed, { layoutOnly: true });
  assert.equal(before.vertical.words[2].sourceStart, 2.1);
  const after = editVideoTranscript(before, 'original', edit(before.original, 2, { start: 2.2, end: 2.8 }));
  for (const r of Object.values(after)) { assert.equal(r.words[2].sourceStart, 2.2); assert.equal(r.words[2].sourceEnd, 2.8); }
  assert.equal(after.square.words[2].start, 2.2);
  assert.equal(after.vertical.segments[1].start, 2.4);
  assert.equal(after.vertical.words[2].start, 2.4);
  const corrected = editVideoTranscript(after, 'vertical', edit(after.vertical, 2, { word: 'תבל' }));
  assert.equal(corrected.original.words[2].start, 2.2, 'a text correction must not publish the local clip as a timing edit');
});
test('insertions and deletions propagate while keeping independent caption membership', () => {
  let before = fixture();
  const next = structuredClone(before.vertical); next.segments[1].text = 'כל העולם יפה';
  next.words = synchronizeWords(next.segments, next.words);
  const after = editVideoTranscript(before, 'vertical', next);
  for (const r of Object.values(after)) assert.deepEqual(tokens(r), ['שלום', 'שלום', 'כל', 'העולם', 'יפה']);
  assert.equal(after.vertical.segments[0].text, 'שלום שלום');
  const deleted = structuredClone(after.original); deleted.words.splice(1, 1);
  deleted.segments[0].text = deleted.words.map(w => w.word).join(' ');
  const final = editVideoTranscript(after, 'original', deleted);
  for (const r of Object.values(final)) assert.deepEqual(tokens(r), ['שלום', 'כל', 'העולם', 'יפה']);
  assert.equal(final.vertical.segments[0].text, 'שלום');
});
test('split, merge and local timing do not rewrite the shared transcript', () => {
  const before = fixture();
  const split = editCaptionBatch(before.original.segments, before.original.words, [1], 'split', 1.3);
  const after = editVideoTranscript(before, 'original', split, { layoutOnly: true });
  assert.deepEqual(after.square, before.square);
  assert.deepEqual(after.original.words.map(w => [w.sourceId, w.sourceStart, w.sourceEnd]), before.original.words.map(w => [w.sourceId, w.sourceStart, w.sourceEnd]));
  assert.equal(after.original.segments[0].end, 1.3);
});
test('shared IDs survive JSON reload, original without metadata, and long transcripts', () => {
  const before = fixture();
  const original = structuredClone(before.original);
  original.words = original.words.map(({ sourceId, sourceStart, sourceEnd, ...w }) => w);
  const linked = linkVideoRevisions({ ...JSON.parse(JSON.stringify(before)), original }, before.original);
  assert.deepEqual(linked.original.words.map(w => w.sourceId), before.original.words.map(w => w.sourceId));
  const segments = Array.from({ length: 3000 }, (_, i) => ({ id: i, start: i, end: i + 1, text: `מילה${i}` }));
  const large = linkVideoRevisions({ original: { segments, words: [] }, vertical: { segments, words: [] } });
  const next = edit(large.vertical, 1500, { word: 'תיקון' });
  const after = editVideoTranscript(large, 'vertical', next);
  assert.equal(after.original.words[1500].word, 'תיקון'); assert.equal(after.original.words.length, 3000);
});
test('replacements retain manual line breaks; deleting every word leaves an empty local caption', () => {
  const before = fixture(); before.square.segments[0].text = 'שלום שלום\nעולם יפה';
  const after = editVideoTranscript(before, 'vertical', edit(before.vertical, 2, { word: 'תבל' }));
  assert.equal(after.square.segments[0].text, 'שלום שלום\nתבל יפה');
  const empty = editVideoTranscript(after, 'original', { segments: [{ ...after.original.segments[0], text: '' }], words: [] });
  assert.equal(empty.vertical.segments.length, 2); assert.ok(empty.vertical.segments.every(s => s.text === ''));
  assert.deepEqual(empty.square.words, []);
});
test('a local split cannot hide a conflicting source word during timing edits', () => {
  const before = fixture();
  const split = editCaptionBatch(before.vertical.segments, before.vertical.words, [1], 'split', .4);
  const local = editVideoTranscript(before, 'vertical', split, { layoutOnly: true });
  const overlap = edit(local.vertical, 1, { start: .45 });
  assert.throws(() => editVideoTranscript(local, 'vertical', overlap), /התזמון חופף/);
});
