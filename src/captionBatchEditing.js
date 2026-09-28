import { synchronizeWords } from "./wordAlignment.js";
import { validateCaptionRange } from "./timelineEditing.js";

export function canMergeCaptions(segments, selectedIds) {
  const ids = new Set(selectedIds.map(String));
  const ordered = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const indexes = ordered.flatMap((segment, index) => ids.has(String(segment.id)) ? [index] : []);
  return indexes.length >= 2 && indexes.length === ids.size && indexes.at(-1) - indexes[0] + 1 === indexes.length;
}

export function editCaptionBatch(segments, words, selectedIds, action) {
  const ids = new Set(selectedIds.map(String));
  const selected = segments.filter(segment => ids.has(String(segment.id))).sort((a, b) => a.start - b.start || a.end - b.end);
  if (!ids.size || selected.length !== ids.size) throw new Error("הבחירה השתנתה. סמנו שוב את הכתוביות.");
  const aligned = synchronizeWords(segments, words);
  const keptWords = aligned.filter(word => !ids.has(String(word.segmentId)));
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
