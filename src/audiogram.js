// An audiogram turns an audio-only project into a video: a solid or image
// background, an optional waveform and the burned captions on top.
export const AUDIOGRAM_FORMATS = Object.freeze({
  vertical: Object.freeze({ width: 1080, height: 1920 }),
  square: Object.freeze({ width: 1080, height: 1080 }),
  landscape: Object.freeze({ width: 1920, height: 1080 }),
});

export const AUDIOGRAM_DEFAULTS = Object.freeze({
  format: 'vertical', background: '#111827', imageFit: 'contain', waveform: true, waveColor: '#ffffff',
});

// The preview and FFmpeg both place the waveform band from these percentages.
export const AUDIOGRAM_WAVE = Object.freeze({ topPercent: 58, heightPercent: 12 });

export const AUDIOGRAM_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const AUDIOGRAM_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

export function sanitizeAudiogram(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    format: Object.hasOwn(AUDIOGRAM_FORMATS, value.format) ? value.format : AUDIOGRAM_DEFAULTS.format,
    background: color(value.background, AUDIOGRAM_DEFAULTS.background),
    imageFit: value.imageFit === 'cover' ? 'cover' : 'contain',
    waveform: typeof value.waveform === 'boolean' ? value.waveform : AUDIOGRAM_DEFAULTS.waveform,
    waveColor: color(value.waveColor, AUDIOGRAM_DEFAULTS.waveColor),
  };
}

export function audiogramDimensions(format) {
  const { width, height } = AUDIOGRAM_FORMATS[format] ?? AUDIOGRAM_FORMATS[AUDIOGRAM_DEFAULTS.format];
  return { width, height };
}

// Even pixel values keep the band compatible with yuv420p chroma subsampling.
export function audiogramWaveBox(width, height) {
  const even = value => Math.max(2, Math.round(value / 2) * 2);
  return { top: even(height * AUDIOGRAM_WAVE.topPercent / 100), width: even(width), height: even(height * AUDIOGRAM_WAVE.heightPercent / 100) };
}
