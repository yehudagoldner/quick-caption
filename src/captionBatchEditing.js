import { subtitleTokens, synchronizeWords } from "./wordAlignment.js";
import { validateCaptionRange } from "./timelineEditing.js";

export function canMergeCaptions(segments, selectedIds) {
  const ids = new Set(selectedIds.map(String));
  const ordered = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const indexes = ordered.flatMap((segment, index) => ids.has(String(segment.id)) ? [index] : []);
  return indexes.length >= 2 && indexes.length === ids.size && indexes.at(-1) - indexes[0] + 1 === indexes.length;
}

export function canSplitCaptionAtTime(segment, time) {
  return !!segment && subtitleTokens(segment.text).length >= 2 && Number.isFinite(time)
    && time > segment.start + .000001 && time < segment.end - .000001;
}

export function editCaptionBatch(segments, words, selectedIds, action, splitTime) {
  const ids = new Set(selectedIds.map(String));
  const selected = segments.filter(segment => ids.has(String(segment.id))).sort((a, b) => a.start - b.start || a.end - b.end);
  if (!ids.size || selected.length !== ids.size) throw new Error("הבחירה השתנתה. סמנו שוב את הכתוביות.");
  const aligned = synchronizeWords(segments, words);
  const keptWords = aligned.filter(word => !ids.has(String(word.segmentId)));
  if (action === "split") {
    const original = selected[0];
    if (selected.length !== 1 || !canSplitCaptionAtTime(original, splitTime)) throw new Error("לפיצול יש לבחור כתובית אחת עם שתי מילים לפחות, ולהזיז את הקו לתוכה.");
    const timed = aligned.filter(word => String(word.segmentId) === String(original.id));
    // Choose a word boundary nearest the cursor, but keep the caption cut exactly at the cursor.
    const distance = index => Math.max(timed[index - 1].end - splitTime, splitTime - timed[index].start, 0);
    let boundary = 1;
    for (let index = 2; index < timed.length; index++) if (distance(index) < distance(boundary)) boundary = index;
    const existingIds = new Set(segments.map(segment => String(segment.id)));
    let rightId = `${original.id}-split`;
    for (let suffix = 2; existingIds.has(rightId); suffix++) rightId = `${original.id}-split-${suffix}`;
    const halves = [
      { ...original, end: splitTime, text: timed.slice(0, boundary).map(word => word.word).join(" ") },
      { ...original, id: rightId, start: splitTime, text: timed.slice(boundary).map(word => word.word).join(" ") },
    ];
    const splitWords = halves.flatMap((half, index) => synchronizeWords([half],
      (index === 0 ? timed.slice(0, boundary) : timed.slice(boundary)).map(word => ({ ...word, segmentId: half.id }))));
    return {
      segments: segments.flatMap(segment => segment.id === original.id ? halves : [segment]),
      words: [...keptWords, ...splitWords].sort((a, b) => a.start - b.start),
    };
  }
  if (action === "delete") return { segments: segments.filter(segment => !ids.has(String(segment.id))), words: keptWords };
  if (action !== "merge" || !canMergeCaptions(segments, selectedIds)) throw new Error("לחיבור יש לבחור לפחות שתי כתוביות רצופות.");
  const merged = { ...selected[0], end: selected.at(-1).end, text: selected.map(segment => segment.text.trim()).join(" ") };
  const next = segments.flatMap(segment => segment.id === merged.id ? [merged] : ids.has(String(segment.id)) ? [] : [segment]);
  const error = validateCaptionRange(merged, next, Infinity);
  if (error) throw new Error(error);
  const mergedWords = selected.flatMap(segment => aligned.filter(word => String(word.segmentId) === String(segment.id)))
    .map((word, wordIndex) => ({ ...word, segmentId: merged.id, wordIndex }));
  return { segments: next, words: [...keptWords, ...mergedWords].sort((a, b) => a.start - b.start) };
}
