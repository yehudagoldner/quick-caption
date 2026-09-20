// Editing must never silently change a neighbouring caption or stretch speech.
export function timelineZoomForWindow(duration, seconds = 30) {
  return 25 * Math.log2(Math.max(1, duration / seconds));
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
