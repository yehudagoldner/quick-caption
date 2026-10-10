// Recover provider decoding loops, not ordinary pauses. Keep the policy bounded
// and independent of correction, which must never invent missing timestamps.
export const MAX_RECOVERY_CALLS = 4;
export const RECOVERY_SECONDS = 24;
const CONTEXT_SECONDS = 2;

export function hasDecodingLoop(segment) {
  return /(\p{L})\1{19,}/u.test(String(segment.text || '').normalize('NFC')) ||
    (Number.isFinite(segment.compression_ratio) && segment.compression_ratio >= 10);
}

export function recoveryPlan(segments, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid audio duration');
  const ranges = segments.filter(hasDecodingLoop).map(segment => {
    const seek = Number.isFinite(segment.seek) && segment.seek >= 0 ? segment.seek / 100 : Math.floor(segment.start / 30) * 30;
    let start = Math.max(0, seek), end = Math.min(duration, Math.max(seek + 30, segment.end));
    // Replace whole source cues so preserving a healthy cue cannot duplicate
    // the half already recovered on the other side of a boundary.
    let expanded;
    do {
      expanded = false;
      for (const cue of segments) {
        if (cue.start < end && cue.end > start) {
          const nextStart = Math.max(0, Math.min(start, cue.start));
          const nextEnd = Math.min(duration, Math.max(end, cue.end));
          expanded ||= nextStart !== start || nextEnd !== end;
          start = nextStart; end = nextEnd;
        }
      }
    } while (expanded);
    if (start >= end) throw new Error('Invalid decoding-loop timestamps');
    return { start, end };
  }).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  const chunks = merged.flatMap(range => {
    const parts = [];
    for (let start = range.start; start < range.end; start += RECOVERY_SECONDS) {
      const end = Math.min(start + RECOVERY_SECONDS, range.end);
      parts.push({ start, end, cropStart: Math.max(0, start - CONTEXT_SECONDS), cropEnd: Math.min(duration, end + CONTEXT_SECONDS) });
    }
    return parts;
  });
  if (chunks.length > MAX_RECOVERY_CALLS) throw new Error('Too many damaged audio windows');
  return { ranges: merged, chunks };
}

export function mergeRecoveredTranscript(base, plan, recovered) {
  if (recovered.length !== plan.chunks.length) throw new Error('Incomplete audio recovery');
  const inside = (start, end) => plan.ranges.some(range => (start + end) / 2 >= range.start && (start + end) / 2 < range.end);
  const segments = base.segments.filter(segment => !inside(segment.start, segment.end));
  const words = (base.words || []).filter(word => !inside(word.start, word.end));
  let recoveredWords = 0;
  recovered.forEach((result, index) => {
    const chunk = plan.chunks[index], length = chunk.cropEnd - chunk.cropStart;
    if (result.segments.some(hasDecodingLoop)) throw new Error('Audio recovery still contains a decoding loop');
    if (result.segments.some(cue => !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < -0.05 || cue.end > length + 0.05 || cue.end <= cue.start)) {
      throw new Error('Invalid recovered cue timestamps');
    }
    const shifted = (result.words || []).map(word => {
      if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < -0.05 || word.end > length + 0.05 || word.end <= word.start) {
        throw new Error('Invalid recovered word timestamps');
      }
      return { ...word, start: word.start + chunk.cropStart, end: word.end + chunk.cropStart };
    });
    const owned = shifted.filter(word => {
      const middle = (word.start + word.end) / 2;
      return middle >= chunk.start && middle < chunk.end;
    }).map(word => ({ ...word, start: Math.max(chunk.start, word.start), end: Math.min(chunk.end, word.end) }));
    if (result.segments.some(segment => segment.text?.trim()) && !shifted.length) throw new Error('Audio recovery returned text without word timestamps');
    for (const segment of result.segments) {
      const cueWords = owned.filter(word => {
        const middle = (word.start + word.end) / 2;
        return result.segments.find(cue => middle >= cue.start + chunk.cropStart - 0.05 && middle <= cue.end + chunk.cropStart + 0.05) === segment;
      });
      if (!cueWords.length) continue;
      segments.push({ start: cueWords[0].start, end: cueWords.at(-1).end, text: cueWords.map(word => word.word).join(' ').trim() });
    }
    if (owned.some(word => !result.segments.some(cue => (word.start + word.end) / 2 >= cue.start + chunk.cropStart - 0.05 && (word.start + word.end) / 2 <= cue.end + chunk.cropStart + 0.05))) {
      throw new Error('Recovered words do not belong to a cue');
    }
    recoveredWords += owned.length;
    words.push(...owned);
  });
  if (!recoveredWords) throw new Error('Audio recovery returned no timestamped speech');
  segments.sort((a, b) => a.start - b.start || a.end - b.end);
  words.sort((a, b) => a.start - b.start || a.end - b.end);
  return { ...base, segments: segments.map((segment, id) => ({ ...segment, id })), words,
    text: segments.map(segment => segment.text).join(' ').trim() };
}
