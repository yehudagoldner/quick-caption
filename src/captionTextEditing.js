import { alignSequence, subtitleTokens, synchronizeWords } from './wordAlignment.js';
import { overwriteCaptionRange, wordsForSegment } from './timelineEditing.js';

export const MIN_ADDED_WORD_FRAMES = 4;

export function automaticCaptionEnd(segment, text, fps = 24) {
  const step = MIN_ADDED_WORD_FRAMES / (Number.isFinite(fps) && fps > 0 ? fps : 24);
  const missing = subtitleTokens(text).length * step - (segment.end - segment.start);
  return segment.end + Math.max(0, Math.ceil(missing / step - 1e-9)) * step;
}

// This policy belongs to text editing, not transcription/rendering: existing
// word times are anchors, while a newly authored caption shares its duration.
export function editCaptionText(segment, words, text, fps = 24, duration = Infinity) {
  const tokens = subtitleTokens(text);
  const source = wordsForSegment(words, segment);
  const mapped = alignSequence(tokens, source, { splitWords: false });
  const automatic = segment.wordTimingMode === 'automatic';
  let end = automatic ? automaticCaptionEnd(segment, text, fps) : segment.end;
  const minimum = MIN_ADDED_WORD_FRAMES / (Number.isFinite(fps) && fps > 0 ? fps : 24);
  let cursor = segment.start;
  const nextWords = tokens.map((word, wordIndex) => {
    const anchor = mapped[wordIndex];
    let start, wordEnd;
    if (automatic) {
      start = segment.start + (end - segment.start) * wordIndex / tokens.length;
      wordEnd = segment.start + (end - segment.start) * (wordIndex + 1) / tokens.length;
    } else if (anchor) {
      // Only move a following word when the insertion consumes its free gap.
      start = Math.max(cursor, anchor.start);
      wordEnd = start + (anchor.end - anchor.start);
    } else {
      start = cursor;
      wordEnd = start + minimum;
    }
    cursor = wordEnd;
    return { ...anchor, word, segmentId: segment.id, wordIndex, start, end: wordEnd,
      timingSource: automatic || !anchor || Math.abs(start - anchor.start) > 1e-9 ? 'estimated' : anchor.timingSource };
  });
  end = Math.max(end, cursor);
  if (end > duration + 1e-6) throw new Error('אין מספיק זמן עד סוף הסרטון להוספת המילים. קצרו את הטקסט או פנו להן מקום.');
  return { segment: { ...segment, text, end }, words: nextWords };
}

// The edited range wins. Trim covered neighbours in the same atomic revision,
// preserving ownership so their words cannot migrate into the edited caption.
export function applyCaptionTextEdit(segments, words, edited, editedWords) {
  const previous = segments.find(segment => String(segment.id) === String(edited.id));
  const original = previous ? segments : [...segments, edited];
  const nextSegments = overwriteCaptionRange(edited, original).sort((a, b) => a.start - b.start);
  const owned = new Set(previous ? wordsForSegment(words, previous) : []);
  // Filter by original ownership before clipping clones or removes words.
  const otherWords = words.filter(word => !owned.has(word));
  const clipped = clipCaptionRanges(segments.filter(s => String(s.id) !== String(edited.id)),
    nextSegments.filter(s => String(s.id) !== String(edited.id)), otherWords);
  const resultSegments = nextSegments.map(s => String(s.id) === String(edited.id) ? s : clipped.segments.find(item => String(item.id) === String(s.id)));
  return { segments: resultSegments, words: synchronizeWords(resultSegments, [...clipped.words, ...editedWords]) };
}

// Cutting a caption only clips words at its edges. Words wholly covered by
// the cut disappear with their text; surviving words retain their timestamps.
export function clipCaptionRanges(originalSegments, nextSegments, words) {
  const resultWords = [];
  const segments = nextSegments.map(segment => {
    const original = originalSegments.find(s => String(s.id) === String(segment.id)) ?? segment;
    const own = wordsForSegment(words, original);
    if (original.start === segment.start && original.end === segment.end) {
      resultWords.push(...own); return segment;
    }
    const removed = new Set();
    own.forEach((word, i) => {
      const start = Math.max(segment.start, word.start), end = Math.min(segment.end, word.end);
      if (end <= start) { removed.add(i); return; }
      resultWords.push({ ...word, start, end });
    });
    if (!removed.size) return segment;
    let index = 0;
    const text = segment.text.replace(/\S+\s*/gu, token => removed.has(index++) ? '' : token).trim();
    return { ...segment, text };
  });
  return { segments, words: resultWords };
}
