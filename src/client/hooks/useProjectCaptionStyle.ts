import { useEffect, useMemo, useState } from 'react';
import { apiUserUid } from '../api';
import { sanitizeCaptionFontSize, type CaptionFontSizeSetting } from '../../captionStyle.js';

type Style = { fontSize: CaptionFontSizeSetting; fontColor: string; outlineColor: string; offsetYPercent: number; marginPercent: number };
const defaults: Style = { fontSize: 'auto', fontColor: '#ffffff', outlineColor: '#000000', offsetYPercent: 20, marginPercent: 5 };
function read(key: string | null): Style {
  try {
    const stored = JSON.parse(key ? localStorage.getItem(key) ?? '{}' : '{}');
    const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    const percent = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback;
    return { fontSize: stored.fontSize === 'auto' || typeof stored.fontSize !== 'number' ? 'auto' : sanitizeCaptionFontSize(stored.fontSize),
      fontColor: color(stored.fontColor, defaults.fontColor), outlineColor: color(stored.outlineColor, defaults.outlineColor),
      offsetYPercent: percent(stored.offsetYPercent, 20), marginPercent: percent(stored.marginPercent, 5) };
  } catch { return { ...defaults }; }
}

export function useProjectCaptionStyle(videoId: number | null) {
  const key = videoId ? `caption-style:${apiUserUid()}:${videoId}` : null;
  const loaded = useMemo(() => read(key), [key]);
  const [state, setState] = useState(() => ({ key, value: loaded }));
  const value = state.key === key ? state.value : loaded;
  useEffect(() => { if (state.key !== key) setState({ key, value: loaded }); }, [key, loaded, state.key]);
  useEffect(() => {
    if (!key || state.key !== key) return;
    try { localStorage.setItem(key, JSON.stringify(state.value)); } catch { /* Private browsing can disable storage. */ }
  }, [key, state]);
  const set = <K extends keyof Style>(field: K, next: Style[K]) => setState(previous => ({ key, value: { ...(previous.key === key ? previous.value : loaded), [field]: next } }));
  return { ...value, setFontSize: (next: CaptionFontSizeSetting) => set('fontSize', next),
    setFontColor: (next: string) => set('fontColor', next), setOutlineColor: (next: string) => set('outlineColor', next),
    setOffsetYPercent: (next: number) => set('offsetYPercent', next), setMarginPercent: (next: number) => set('marginPercent', next) };
}
