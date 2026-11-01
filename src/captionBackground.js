export function sanitizeCaptionBackground(value = {}) {
  return {
    backgroundColor: typeof value.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.backgroundColor) ? value.backgroundColor.toLowerCase() : '#000000',
    backgroundOpacity: typeof value.backgroundOpacity === 'number' && Number.isFinite(value.backgroundOpacity) ? Math.min(100, Math.max(0, value.backgroundOpacity)) : 0,
  };
}

export function captionBackgroundCss(value) {
  const { backgroundColor, backgroundOpacity } = sanitizeCaptionBackground(value);
  const channels = backgroundColor.slice(1).match(/../g).map(channel => parseInt(channel, 16));
  return `rgba(${channels.join(', ')}, ${backgroundOpacity / 100})`;
}

export function captionBackgroundAss(value) {
  const { backgroundColor, backgroundOpacity } = sanitizeCaptionBackground(value);
  const alpha = Math.round(255 * (1 - backgroundOpacity / 100)).toString(16).padStart(2, '0').toUpperCase();
  return `&H${alpha}${backgroundColor.slice(5, 7)}${backgroundColor.slice(3, 5)}${backgroundColor.slice(1, 3)}`;
}
