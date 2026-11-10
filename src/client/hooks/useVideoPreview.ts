import { useEffect, useRef, useState } from 'react';
import { apiFetch, apiUserUid } from '../api';

export type PreviewQuality = '240p' | '360p' | '480p' | '720p' | '1080p';
type Info = { mode: 'source' | 'rendition' | 'pending' | 'unavailable'; qualities: PreviewQuality[]; defaultQuality: PreviewQuality | null;
  sourceDimensions: { width: number; height: number } | null; mediaToken?: string };
const allowed: PreviewQuality[] = ['240p', '360p', '480p', '720p', '1080p'];

export function useVideoPreview(videoId: number | null, sourceUrl: string | null, onAutomaticSourceChange?: () => void) {
  const uid = apiUserUid();
  const enabled = Boolean(videoId && sourceUrl && uid !== 'guest');
  const key = `${uid}:${videoId}:${sourceUrl}`;
  const [state, setState] = useState<{ key: string; info: Info | null; error: string | null }>({ key: '', info: null, error: null });
  const [quality, setQuality] = useState<PreviewQuality>('720p');
  const [forcedSource, setForcedSource] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const beforeRendition = useRef<(info: Info) => void>(() => {});
  const info = state.key === key ? state.info : null;
  const error = state.key === key ? state.error : null;
  const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  useEffect(() => { setQuality('720p'); setForcedSource(null); }, [key]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setState({ key, info: null, error: null });
    const load = async () => {
      try {
        const result = await apiFetch(`${base}/api/videos/${videoId}/preview`, { signal: controller.signal });
        const data = await result.json();
        if (!result.ok) throw new Error(data?.error || 'טעינת התצוגה המקדימה נכשלה.');
        if (!['source', 'rendition', 'pending', 'unavailable'].includes(data.mode) || !Array.isArray(data.qualities)
          || data.qualities.some((value: PreviewQuality) => !allowed.includes(value))
          || data.mode === 'rendition' && (!data.qualities.length || !data.qualities.includes(data.defaultQuality) || !data.mediaToken
            || !Number.isFinite(data.sourceDimensions?.width) || !Number.isFinite(data.sourceDimensions?.height)
            || data.sourceDimensions.width <= 0 || data.sourceDimensions.height <= 0)) throw new Error('לא התקבלו פרטי תצוגה תקינים.');
        if (controller.signal.aborted) return;
        beforeRendition.current(data);
        setState({ key, info: data, error: null });
        if (data.mode === 'pending') timer = setTimeout(() => { void load(); }, 5000);
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, info: null, error: error instanceof Error ? error.message : 'טעינת התצוגה המקדימה נכשלה.' });
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [enabled, key, base, videoId, attempt]);
  const selected = info?.qualities.includes(quality) ? quality : info?.defaultQuality ?? '720p';
  const source = !enabled || forcedSource === key || info?.mode === 'source';
  const mediaUrl = source ? sourceUrl : info?.mode === 'rendition'
    ? `${base}/api/videos/${videoId}/media?mediaToken=${encodeURIComponent(info.mediaToken!)}&preview=${selected}` : sourceUrl;
  // Capture playback before React replaces the temporary source with a ready rendition.
  beforeRendition.current = next => {
    if (forcedSource === key || next.mode !== 'rendition') return;
    const nextQuality = next.qualities.includes(quality) ? quality : next.defaultQuality;
    const nextUrl = `${base}/api/videos/${videoId}/media?mediaToken=${encodeURIComponent(next.mediaToken!)}&preview=${nextQuality}`;
    if (mediaUrl !== nextUrl) onAutomaticSourceChange?.();
  };
  return { mediaUrl, quality: selected, qualities: info?.qualities ?? [], select: setQuality,
    sourceDimensions: info?.sourceDimensions ?? null,
    status: source ? 'source' : info?.mode ?? (error ? 'error' : 'loading'), error,
    retry: () => setAttempt(value => value + 1), useSource: () => setForcedSource(key) };
}
