// Translate the whole selection by a shared, whole-frame offset. Unselected
// captions are barriers, including those between two nonadjacent selections.
export function moveCaptionSelection(segments, ids, delta, duration, fps = 25) {
  const selected = new Set(ids.map(String));
  if (!segments.some(s => selected.has(String(s.id))) || !Number.isFinite(delta)) return segments;
  const rate = fps > 0 ? fps : 25;
  const ordered = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  let lower = -Infinity, upper = Infinity;
  let previousEnd = 0;
  for (const clip of ordered) {
    if (!selected.has(String(clip.id))) { previousEnd = Math.max(previousEnd, clip.end); continue; }
    if (previousEnd > clip.start + 1e-6) return segments;
    lower = Math.max(lower, previousEnd - clip.start);
  }
  let nextStart = duration;
  for (let index = ordered.length - 1; index >= 0; index--) {
    const clip = ordered[index];
    if (!selected.has(String(clip.id))) { nextStart = Math.min(nextStart, clip.start); continue; }
    if (nextStart < clip.end - 1e-6) return segments;
    upper = Math.min(upper, nextStart - clip.end);
  }
  const frames = Math.max(Math.ceil(lower * rate - 1e-6), Math.min(Math.floor(upper * rate + 1e-6), Math.round(delta * rate)));
  if (!frames) return segments;
  const offset = frames / rate;
  return segments.map(s => selected.has(String(s.id)) ? { ...s, start: s.start + offset, end: s.end + offset } : s);
}
