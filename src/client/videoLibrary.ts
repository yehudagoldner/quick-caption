import { apiFetch, apiUserUid } from './api';

const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '');
type Page = { videos: unknown[]; hasMore: boolean };
let snapshot: { uid: string; page: Page; at: number } | null = null;
let pending: { uid: string; promise: Promise<Page> } | null = null;
const images = new Map<string, HTMLImageElement>();

export function clearVideoLibrary() {
  snapshot = null;
  pending = null;
  for (const image of images.values()) image.src = '';
  images.clear();
}
export function cachedVideoLibrary<T>(uid: string): { videos: T[]; hasMore: boolean } | null {
  return apiUserUid() === uid && snapshot?.uid === uid && Date.now() - snapshot.at < 5 * 60_000
    ? snapshot.page as { videos: T[]; hasMore: boolean } : null;
}
export function preloadedThumbnail(url: string) {
  const image = images.get(url);
  return Boolean(image?.complete && image.naturalWidth > 0);
}
function preload(page: Page) {
  for (const value of page.videos.slice(0, 6)) {
    const video = value as { media_type?: string; thumbnail_url?: string | null };
    if (video.media_type === 'audio' || !video.thumbnail_url) continue;
    const url = API_BASE + video.thumbnail_url;
    if (images.has(url)) continue;
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.fetchPriority = 'low';
    images.set(url, image);
    image.onerror = () => { if (images.get(url) === image) images.delete(url); };
    image.src = url;
  }
  while (images.size > 12) images.delete(images.keys().next().value!);
}
export async function loadVideoLibrary<T>(uid: string, refresh = false): Promise<{ videos: T[]; hasMore: boolean }> {
  if (apiUserUid() !== uid) throw new Error('Account changed');
  if (!refresh && snapshot?.uid === uid && Date.now() - snapshot.at < 30_000) return snapshot.page as { videos: T[]; hasMore: boolean };
  if (pending?.uid === uid) return pending.promise as Promise<{ videos: T[]; hasMore: boolean }>;
  const request = (async () => {
    const response = await apiFetch(`${API_BASE}/api/videos?userUid=${encodeURIComponent(uid)}`);
    if (!response.ok) throw new Error('Failed to fetch videos');
    const data = await response.json();
    if (!Array.isArray(data.videos)) throw new Error('Invalid video list');
    if (apiUserUid() !== uid) throw new Error('Account changed');
    const page: Page = { videos: data.videos, hasMore: Boolean(data.hasMore) };
    snapshot = { uid, page, at: Date.now() };
    preload(page);
    return page;
  })();
  pending = { uid, promise: request };
  try { return await request as { videos: T[]; hasMore: boolean }; }
  finally { if (pending?.promise === request) pending = null; }
}

export async function warmVideoLibrary(uid: string) {
  try { await loadVideoLibrary(uid); } catch { /* Opening the library provides visible retry controls. */ }
}
