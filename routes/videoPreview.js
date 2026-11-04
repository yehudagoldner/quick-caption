import { Router } from 'express';
import { parseBunnyReference } from '../src/bunnyStreamStorage.js';

export function createVideoPreviewRouter({ getVideoById, bunny, issueMediaToken }) {
  const router = Router();
  router.get('/:id/preview', async (req, res) => {
    const videoId = Number(req.params.id);
    if (!Number.isSafeInteger(videoId) || videoId <= 0) return res.status(400).json({ error: 'מזהה הסרטון אינו תקין.' });
    res.set('Cache-Control', 'private, no-store');
    try {
      const video = await getVideoById({ videoId, userUid: req.identity.uid });
      if (!video?.stored_path) return res.status(404).json({ error: 'הסרטון לא נמצא.' });
      const info = parseBunnyReference(video.stored_path) && video.media_type !== 'audio'
        ? await bunny.previewInfo(video.stored_path)
        : { mode: 'source', qualities: [], defaultQuality: null, sourceDimensions: null };
      res.json({ ...info, mediaToken: issueMediaToken(videoId, req) });
    } catch (error) {
      console.error('Failed to load preview information:', error.code ?? error.name);
      res.status(error.code === 'BUNNY_STORAGE_ERROR' ? error.status : 503).json({ error: 'טעינת התצוגה המקדימה נכשלה. נסו שוב.' });
    }
  });
  return router;
}
