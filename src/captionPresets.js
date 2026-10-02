import { CAPTION_FONTS, getCaptionFont } from './captionFonts.js';
import { sanitizeCaptionFontSize } from './captionStyle.js';
import { sanitizeCaptionMotion, sanitizePopIntensity } from './captionMotion.js';

const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
const percent = (value, fallback, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
export function sanitizeCaptionAppearance(value = {}) {
  return { fontId: getCaptionFont(value.fontId).id,
    fontSize: value.fontSize === 'auto' || typeof value.fontSize !== 'number' ? 'auto' : sanitizeCaptionFontSize(value.fontSize),
    fontColor: color(value.fontColor, '#ffffff'), outlineColor: color(value.outlineColor, '#000000'),
    activeWordColor: color(value.activeWordColor, '#ffd700'), activeWordEnabled: value.activeWordEnabled === true,
    offsetYPercent: percent(value.offsetYPercent, 20, 100), marginPercent: percent(value.marginPercent, 5, 40),
    captionMotion: sanitizeCaptionMotion(value.captionMotion), popIntensity: sanitizePopIntensity(value.popIntensity) };
}
const preset = (id, name, category, description, style) => ({ id, name, category, description, style: sanitizeCaptionAppearance(style) });
export const CAPTION_PRESETS = [
  preset('clean', 'נקי', 'clean', 'קריא ופשוט · Heebo', { fontId: 'heebo' }),
  preset('bold', 'בולט', 'bold', 'אותיות עבות · Secular One', { fontId: 'secularone' }),
  preset('spotlight', 'זרקור', 'bold', 'הדגשה בירוק · Rubik', { fontId: 'rubik', activeWordEnabled: true, activeWordColor: '#b8ff48' }),
  preset('yellow-pop', 'צהוב קופץ', 'bold', 'מילה בודדת וקפיצה חזקה', { fontId: 'secularone', fontColor: '#ffe83b', captionMotion: 'pop', popIntensity: 'strong' }),
  preset('mint-pop', 'מנטה', 'playful', 'מילה בודדת וקפיצה עדינה', { fontId: 'rubik', fontColor: '#7fffd4', outlineColor: '#132b35', captionMotion: 'pop' }),
  preset('rounded', 'עגול', 'playful', 'קליל ושובב · Fredoka', { fontId: 'fredoka', outlineColor: '#352050', activeWordEnabled: true, activeWordColor: '#ffc1ed' }),
  preset('editorial', 'קלאסי', 'clean', 'מראה ספרותי · Frank Ruhl Libre', { fontId: 'frankruhllibre' }),
  preset('neon', 'ניאון', 'playful', 'טורקיז וסגול · Heebo', { fontId: 'heebo', fontColor: '#67e8f9', outlineColor: '#281545', activeWordEnabled: true, activeWordColor: '#e9a8ff' }),
];
export function sameCaptionAppearance(left, right) {
  const a = sanitizeCaptionAppearance(left), b = sanitizeCaptionAppearance(right);
  return Object.keys(a).every(key => a[key] === b[key]);
}
// Local templates are untrusted data. Bound their size and accept bundled fonts only.
export function readCustomCaptionPresets(raw) {
  try {
    const values = JSON.parse(raw || '[]');
    if (!Array.isArray(values)) return [];
    const ids = new Set();
    return values.slice(0, 24).filter(value => {
      if (!value || typeof value.id !== 'string' || !/^custom-[a-z0-9-]{1,80}$/i.test(value.id) || ids.has(value.id)
        || typeof value.name !== 'string' || !value.name.trim() || !value.style || !CAPTION_FONTS.some(font => font.id === value.style.fontId)) return false;
      ids.add(value.id); return true;
    }).map(value => ({ id: value.id, name: value.name.trim().slice(0, 40), category: 'custom', description: 'הסגנון שלך', style: sanitizeCaptionAppearance(value.style) }));
  } catch { return []; }
}
