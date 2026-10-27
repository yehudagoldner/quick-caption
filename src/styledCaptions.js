import { sanitizeCaptionOverrides } from './captionOverrides.js';
import { getCaptionFont } from './captionFonts.js';
import { escapeAssText, renderWordPopAss } from './captionMotion.js';
import { activeWordAtTime, synchronizeWords } from './wordAlignment.js';
import { sanitizeWordOverrides } from './wordOverrides.js';

const color = value => `&H${value.slice(5, 7)}${value.slice(3, 5)}${value.slice(1, 3)}&`;
const time = seconds => {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

export function captionOverrideTags(style, defaults, offset, forcePosition = false) {
  const own = sanitizeCaptionOverrides(style);
  const value = { positionXPercent: 50, rotation: 0, ...defaults, ...own };
  const font = getCaptionFont(value.fontId);
  const tags = [`\\fn${font.family}`, `\\b${font.id !== 'assistant' && font.weight >= 600 ? 1 : 0}`,
    `\\fs${value.fontSize}`, `\\1c${color(value.fontColor)}`, `\\3c${color(value.outlineColor)}`, `\\frz${-value.rotation}`];
  if (forcePosition || offset?.offsetX || offset?.offsetY || own.positionXPercent !== undefined || own.offsetYPercent !== undefined || own.rotation !== undefined) {
    const angle = value.rotation * Math.PI / 180;
    const x = (offset?.offsetX ?? 0) * value.fontSize * font.emRatio, y = (offset?.offsetY ?? 0) * value.fontSize * font.emRatio;
    tags.push(`\\pos(${(value.positionXPercent * value.videoWidth / 100 + x * Math.cos(angle) - y * Math.sin(angle)).toFixed(2)},${((100 - value.offsetYPercent) * value.videoHeight / 100 + x * Math.sin(angle) + y * Math.cos(angle)).toFixed(2)})`);
  }
  return tags.join('');
}

function wordTags(style, caption, defaults) {
  const own = sanitizeWordOverrides(style);
  return (own.fontColor ? `\\1c${color(own.fontColor)}` : '')
    + (own.fontScale ? `\\fs${((caption.fontSize ?? defaults.fontSize) * own.fontScale).toFixed(2)}` : '')
    + (own.bold ? '\\b900' : '');
}

// Generate native ASS events so font, colour, placement and rotation survive
// burning, including active-word intervals and animated single-word captions.
export function renderStyledCaptionsAss(segments, sourceWords, options) {
  const defaults = { fontId: getCaptionFont().id, fontSize: 105, fontColor: '#ffffff', outlineColor: '#000000',
    activeWordColor: '#ffd700', offsetYPercent: 20, videoWidth: 1000, videoHeight: 1000, ...options };
  const tagsFor = segment => captionOverrideTags(segment?.style, defaults);
  if (options.captionMotion === 'pop') {
    const byId = new Map(segments.map(segment => [segment.id, segment]));
    return renderWordPopAss(segments, sourceWords, { ...options, styleTags: word => {
      const segment = byId.get(word.segmentId);
      return captionOverrideTags(segment?.style, defaults, sanitizeWordOverrides(word.style)) + wordTags(word.style, sanitizeCaptionOverrides(segment?.style), defaults);
    } });
  }
  const header = renderWordPopAss([], [], options);
  const words = synchronizeWords(segments, sourceWords);
  const events = [];
  for (const segment of segments) {
    const own = sanitizeCaptionOverrides(segment.style);
    const activeWordEnabled = own.activeWordEnabled ?? options.activeWordEnabled;
    const base = color(own.fontColor ?? defaults.fontColor);
    const highlight = color(own.activeWordColor ?? defaults.activeWordColor);
    const owned = words.filter(word => word.segmentId === segment.id);
    const moved = owned.filter(word => { const style = sanitizeWordOverrides(word.style); return style.offsetX || style.offsetY; });
    const movedIndexes = new Set(moved.map(word => word.wordIndex));
    const font = getCaptionFont(own.fontId ?? defaults.fontId);
    const resetWord = `\\fs${own.fontSize ?? defaults.fontSize}\\b${font.id !== 'assistant' && font.weight >= 600 ? 1 : 0}\\1c${base}`;
    const start = Math.max(0, Math.round(segment.start * 100));
    const end = Math.round(segment.end * 100);
    const boundaries = [...new Set([start, end, ...(activeWordEnabled ? owned.flatMap(word => [Math.round(word.start * 100), Math.round(word.end * 100)]) : [])])]
      .filter(point => point >= start && point <= end).sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const from = boundaries[i] / 100, to = boundaries[i + 1] / 100;
      if (to <= from) continue;
      const active = activeWordEnabled ? activeWordAtTime(owned, (from + to) / 2)?.wordIndex : undefined;
      // Every layer retains the complete shaped text, including invisible
      // words. This preserves Hebrew/English order, line widths and baselines.
      // Only the chosen word is visible on its translated layer.
      const textFor = onlyIndex => {
      let index = 0;
      return segment.text.replace(/\r\n?/g, '\n').split('\n').map(line => {
        const content = line.split(/(\s+)/).map(part => {
          if (!part.trim()) return part;
          const escaped = escapeAssText(part);
          const wordIndex = index++;
          const tags = wordTags(owned.find(word => word.wordIndex === wordIndex)?.style, own, defaults);
          const activeTags = wordIndex === active ? `\\1c${highlight}` : '';
          const alpha = moved.length ? `\\alpha&H${(onlyIndex === undefined ? !movedIndexes.has(wordIndex) : wordIndex === onlyIndex) ? '00' : 'FF'}&` : '';
          return tags ? `{${alpha}${tags}${activeTags}}${escaped}{${resetWord}}`
            : activeTags || alpha ? `{${alpha}${activeTags}}${escaped}{\\1c${base}}` : escaped;
        }).join('');
        return `${options.direction === 'ltr' ? '\u202a' : '\u202b'}${content}\u202c`;
      }).join('\\N');
      };
      events.push(`Dialogue: 0,${time(from)},${time(to)},Default,,0,0,0,,{\\an2${moved.length ? captionOverrideTags(segment.style, defaults, null, true) : tagsFor(segment)}}${textFor()}`);
      for (const word of moved) events.push(`Dialogue: 1,${time(from)},${time(to)},Default,,0,0,0,,{\\an2${captionOverrideTags(segment.style, defaults, sanitizeWordOverrides(word.style), true)}}${textFor(word.wordIndex)}`);
    }
  }
  return header + events.join('\n') + '\n';
}
