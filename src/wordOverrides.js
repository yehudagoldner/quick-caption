// Appearance belongs to a word in one video version, independently of its
// shared text/timing. A missing property inherits the caption's appearance.
export function sanitizeWordOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  if (typeof value.fontColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.fontColor)) result.fontColor = value.fontColor;
  if (typeof value.fontScale === 'number' && Number.isFinite(value.fontScale)) result.fontScale = Math.round(Math.min(2, Math.max(.5, value.fontScale)) * 100) / 100;
  if (value.bold === true) result.bold = true;
  for (const key of ['offsetX', 'offsetY']) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] !== 0) result[key] = Math.round(Math.max(-30, Math.min(30, value[key])) * 1000) / 1000;
  }
  return result;
}

// Offsets use the caption's font em, so they scale with the preview and export.
export function moveCaptionWords(words, segmentId, indexes, delta) {
  const selected = new Set(indexes);
  return words.map(word => word.segmentId === segmentId && selected.has(word.wordIndex)
    ? { ...word, style: sanitizeWordOverrides({ ...word.style, offsetX: (word.style?.offsetX ?? 0) + delta.x, offsetY: (word.style?.offsetY ?? 0) + delta.y }) }
    : word);
}

export function wordDragDelta(dx, dy, fontSize, rotation = 0) {
  const angle = rotation * Math.PI / 180;
  return { x: (dx * Math.cos(angle) + dy * Math.sin(angle)) / fontSize,
    y: (-dx * Math.sin(angle) + dy * Math.cos(angle)) / fontSize };
}

export function styleCaptionWords(words, segmentId, indexes, patch) {
  const selected = new Set(indexes);
  return words.map(word => {
    if (word.segmentId !== segmentId || !selected.has(word.wordIndex)) return word;
    const style = patch === null ? {} : sanitizeWordOverrides({ ...word.style, ...patch });
    const { style: _previous, ...rest } = word;
    return Object.keys(style).length ? { ...rest, style } : rest;
  });
}
