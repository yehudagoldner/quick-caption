import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeWordOverrides, styleCaptionWords, moveCaptionWords, wordDragDelta } from '../src/wordOverrides.js';
import { synchronizeWords } from '../src/wordAlignment.js';
import { linkVideoRevisions, editVideoTranscript } from '../src/sharedVideoTranscript.js';
import { editCaptionBatch } from '../src/captionBatchEditing.js';
import { renderStyledCaptionsAss } from '../src/styledCaptions.js';

const segments = [{ id: 1, start: 0, end: 4, text: 'שלום שלום עולם' }];
const revision = () => ({ segments, words: synchronizeWords(segments) });
const style = { fontColor: '#ff0000', fontScale: 1.5, bold: true };

test('word movement accounts for rotation, preserves group offsets and rejects unsafe coordinates', () => {
  assert.deepEqual(sanitizeWordOverrides({ offsetX: Infinity, offsetY: '12' }), {});
  assert.deepEqual(sanitizeWordOverrides({ offsetX: 500, offsetY: -500 }), { offsetX: 30, offsetY: -30 });
  const delta = wordDragDelta(0, 40, 20, 90);
  assert.ok(Math.abs(delta.x - 2) < 1e-6); assert.ok(Math.abs(delta.y) < 1e-6);
  const words = revision().words; words[0].style = { offsetX: 1, fontColor: '#ff0000' };
  const moved = moveCaptionWords(words, 1, [0, 1], { x: 2, y: -1 });
  assert.equal(moved[0].style.offsetX, 3); assert.equal(moved[1].style.offsetX, 2); assert.equal(moved[2].style, undefined);
  assert.deepEqual(styleCaptionWords(moved, 1, [0], { offsetX: 0, offsetY: 0 })[0].style, { fontColor: '#ff0000' });
});

test('word appearance is allowlisted, bounded and resets to inheritance', () => {
  assert.deepEqual(sanitizeWordOverrides({ fontColor: '#fff}\\p1', fontScale: Infinity, bold: 'yes', rotation: 20 }), {});
  assert.deepEqual(sanitizeWordOverrides({ fontScale: 999, bold: false }), { fontScale: 2 });
  assert.deepEqual(sanitizeWordOverrides({ fontScale: -1, fontColor: '#AABBCC', bold: true }), { fontScale: .5, fontColor: '#AABBCC', bold: true });
  const words = revision().words;
  const styled = styleCaptionWords(words, 1, [1], style);
  assert.equal(styled[0].style, undefined); assert.deepEqual(styled[1].style, style);
  assert.deepEqual(styleCaptionWords(styled, 1, [1], null), words);
  assert.equal(styleCaptionWords(styled, 1, [1], { bold: false })[1].style.bold, undefined);
});

test('word styles stay local through shared corrections, timing edits, split, merge and JSON reload', () => {
  let all = linkVideoRevisions({ original: revision(), vertical: revision() });
  const localStyle = { ...style, offsetX: 1, offsetY: -2 };
  all = editVideoTranscript(all, 'vertical', { ...all.vertical, words: styleCaptionWords(all.vertical.words, 1, [1], localStyle) }, { layoutOnly: true });
  assert.equal(all.original.words[1].style, undefined);
  const next = structuredClone(all.original);
  next.segments[0].text = 'שלום שלומות עולם'; next.words[1].word = 'שלומות'; next.words[1].start += .1;
  all = editVideoTranscript(all, 'original', next);
  assert.deepEqual(all.vertical.words[1].style, localStyle);
  assert.equal(all.vertical.words[1].word, 'שלומות');
  assert.equal(all.vertical.words[1].sourceStart, next.words[1].start);
  const split = editCaptionBatch(all.vertical.segments, all.vertical.words, [1], 'split', 1.5);
  all = editVideoTranscript(all, 'vertical', split, { layoutOnly: true });
  const merged = editCaptionBatch(all.vertical.segments, all.vertical.words, all.vertical.segments.map(s => s.id), 'merge');
  all = editVideoTranscript(all, 'vertical', merged, { layoutOnly: true });
  all = linkVideoRevisions(JSON.parse(JSON.stringify(all)));
  assert.deepEqual(all.vertical.words[1].style, localStyle); assert.equal(all.original.words[1].style, undefined);
});

for (const mode of ['normal', 'active', 'pop']) test(`${mode}: export applies word overrides and restores caption inheritance`, () => {
  const words = styleCaptionWords(revision().words, 1, [1], style);
  const ass = renderStyledCaptionsAss(segments, words, { fontId: 'assistant', fontSize: 60, fontColor: '#ffffff', activeWordEnabled: mode === 'active', captionMotion: mode === 'pop' ? 'pop' : 'none' });
  assert.match(ass, /\\1c&H0000ff&\\fs90\.00\\b900/);
  if (mode !== 'pop') assert.match(ass, /שלום\{\\fs60\\b0\\1c&Hffffff&\}/);
  if (mode === 'active') assert.match(ass, /\\b900\\1c&H00d7ff&/);
  if (mode === 'pop') assert.match(ass, /\\b900\\fscx82/);
  assert.deepEqual(words[1].style, style);
});
