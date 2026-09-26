export const DEFAULT_CAPTION_FONT_SIZE = 105;
export const CAPTION_FONT_SIZES = [24, 32, 40, 48, 56, 60, 64, 72, 80, 96, 105, 120, 144, 168, 192, 216, 240];

export function sanitizeCaptionFontSize(raw) {
  const numeric = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(numeric)) return DEFAULT_CAPTION_FONT_SIZE;
  return Math.min(240, Math.max(12, Math.round(numeric)));
}
