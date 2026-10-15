import { sanitizeCaptionOverrides } from './captionOverrides.js';
import { getCaptionFont } from './captionFonts.js';
import { escapeAssText, renderWordPopAss } from './captionMotion.js';
import { activeWordAtTime, synchronizeWords } from './wordAlignment.js';

const color = value => `&H${value.slice(5, 7)}${value.slice(3, 5)}${value.slice(1, 3)}&`;
const time = seconds => {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

export function captionOverrideTags(style, defaults) {
  const own = sanitizeCaptionOverrides(style);
  const value = { positionXPercent: 50, rotation: 0, ...defaults, ...own };
  const font = getCaptionFont(value.fontId);
  const tags = [`\\fn${font.family}`, `\\b${font.id !== 'assistant' && font.weight >= 600 ? 1 : 0}`,
    `\\fs${value.fontSize}`, `\\1c${color(value.fontColor)}`, `\\3c${color(value.outlineColor)}`, `\\frz${-value.rotation}`];
  if (own.positionXPercent !== undefined || own.offsetYPercent !== undefined || own.rotation !== undefined) {
    tags.push(`\\pos(${(value.positionXPercent * value.videoWidth / 100).toFixed(2)},${((100 - value.offsetYPercent) * value.videoHeight / 100).toFixed(2)})`);
  }
  return tags.join('');
}

// Generate native ASS events so font, colour, placement and rotation survive
// burning, including active-word intervals and animated single-word captions.
export function renderStyledCaptionsAss(segments, sourceWords, options) {
  const defaults = { fontId: getCaptionFont().id, fontSize: 105, fontColor: '#ffffff', outlineColor: '#000000',
    activeWordColor: '#ffd700', offsetYPercent: 20, videoWidth: 1000, videoHeight: 1000, ...options };
  const tagsFor = segment => captionOverrideTags(segment?.style, defaults);
  if (options.captionMotion === 'pop') {
    const byId = new Map(segments.map(segment => [segment.id, segment]));
    return renderWordPopAss(segments, sourceWords, { ...options, styleTags: word => tagsFor(byId.get(word.segmentId)) });
  }
  const header = renderWordPopAss([], [], options);
  const words = options.activeWordEnabled ? synchronizeWords(segments, sourceWords) : [];
  const events = [];
  for (const segment of segments) {
    const own = sanitizeCaptionOverrides(segment.style);
    const base = color(own.fontColor ?? defaults.fontColor);
    const highlight = color(own.activeWordColor ?? defaults.activeWordColor);
    const owned = words.filter(word => word.segmentId === segment.id);
    const start = Math.max(0, Math.round(segment.start * 100));
    const end = Math.round(segment.end * 100);
    const boundaries = [...new Set([start, end, ...owned.flatMap(word => [Math.round(word.start * 100), Math.round(word.end * 100)])])]
      .filter(point => point >= start && point <= end).sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const from = boundaries[i] / 100, to = boundaries[i + 1] / 100;
      if (to <= from) continue;
      const active = activeWordAtTime(owned, (from + to) / 2)?.wordIndex;
      let index = 0;
      const text = segment.text.replace(/\r\n?/g, '\n').split('\n').map(line => {
        const content = line.split(/(\s+)/).map(part => {
          if (!part.trim()) return part;
          const escaped = escapeAssText(part);
          return index++ === active ? `{\\1c${highlight}}${escaped}{\\1c${base}}` : escaped;
        }).join('');
        return `${options.direction === 'ltr' ? '\u202a' : '\u202b'}${content}\u202c`;
      }).join('\\N');
      events.push(`Dialogue: 0,${time(from)},${time(to)},Default,,0,0,0,,{\\an2${tagsFor(segment)}}${text}`);
    }
  }
  return header + events.join('\n') + '\n';
}
