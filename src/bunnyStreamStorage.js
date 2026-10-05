import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
  const originalUrl = videoId => {
    const url = new URL(`https://${config().hostname}/${videoId}/original`);
    if (env.BUNNY_STREAM_TOKEN_KEY) {
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const token = createHash('sha256').update(env.BUNNY_STREAM_TOKEN_KEY + url.pathname + expires).digest('base64url');
      url.searchParams.set('token', token);
      url.searchParams.set('expires', expires);
    }
    return url;
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
        } finally { stream.destroy(); }
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
    async open(storedPath, { method = 'GET', range, signal } = {}) {
      const { videoId } = reference(storedPath);
      let response;
      try {
        response = await fetchImpl(originalUrl(videoId), { method, redirect: 'error', signal: signal ?? AbortSignal.timeout(15 * 60 * 1000),
          headers: { Referer: env.BUNNY_STREAM_REFERER || 'https://player.mediadelivery.net/', 'Accept-Encoding': 'identity', ...(range ? { Range: range } : {}) } });
      } catch { throw storageError('לא ניתן להתחבר לסרטון המאוחסן. נסו שוב.'); }
      if (!response.ok && response.status !== 416) {
        await response.body?.cancel();
        throw storageError(response.status === 404 ? 'קובץ המקור לא זמין ב־Bunny. ודאו שהאפשרות Keep original files מופעלת.' : 'Bunny חסם את קריאת הסרטון. בדקו את הגדרות הגישה לספרייה.', response.status === 404 ? 404 : 502);
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

export async function serveBunnyMedia(req, res, video, bunny) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  try {
    const upstream = await bunny.open(video.stored_path, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', range: req.headers.range, signal: controller.signal });
    res.status(upstream.status);
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) res.set(name, value);
    }
    res.set('Content-Type', video.mime_type || upstream.headers.get('content-type') || 'application/octet-stream');
    if (req.method === 'HEAD' || !upstream.body) { await upstream.body?.cancel(); return res.end(); }
    await pipeline(Readable.fromWeb(upstream.body), res);
  } finally { res.off('close', abort); }
}
