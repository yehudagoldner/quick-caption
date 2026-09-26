export const DEFAULT_CAPTION_FONT_SIZE = 105;
export const AUTO_CAPTION_FONT_SIZE = "auto";
export const CAPTION_FONT_SIZES = [24, 32, 40, 48, 56, 60, 64, 72, 80, 96, 105, 120, 144, 168, 192, 216, 240];
export const MIN_CAPTION_FONT_SIZE = 12;
export const MAX_CAPTION_FONT_SIZE = 1000;

// Bundled in public/fonts and used by both the preview and libass, so the
// browser can measure exactly what FFmpeg will draw.
export const CAPTION_FONT_FAMILY = "Assistant SemiBold";
export const CAPTION_FONT_FILE = "Assistant-SemiBold.ttf";
export const CAPTION_FONT_WEIGHT = 600;
// libass sizes a font by usWinAscent + usWinDescent (1021 + 287 units), not by
// its 1000-unit em, so an ASS Fontsize of N draws glyphs at an em of N * ratio.
export const CAPTION_FONT_EM_RATIO = 1000 / 1308;
export const CAPTION_OUTLINE_WIDTH = 3;
// Headroom for shaping differences between the browser and libass.
const FIT_SAFETY = 0.97;

export function sanitizeCaptionFontSize(raw) {
  const numeric = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(numeric)) return DEFAULT_CAPTION_FONT_SIZE;
  return Math.min(MAX_CAPTION_FONT_SIZE, Math.max(MIN_CAPTION_FONT_SIZE, Math.round(numeric)));
}

export function captionMarginPixels(marginPercent, videoWidth) {
  return Math.round(Math.min(Math.max(Number(marginPercent) || 0, 0), 45) * (videoWidth / 100));
}

export function captionTextLines(text) {
  return String(text ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * Largest ASS font size at which every caption line fits on one line inside
 * the horizontal margins, and the tallest caption fits above the bottom offset.
 * `maxLineEmWidth` is the widest line's width divided by its CSS font size.
 */
export function fitCaptionFontSize({ maxLineEmWidth, maxLineCount, videoWidth, videoHeight, marginPercent, offsetYPercent }) {
  if (!(videoWidth > 0) || !(videoHeight > 0)) return DEFAULT_CAPTION_FONT_SIZE;
  const margin = captionMarginPixels(marginPercent, videoWidth);
  const bottom = Math.round(Math.min(Math.max(Number(offsetYPercent) || 0, 0), 100) * (videoHeight / 100));
  const border = CAPTION_OUTLINE_WIDTH * 2;
  const availableWidth = videoWidth - margin * 2 - border;
  const availableHeight = videoHeight - bottom - margin - border;
  const lines = Math.max(1, maxLineCount || 1);

  const byHeight = availableHeight / lines;
  const byWidth = maxLineEmWidth > 0 ? availableWidth / (maxLineEmWidth * CAPTION_FONT_EM_RATIO) : DEFAULT_CAPTION_FONT_SIZE;
  const size = Math.floor(Math.min(byWidth, byHeight) * FIT_SAFETY);
  return Math.min(MAX_CAPTION_FONT_SIZE, Math.max(MIN_CAPTION_FONT_SIZE, size));
}
