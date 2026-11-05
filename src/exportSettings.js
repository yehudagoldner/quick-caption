export const DEFAULT_EXPORT_SETTINGS = Object.freeze({ mode: 'quality', quality: 'high', bitrateMbps: 8 });
export const EXPORT_QUALITIES = Object.freeze({ high: 18, balanced: 23, compact: 28 });
export const MIN_EXPORT_BITRATE = 0.25;
export const MAX_EXPORT_BITRATE = 100;

export function validateExportSettings(value = DEFAULT_EXPORT_SETTINGS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['quality', 'bitrate'].includes(value.mode)
    || !Object.hasOwn(EXPORT_QUALITIES, value.quality)
    || typeof value.bitrateMbps !== 'number' || !Number.isFinite(value.bitrateMbps)
    || value.bitrateMbps < MIN_EXPORT_BITRATE || value.bitrateMbps > MAX_EXPORT_BITRATE) {
    throw new Error('הגדרות הייצוא אינן תקינות. קצב הנתונים צריך להיות בין 0.25 ל־100 Mbps.');
  }
  return { mode: value.mode, quality: value.quality, bitrateMbps: value.bitrateMbps };
}

export function sanitizeExportSettings(value) {
  try { return validateExportSettings(value); } catch { return { ...DEFAULT_EXPORT_SETTINGS }; }
}

export function exportEncodeArguments(settings) {
  const { mode, quality, bitrateMbps } = validateExportSettings(settings);
  return ['-c:v', 'libx264', '-preset', 'veryfast',
    ...(mode === 'bitrate' ? ['-b:v', `${Math.round(bitrateMbps * 1000)}k`] : ['-crf', String(EXPORT_QUALITIES[quality])]),
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
}

// CRF has no fixed bitrate. These broad ranges are a planning aid, not a size guarantee.
export function estimateExportSize(settings, duration, dimensions) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const { mode, quality, bitrateMbps } = validateExportSettings(settings);
  const pixels = dimensions?.width > 0 && dimensions?.height > 0 ? dimensions.width * dimensions.height : 1920 * 1080;
  const videoMbps = mode === 'bitrate' ? bitrateMbps : { high: 12, balanced: 8, compact: 4 }[quality] * pixels / (1920 * 1080);
  const bytes = (videoMbps + 0.192) * 1_000_000 / 8 * duration * 1.01;
  return { bytes, minBytes: bytes * (mode === 'bitrate' ? .85 : .5), maxBytes: bytes * (mode === 'bitrate' ? 1.15 : 1.5) };
}
