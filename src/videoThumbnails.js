import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseBunnyReference } from './bunnyStreamStorage.js';
import { thumbnailVersion } from './thumbnailCache.js';

export function withVideoThumbnail(video, userUid, tokens, binding = {}) {
  const { stored_path, ...summary } = video;
  return { ...summary, thumbnail_url: video.media_type !== 'audio' && stored_path
    ? `/api/videos/${video.id}/thumbnail?v=${thumbnailVersion(stored_path)}&thumbnailToken=${encodeURIComponent(tokens.issue(video.id, userUid, 'thumbnail', undefined, binding))}` : null };
}

export function createVideoThumbnailHandler({ getVideoById, bunny, cache }) {
  return async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    const videoId = Number(req.params.id);
    if (!Number.isSafeInteger(videoId) || videoId < 1) return res.sendStatus(404);
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once('close', abort);
    try {
      // Merely viewing a cover is not opening/editing the project: no retention touch.
      const video = await getVideoById({ videoId, userUid: req.identity.uid, touch: false });
      if (!video || video.media_type === 'audio' || !video.stored_path) return res.sendStatus(404);
      if (req.query.v && req.query.v !== thumbnailVersion(video.stored_path)) return res.sendStatus(404);
      if (cache) {
        const bytes = await cache.get(video);
        if (res.destroyed || controller.signal.aborted) return;
        res.set('Content-Type', 'image/jpeg');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'private, max-age=3600, immutable');
        res.set('Content-Length', String(bytes.length));
        return req.method === 'HEAD' ? res.end() : res.send(bytes);
      }
      if (!parseBunnyReference(video.stored_path)) return res.sendStatus(404);
      const upstream = await bunny.openThumbnail(video.stored_path, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', signal: controller.signal });
      const type = upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type)) {
        await upstream.body?.cancel();
        return res.sendStatus(502);
      }
      res.set('Content-Type', type);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'private, max-age=300');
      const length = upstream.headers.get('content-length');
      if (length) res.set('Content-Length', length);
      if (req.method === 'HEAD') { await upstream.body?.cancel(); return res.end(); }
      if (!upstream.body) return res.sendStatus(502);
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (error) {
      if (res.destroyed || controller.signal.aborted) return;
      if (res.headersSent) return res.destroy();
      res.set('Cache-Control', 'private, no-store');
      res.sendStatus(error.status === 404 ? 404 : 502);
    } finally { res.off('close', abort); }
  };
}
