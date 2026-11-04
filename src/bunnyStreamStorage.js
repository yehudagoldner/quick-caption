import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const GUID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const REFERENCE = new RegExp(`^bunny://([1-9]\\d*)/(${GUID})$`, 'i');
export function parseBunnyReference(value) {
  const match = typeof value === 'string' && value.match(REFERENCE);
  return match ? { libraryId: match[1], videoId: match[2] } : null;
}

function storageError(message, status = 502) {
  return Object.assign(new Error(message), { code: 'BUNNY_STORAGE_ERROR', status });
}

// Credentials stay on the server. A durable reference, rather than a public URL,
// is persisted in videos.stored_path; existing ownership checks still apply.
export function createBunnyStreamStorage(env = process.env, fetchImpl = fetch) {
  const config = () => {
    const libraryId = env.BUNNY_STREAM_LIBRARY_ID?.trim();
    const apiKey = env.BUNNY_STREAM_API_KEY?.trim();
    const hostname = env.BUNNY_STREAM_CDN_HOSTNAME?.trim();
    if (!/^[1-9]\d*$/.test(libraryId ?? '') || !apiKey || !/^[a-z0-9.-]+\.b-cdn\.net$/i.test(hostname ?? '')) {
      throw storageError('אחסון הסרטונים אינו מוגדר. יש להגדיר את פרטי Bunny בשרת.', 503);
    }
    return { libraryId, apiKey, hostname };
  };
  const endpoint = (libraryId, videoId = '') => `https://video.bunnycdn.com/library/${libraryId}/videos${videoId ? `/${videoId}` : ''}`;
  const api = async (url, options = {}) => {
    const { apiKey } = config();
    let response;
    try {
      response = await fetchImpl(url, { ...options, headers: { AccessKey: apiKey, Accept: 'application/json', ...options.headers },
        signal: options.signal ?? AbortSignal.timeout(15 * 60 * 1000) });
    } catch { throw storageError('החיבור לאחסון הסרטונים נכשל. נסו להעלות שוב.'); }
    if (!response.ok && !(options.method === 'DELETE' && response.status === 404)) {
      await response.body?.cancel();
      throw storageError(`אחסון הסרטונים דחה את הבקשה (HTTP ${response.status}). נסו שוב או בדקו את הגדרות Bunny.`);
    }
    return response;
  };
  const reference = storedPath => {
    const parsed = parseBunnyReference(storedPath);
    if (!parsed || parsed.libraryId !== config().libraryId) throw storageError('ספריית הסרטון אינה תואמת להגדרות האחסון.');
    return parsed;
  };
  const cdnUrl = (videoId, filename) => {
    const url = new URL(`https://${config().hostname}/${videoId}/${filename}`);
    if (env.BUNNY_STREAM_TOKEN_KEY) {
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const token = createHash('sha256').update(env.BUNNY_STREAM_TOKEN_KEY + url.pathname + expires).digest('base64url');
      url.searchParams.set('token', token);
      url.searchParams.set('expires', expires);
    }
    return url;
  };
  const thumbnailNames = new Map();
  const previewMetadata = new Map();
  const openMedia = async (storedPath, filename, { method = 'GET', range, signal } = {}) => {
    const { videoId } = reference(storedPath);
    let response;
    try {
      response = await fetchImpl(cdnUrl(videoId, filename), { method, redirect: 'error', signal: signal ?? AbortSignal.timeout(15 * 60 * 1000),
        headers: { Referer: env.BUNNY_STREAM_REFERER || 'https://player.mediadelivery.net/', 'Accept-Encoding': 'identity', ...(range ? { Range: range } : {}) } });
    } catch { throw storageError('לא ניתן להתחבר לסרטון המאוחסן. נסו שוב.'); }
    if (!response.ok && response.status !== 416) {
      await response.body?.cancel();
      throw storageError(filename === 'original' && response.status === 404
        ? 'קובץ המקור לא זמין ב־Bunny. ודאו שהאפשרות Keep original files מופעלת.'
        : filename !== 'original' && response.status === 404 ? 'גרסת התצוגה עדיין אינה זמינה. נסו שוב בעוד כמה שניות.'
          : filename === 'original' ? 'Bunny חסם את קריאת הסרטון. בדקו את הגדרות הגישה לספרייה.' : 'טעינת הסרטון נכשלה. נסו שוב.', response.status === 404 ? 404 : 502);
    }
    return response;
  };
  const storage = {
    async upload(file, title) {
      const { libraryId } = config();
      const created = await api(endpoint(libraryId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      const { guid } = await created.json();
      const storedPath = `bunny://${libraryId}/${guid}`;
      if (!parseBunnyReference(storedPath)) throw storageError('אחסון הסרטונים החזיר מזהה לא תקין.');
      try {
        const stream = createReadStream(file.path);
        try {
          const uploaded = await api(endpoint(libraryId, guid), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size) }, body: stream, duplex: 'half' });
          const result = await uploaded.json();
          if (result.success !== true) throw storageError('העלאת הסרטון לא אושרה על ידי Bunny.');
        } finally {
          const closed = finished(stream, { cleanup: true }).catch(() => {});
          stream.destroy();
          await closed;
        }
        // A successful ingest is not enough if the editor cannot retrieve the
        // source later. Keep original files must be enabled before uploading.
        const check = await storage.open(storedPath, { method: 'GET', range: 'bytes=0-0' });
        await check.body?.cancel();
        return storedPath;
      } catch (error) {
        try { await storage.remove(storedPath); } catch { /* Preserve the original failure; no local fallback. */ }
        throw error;
      }
    },
    async remove(storedPath) {
      const { libraryId, videoId } = reference(storedPath);
      const response = await api(endpoint(libraryId, videoId), { method: 'DELETE' });
      await response.body?.cancel();
    },
    open(storedPath, options) {
      return openMedia(storedPath, 'original', options);
    },
    openPreview(storedPath, quality, options) {
      if (!['240p', '360p', '480p', '720p', '1080p'].includes(quality)) throw storageError('איכות התצוגה אינה תקינה.', 400);
      return openMedia(storedPath, `play_${quality}.mp4`, options);
    },
    async previewInfo(storedPath) {
      const { libraryId, videoId } = reference(storedPath);
      const cached = previewMetadata.get(storedPath);
      if (cached && cached.expires > Date.now()) return cached.info;
      const metadata = await (await api(endpoint(libraryId, videoId), { signal: AbortSignal.timeout(15_000) })).json();
      const qualities = metadata.hasMP4Fallback && metadata.status === 4 ? ['240p', '360p', '480p', '720p', '1080p'].filter(quality =>
        String(metadata.availableResolutions ?? '').split(',').map(value => value.trim()).includes(quality)) : [];
      const sourceDimensions = Number(metadata.width) > 0 && Number(metadata.height) > 0
        ? { width: Number(metadata.width), height: Number(metadata.height) } : null;
      const mode = qualities.length && sourceDimensions ? 'rendition' : metadata.status === 4 ? 'unavailable' : 'pending';
      const defaultQuality = qualities.includes('720p') ? '720p' : qualities.filter(q => parseInt(q) <= 720).at(-1) ?? qualities[0] ?? null;
      const info = { mode, qualities, defaultQuality, sourceDimensions };
      if (previewMetadata.size >= 500) previewMetadata.delete(previewMetadata.keys().next().value);
      previewMetadata.set(storedPath, { info, expires: Date.now() + (mode === 'rendition' ? 60_000 : 5_000) });
      return info;
    },
    async openThumbnail(storedPath, { method = 'GET', signal } = {}) {
      const { libraryId, videoId } = reference(storedPath);
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
      let cached = thumbnailNames.get(storedPath);
      if (!cached || cached.expires <= Date.now()) {
        const metadata = await (await api(endpoint(libraryId, videoId), { signal: requestSignal })).json();
        const filename = metadata.thumbnailFileName;
        if (!filename) throw storageError('התמונה המקדימה עדיין אינה זמינה.', 404);
        // Bunny returns a basename, never a URL or arbitrary file path.
        if (!/^[a-z0-9_-]+\.(?:jpe?g|png|webp|avif)$/i.test(filename)) throw storageError('שם תמונה מקדימה אינו תקין.');
        cached = { filename, expires: Date.now() + 5 * 60_000 };
        if (thumbnailNames.size >= 500) thumbnailNames.delete(thumbnailNames.keys().next().value);
        thumbnailNames.set(storedPath, cached);
      }
      let response;
      try {
        response = await fetchImpl(cdnUrl(videoId, cached.filename), { method, redirect: 'error', signal: requestSignal,
          headers: { Referer: env.BUNNY_STREAM_REFERER || 'https://player.mediadelivery.net/', 'Accept-Encoding': 'identity' } });
      } catch { throw storageError('טעינת התמונה המקדימה נכשלה.'); }
      if (!response.ok) {
        await response.body?.cancel();
        thumbnailNames.delete(storedPath);
        throw storageError('התמונה המקדימה אינה זמינה.', response.status === 404 ? 404 : 502);
      }
      return response;
    },
  };
  return storage;
}

export function localMediaPath(root, storedPath) {
  if (typeof storedPath !== 'string' || !storedPath || storedPath === '.' || storedPath === '..' || /[/\\\0]/.test(storedPath)) throw new Error('Unsafe stored media path');
  return path.join(root, storedPath);
}

export function createMediaStorage({ bunny, localDir }) {
  return {
    async persist(file, originalFilename) {
      if (!file.mimetype?.startsWith('audio/')) return bunny.upload(file, originalFilename);
      // Audio retains the existing storage policy; videos never fall back here.
      await fs.mkdir(localDir, { recursive: true });
      const name = `${randomUUID()}${path.extname(originalFilename).replace(/[^.a-z0-9]/gi, '').slice(0, 12)}`;
      await fs.copyFile(file.path, localMediaPath(localDir, name));
      return name;
    },
    async remove(storedPath) {
      if (parseBunnyReference(storedPath)) return bunny.remove(storedPath);
      await fs.unlink(localMediaPath(localDir, storedPath));
    },
  };
}

export async function serveBunnyMedia(req, res, video, bunny, quality = null) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  try {
    const options = { method: req.method === 'HEAD' ? 'HEAD' : 'GET', range: req.headers.range, signal: controller.signal };
    const upstream = quality ? await bunny.openPreview(video.stored_path, quality, options) : await bunny.open(video.stored_path, options);
    res.status(upstream.status);
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) res.set(name, value);
    }
    res.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    res.set('Content-Type', quality ? 'video/mp4' : video.mime_type || upstream.headers.get('content-type') || 'application/octet-stream');
    if (req.method === 'HEAD' || !upstream.body) { await upstream.body?.cancel(); return res.end(); }
    await pipeline(Readable.fromWeb(upstream.body), res);
  } finally { res.off('close', abort); }
}
