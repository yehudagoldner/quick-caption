// Appearance belongs to a word in one video version, independently of its
// shared text/timing. A missing property inherits the caption's appearance.
export function sanitizeWordOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  if (typeof value.fontColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.fontColor)) result.fontColor = value.fontColor;
  if (typeof value.fontScale === 'number' && Number.isFinite(value.fontScale)) result.fontScale = Math.round(Math.min(2, Math.max(.5, value.fontScale)) * 100) / 100;
  if (value.bold === true) result.bold = true;
  return result;
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
