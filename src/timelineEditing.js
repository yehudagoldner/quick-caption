// Desktop editing keeps strict word bounds; mobile timing supports bounded trims.
export function timelineZoomForWindow(duration, seconds = 30) {
  return 25 * Math.log2(Math.max(1, duration / seconds));
}

// Phone timing: keep a typical caption wide enough to grab, and never open the whole recording.
export function mobileTimelineWindowSeconds(segments, viewportWidth, duration) {
  const width = Math.max(1, Number(viewportWidth) || 1);
  const total = Math.max(0.5, Number.isFinite(duration) ? duration : 0.5);
  const durations = (segments ?? []).map(segment => segment.end - segment.start).filter(length => length >= 0.15).sort((a, b) => a - b);
  const typical = durations.length ? durations[Math.floor((durations.length - 1) / 2)] : 2;
  const fitted = width * typical / 160;
  return Math.min(total, Math.min(8, Math.max(3, fitted)));
}

function snapFrame(seconds, fps) {
  const rate = fps > 0 ? fps : 30;
  return Math.round(seconds * rate) / rate;
}

// Half a second is the editing floor, rounded up to a whole frame. Existing
// shorter captions stay editable, but cannot be shortened any further.
export const MIN_MOBILE_CAPTION_SECONDS = 0.5;
export function placeMobileCaption(segment, segments, duration, deltaSeconds, mode, fps = 30) {
  const rate = fps > 0 ? fps : 30;
  const minimum = item => Math.min(item.end - item.start, Math.ceil(MIN_MOBILE_CAPTION_SECONDS * rate) / rate);
  const ordered = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const index = ordered.findIndex(item => item.id === segment.id);
  if (index < 0 || !Number.isFinite(deltaSeconds)) return segments;
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  const lower = previous ? previous.start + minimum(previous) : 0;
  const upper = Math.min(duration, next ? next.end - minimum(next) : duration);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  let { start, end } = segment;
  if (mode === "move") {
    const length = end - start;
    if (upper - lower < length - 1e-6) return segments;
    start = clamp(snapFrame(start + deltaSeconds, rate), lower, upper - length);
    end = start + length;
  } else if (mode === "start") {
    start = clamp(snapFrame(start + deltaSeconds, rate), lower, end - minimum(segment));
  } else {
    end = clamp(snapFrame(end + deltaSeconds, rate), start + minimum(segment), upper);
  }
  return segments.map(item => {
    if (item.id === segment.id) return { ...item, start, end };
    if (item.id === previous?.id && item.end > start) return { ...item, end: start };
    if (item.id === next?.id && item.start < end) return { ...item, start: end };
    return item;
  });
}

// Shift or trim one caption without touching a neighbour or a timed word.
export function placeCaption(segment, segments, words, duration, deltaSeconds, mode, fps = 30) {
  const ordered = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const index = ordered.findIndex(item => item.id === segment.id);
  const prevEnd = index > 0 ? ordered[index - 1].end : 0;
  const nextStart = index >= 0 && index < ordered.length - 1 ? ordered[index + 1].start : duration;
  const limit = Math.min(duration, nextStart);
  const minDur = 1 / (fps > 0 ? fps : 30);
  const own = wordsForSegment(words ?? [], segment);
  const wordStart = own.length ? Math.min(...own.map(word => word.start)) : null;
  const wordEnd = own.length ? Math.max(...own.map(word => word.end)) : null;
  if (mode === "move") {
    const length = segment.end - segment.start;
    let start = snapFrame(segment.start + deltaSeconds, fps);
    let end = start + length;
    if (start < prevEnd) { end += prevEnd - start; start = prevEnd; }
    if (end > limit) { start -= end - limit; end = limit; }
    if (start < prevEnd - .000001 || end > limit + .000001 || end - start < length - .000001) {
      return { start: segment.start, end: segment.end };
    }
    return { start, end };
  }
  if (mode === "start") {
    let start = snapFrame(segment.start + deltaSeconds, fps);
    start = Math.max(prevEnd, start);
    start = Math.min(start, segment.end - minDur);
    if (wordStart != null) start = Math.min(start, wordStart);
    if (!(start < segment.end)) return { start: segment.start, end: segment.end };
    return { start, end: segment.end };
  }
  let end = snapFrame(segment.end + deltaSeconds, fps);
  end = Math.min(limit, end);
  end = Math.max(end, segment.start + minDur);
  if (wordEnd != null) end = Math.max(end, wordEnd);
  if (!(end > segment.start) || end > limit + .000001) return { start: segment.start, end: segment.end };
  return { start: segment.start, end };
}

// Reveal the playhead without moving the page vertically or changing zoom.
export function timelineScrollForTime(time, pixelsPerSecond, width, scrollLeft) {
  const pixel = 20 + time * pixelsPerSecond;
  return pixel < scrollLeft + 20 || pixel > scrollLeft + width - 30
    ? Math.max(0, pixel - width / 2) : scrollLeft;
}

export function validateCaptionRange(segment, segments, duration) {
  if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start || segment.end > duration + .001) {
    return "יש לבחור טווח זמן תקין בתוך ההקלטה.";
  }
  if (segments.some(s => s.id !== segment.id && segment.start < s.end - .000001 && segment.end > s.start + .000001)) {
    return "השינוי חופף לכתובית אחרת. הזיזו או קצרו אותה במפורש; הכתובית השכנה לא שונתה.";
  }
  return null;
}

export function wordsForSegment(words, segment) {
  return words.filter(w => w.segmentId !== undefined ? String(w.segmentId) === String(segment.id) : w.start >= segment.start - .001 && w.end <= segment.end + .001);
}

export function retimeCaption(original, next, words, fitWords = false) {
  const ownWords = wordsForSegment(words, original);
  const moving = Math.abs((next.end - next.start) - (original.end - original.start)) < .000001;
  const offset = moving ? next.start - original.start : 0;
  const shifted = ownWords.map(w => ({ ...w, start: w.start + offset, end: w.end + offset }));
  if (shifted.some(w => w.start < next.start - .000001 || w.end > next.end + .000001)) {
    if (!fitWords) throw new Error("הקצה חוצה מילה מתוזמנת. התאימו קודם את תזמון המילה בציר הפנימי; שאר המילים לא הוזזו.");
    // Preserve internal spacing/order, compressing only when speech no longer fits.
    const first = Math.min(...ownWords.map(w => w.start));
    const last = Math.max(...ownWords.map(w => w.end));
    const scale = Math.min(1, (next.end - next.start) / (last - first));
    const origin = Math.max(next.start, Math.min(first, next.end - (last - first) * scale));
    ownWords.forEach((word, index) => {
      shifted[index] = { ...word, segmentId: next.id, start: origin + (word.start - first) * scale, end: origin + (word.end - first) * scale };
    });
  }
  const owned = new Set(ownWords);
  let i = 0;
  return words.map(w => owned.has(w) ? shifted[i++] : w);
}

export function validateWordRange(word, segment, others = []) {
  if (!word.word.trim() || /\s/u.test(word.word.trim())) return "יש להזין מילה אחת. לעריכת משפט השתמשו בטקסט המקטע.";
  if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < segment.start - .000001 || word.end > segment.end + .000001 || word.start >= word.end) {
    return "זמן המילה חייב להיות בתוך המקטע, והסיום אחרי ההתחלה.";
  }
  if (others.some(w => word.start < w.end - .000001 && word.end > w.start + .000001)) return "התזמון חופף למילה אחרת. בחרו טווח פנוי.";
  return null;
}

// Move a word without changing its duration; trim only the chosen edge.
// Neighbouring words and the caption boundaries are hard limits.
export function placeMobileWord(words, index, segment, delta, mode, fps = 30) {
  const word = words[index];
  if (!word || !Number.isFinite(delta) || delta === 0) return words;
  const rate = fps > 0 ? fps : 30;
  const lower = Math.max(segment.start, words[index - 1]?.end ?? segment.start);
  const upper = Math.min(segment.end, words[index + 1]?.start ?? segment.end);
  const length = word.end - word.start;
  const minimum = Math.min(length, 1 / rate);
  if (length <= 0 || upper - lower < minimum) return words;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let { start, end } = word;
  if (mode === "move") {
    if (upper - lower < length - 1e-6) return words;
    start = clamp(snapFrame(start + delta, rate), lower, upper - length);
    end = start + length;
  } else if (mode === "start") {
    start = clamp(snapFrame(start + delta, rate), lower, end - minimum);
  } else if (mode === "end") {
    end = clamp(snapFrame(end + delta, rate), start + minimum, upper);
  } else return words;
  if (Math.abs(start - word.start) < 1e-6 && Math.abs(end - word.end) < 1e-6) return words;
  const next = { ...word, start, end, timingSource: "aligned" };
  if (validateWordRange(next, segment, words.filter((_, i) => i !== index))) return words;
  return words.map((item, i) => i === index ? next : item);
}

export function snapshot(segments, words) {
  return { segments: segments.map(s => ({ ...s })), words: words.map(w => ({ ...w })) };
}

export class EditHistory {
  past = [];
  future = [];
  push(before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.past = [...this.past.slice(-99), snapshot(before.segments, before.words)];
    this.future = [];
  }
  undo(current) {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(snapshot(current.segments, current.words));
    return previous;
  }
  redo(current) {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(snapshot(current.segments, current.words));
    return next;
  }
}
