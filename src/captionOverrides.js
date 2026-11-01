import { CAPTION_FONTS } from './captionFonts.js';
import { sanitizeCaptionFontSize } from './captionStyle.js';

// Only these per-caption properties may reach the preview or ASS renderer.
export function sanitizeCaptionOverrides(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (typeof value.activeWordEnabled === 'boolean') result.activeWordEnabled = value.activeWordEnabled;
  if (CAPTION_FONTS.some(font => font.id === value.fontId)) result.fontId = value.fontId;
  if (typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)) result.fontSize = sanitizeCaptionFontSize(value.fontSize);
  for (const key of ['fontColor', 'outlineColor', 'activeWordColor', 'backgroundColor']) {
    if (typeof value[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key])) result[key] = value[key];
  }
  for (const [key, min, max] of [['backgroundOpacity', 0, 100], ['positionXPercent', 0, 100], ['offsetYPercent', 0, 100], ['rotation', -180, 180]]) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) result[key] = Math.round(Math.min(max, Math.max(min, value[key])) * 100) / 100;
  }
  return result;
}
