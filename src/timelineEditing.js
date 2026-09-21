// Editing must never silently change a neighbouring caption or stretch speech.
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

export function retimeCaption(original, next, words) {
  const ownWords = wordsForSegment(words, original);
  const moving = Math.abs((next.end - next.start) - (original.end - original.start)) < .000001;
  const offset = moving ? next.start - original.start : 0;
  const shifted = ownWords.map(w => ({ ...w, start: w.start + offset, end: w.end + offset }));
  if (shifted.some(w => w.start < next.start - .000001 || w.end > next.end + .000001)) {
    throw new Error("הקצה חוצה מילה מתוזמנת. התאימו קודם את תזמון המילה בציר הפנימי; שאר המילים לא הוזזו.");
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
