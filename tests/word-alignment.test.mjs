import test from "node:test";
import assert from "node:assert/strict";
import { activeWordAtTime, mergeCorrectedSegments, subtitleTokens, synchronizeWords } from "../src/wordAlignment.js";
import { limitSubtitleCharacters, reflowSubtitleCharacters } from "../src/subtitleSegmentation.js";

function verify(segments, words) {
  for (const segment of segments) {
    const owned = words.filter(w => w.segmentId === segment.id);
    assert.deepEqual(owned.map(w => w.word), subtitleTokens(segment.text));
    assert.deepEqual(owned.map(w => w.wordIndex), owned.map((_, i) => i));
    owned.forEach((w, i) => {
      assert.ok(Number.isFinite(w.start) && Number.isFinite(w.end));
      assert.ok(w.start >= segment.start && w.end <= segment.end, JSON.stringify({ segment, w }));
      assert.ok(w.end > w.start);
      if (i) assert.ok(w.start >= owned[i - 1].end);
      assert.equal(activeWordAtTime(owned, (w.start + w.end) / 2), w);
    });
  }
  assert.deepEqual(synchronizeWords(segments, JSON.parse(JSON.stringify(words))), words, "serialization and reloading are idempotent");
}

test("punctuation, repeated words, Hebrew marks and English contractions remain whole and indexed", () => {
  const segment = { id: 0, start: 0, end: 3, text: "כן, כן! שָׁלוֹם don't 👋" };
  const input = ["כן", "כן", "שלום", "don't", "👋"].map((word, i) => ({ word, start: i * .5, end: i * .5 + .4 }));
  const result = synchronizeWords([segment], input);
  verify([segment], result);
  assert.equal(activeWordAtTime(result, .1).wordIndex, 0);
  assert.equal(activeWordAtTime(result, .6).wordIndex, 1);
  assert.equal(activeWordAtTime(result, .45), null, "do not highlight during silence");
  assert.deepEqual(result.map(w => [w.start, w.end]), input.map(w => [w.start, w.end]));
});

test("insertions at start, middle, end receive bounded times; deleted words never return", () => {
  const segment = { id: "a", start: 0, end: 3, text: "חדש שלום ממש עולם נוסף" };
  const source = [
    { word: "שלום", start: 0, end: 1 },
    { word: "עולם", start: 1, end: 2 },
    { word: "למחיקה", start: 2, end: 3 },
  ];
  const result = synchronizeWords([segment], source);
  verify([segment], result);
  assert.ok(result.some(w => w.timingSource === "estimated"));
  const deleted = synchronizeWords([{ ...segment, text: "שלום עולם" }], source);
  assert.deepEqual(deleted.map(w => w.word), ["שלום", "עולם"]);
});

test("one-to-many and many-to-one corrections retain the corresponding source span", () => {
  const segment = { id: 1, start: 0, end: 2, text: "some thing בעולם" };
  const source = [{ word: "something", start: 0, end: 1 }, { word: "ב", start: 1, end: 1.2 }, { word: "עולם", start: 1.2, end: 2 }];
  const result = synchronizeWords([segment], source);
  verify([segment], result);
  assert.equal(result[0].start, 0); assert.equal(result[1].end, 1);
  assert.equal(result[2].start, 1); assert.equal(result[2].end, 2);
});

test("no timing data, corrupt timestamps, punctuation-only legacy entries and crossing boundaries", () => {
  const segments = [{ id: 1, start: 0, end: 1, text: "שלום עולם" }, { id: 2, start: 1, end: 2, text: "עוד מילים כאן" }];
  for (const source of [[], [{ word: "שלום", start: NaN, end: 1 }, { word: "עולם", start: 0, end: 0 }], [{ word:"שלום",start:0,end:.6 }, { word:",",start:.6,end:.7 }, { word:"עולם",start:.7,end:1.1 }, { word:"עוד",start:1,end:1.4 }]]) {
    verify(segments, synchronizeWords(segments, source));
  }
});

test("partial/reordered model responses cannot silently drop whole base captions", () => {
  const base = [{ id: 0, start: 0, end: 1, text: "ראשון" }, { id: 1, start: 1, end: 2, text: "שני" }];
  const corrected = mergeCorrectedSegments(base, [{ id: "1", start: 99, end: 100, text: "מתוקן" }]);
  assert.deepEqual(corrected, [base[0], { ...base[1], text: "מתוקן" }]);
  verify(corrected, synchronizeWords(corrected));
  assert.throws(() => mergeCorrectedSegments(base, [{id:0}, {id:"0"}]));
  assert.throws(() => mergeCorrectedSegments(base, [{id:10}]));
});

test("splitting, reflow, moving and JSON reload preserve the complete word map", () => {
  const base = [{id:1,start:0,end:4,text:"שלום לכולם אלו מילים מתוקנות שנשארות בתמלול"}];
  let words = synchronizeWords(base);
  let segments = limitSubtitleCharacters(base, words, 7);
  words = synchronizeWords(segments, words);
  verify(segments, words);
  const regrouped = reflowSubtitleCharacters(segments, words, 20);
  verify(regrouped.segments, synchronizeWords(regrouped.segments, regrouped.words));
  segments = segments.map(s => ({ ...s, start: s.start + 2, end: s.end + 2 }));
  words = words.map(w => ({ ...w, start: w.start + 2, end: w.end + 2 }));
  verify(segments, synchronizeWords(segments, words));
  assert.equal(words.map(w => w.word).join(" "), base[0].text);
});

test("varied corrections always preserve every current token with legal intervals", () => {
  for (let count = 1; count <= 35; count++) {
    const source = Array.from({ length: count }, (_, i) => ({ word: `word${i}`, start: i / count, end: (i + 1) / count }));
    const tokens = source.flatMap((w, i) => i % 5 === 0 ? [] : i % 3 === 0 ? ["inserted", w.word] : [w.word]);
    const segments = [{ id: 1, start: 0, end: 1, text: ["begin", ...tokens, "end"].join(" ") }];
    verify(segments, synchronizeWords(segments, source));
  }
});
