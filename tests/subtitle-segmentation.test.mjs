import test from "node:test";
import assert from "node:assert/strict";
import { limitSubtitleCharacters, reflowSubtitleCharacters, characterCount } from "../src/subtitleSegmentation.js";

test("7–20 characters preserve complete words, punctuation, Unicode and word times", () => {
  const tokens = ["שלום", "לכולם", "מילהארוכהמאודהרבהיותר", "hello,", "👨‍👩‍👧‍👦", "שָׁלוֹם", "end."];
  const words = tokens.map((word, i) => ({word, start: i, end: i + .9}));
  const source = [{id: 1, start: 0, end: 7, text: tokens.join(" ")}];
  for (let limit = 7; limit <= 20; limit++) {
    const result = limitSubtitleCharacters(source, words, limit);
    assert.deepEqual(result.flatMap(s => s.text.split(" ")), tokens);
    assert.ok(result.every(s => characterCount(s.text) <= limit || !s.text.includes(" ")));
    assert.ok(result.every(s => s.end > s.start));
    assert.ok(result.slice(1).every(s => words.some(w => w.start === s.start)));
    const repeated = limitSubtitleCharacters(result, words, 7);
    assert.equal(new Set(repeated.map(s => s.id)).size, repeated.length);
  }
  assert.equal(characterCount("👨‍👩‍👧‍👦"), 1);
});

test("reflow both splits and merges with stable word timing across repeated changes", () => {
  const text = "שלום לכולם זו בדיקה של כתוביות בעברית English words remain whole";
  const words = text.split(" ").map((word, i) => ({ word, start: i * .5, end: i * .5 + .45 }));
  const original = [{ id: 1, start: 0, end: words.at(-1).end, text }];
  const source = structuredClone({ original, words });
  const small = reflowSubtitleCharacters(original, words, 7);
  const large = reflowSubtitleCharacters(small.segments, small.words, 20);
  assert.ok(large.segments.length < small.segments.length);
  for (const result of [small, large, reflowSubtitleCharacters(large.segments, large.words, 7)]) {
    assert.equal(result.segments.map(s => s.text).join(" "), text);
    assert.deepEqual(result.words, words);
    assert.equal(result.segments[0].start, original[0].start);
    assert.equal(result.segments.at(-1).end, original[0].end);
    assert.equal(new Set(result.segments.map(s => s.id)).size, result.segments.length);
  }
  assert.deepEqual({ original, words }, source, "undo source remains immutable");
});

test("reflow respects current edits and deletions instead of restoring stale transcript words", () => {
  const segments = [{ id: 1, start: 1, end: 4, text: "מילים חדשות ושונות" }, { id: 3, start: 5, end: 7, text: "נשארו שלמות" }];
  const oldWords = [{ word: "ישן", start: 1, end: 4 }, { word: "נמחק", start: 4, end: 5 }];
  const small = reflowSubtitleCharacters(segments, oldWords, 7);
  const large = reflowSubtitleCharacters(small.segments, small.words, 20);
  assert.equal(large.segments.map(s => s.text).join(" "), "מילים חדשות ושונות נשארו שלמות");
  assert.equal(large.words.map(w => w.word).join(" "), "מילים חדשות ושונות נשארו שלמות");
  assert.ok(large.segments.every(s => s.end > s.start));
  assert.equal(large.segments[0].start, 1);
  assert.equal(large.segments.at(-1).end, 7);
});

test("reflow preserves pauses, sentence boundaries and whole over-limit Unicode words", () => {
  const segments = [
    { id: 1, start: 0, end: 1, text: "שלום." },
    { id: 2, start: 1, end: 2, text: "לכולם" },
    { id: 3, start: 4, end: 5, text: "מילהארוכהמאודהרבהיותר" },
    { id: 4, start: 5, end: 6, text: "👨‍👩‍👧‍👦 שָׁלוֹם" },
  ];
  const result = reflowSubtitleCharacters(segments, [], 7);
  assert.equal(result.segments[0].text, "שלום.");
  assert.equal(result.segments[1].end, 2);
  assert.equal(result.segments[2].start, 4);
  assert.equal(result.segments[2].text, "מילהארוכהמאודהרבהיותר");
  assert.equal(result.segments.at(-1).text, "👨‍👩‍👧‍👦 שָׁלוֹם");
  assert.throws(() => reflowSubtitleCharacters(segments, [], 25), RangeError);
  assert.deepEqual(reflowSubtitleCharacters([], [], 20), { segments: [], words: [] });
  const automatic = reflowSubtitleCharacters([{ id:1, start:0, end:6, text:"one two three four five six" }], [], null);
  assert.equal(automatic.segments.length, 2);
});

test("edited text wins over stale word metadata; missing times preserve duration", () => {
  const source = [{id:"chars-0", start:2, end:9, text:"טקסט מתוקן נשאר שלם גם אחרי חלוקה"}];
  const result = limitSubtitleCharacters(source, [{word:"ישן", start:2, end:9}], 7);
  assert.equal(result.map(s => s.text).join(" "), source[0].text);
  assert.equal(result[0].start,2); assert.equal(result.at(-1).end,9);
  assert.ok(result.every(s => s.end > s.start));
  assert.throws(() => limitSubtitleCharacters(source, [], 0), RangeError);
});
