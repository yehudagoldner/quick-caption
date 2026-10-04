import express from 'express';

export function createDownloadsRouter({ store }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.identity?.uid) return res.status(401).json({ error: 'נדרשת התחברות.' });
    next();
  });
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const handle = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (error) { res.status(error.status ?? 503).json({ error: error.status ? error.message : 'לא ניתן לשמור כרגע. נסו שוב.' }); }
  };
  router.post('/', handle(req => {
    const { id, videoId, kind, format } = req.body ?? {};
    if (!uuid(id) || !Number.isSafeInteger(videoId) || videoId < 1 ||
        !(kind === 'subtitles' && ['srt', 'vtt', 'txt'].includes(format) || kind === 'video' && format === 'mp4')) {
      throw Object.assign(new Error('פרטי ההורדה אינם תקינים.'), { status: 400 });
    }
    return store.recordDownload({ id, userUid: req.identity.uid, videoId, kind, format });
  }));
  router.post('/:downloadId/feedback', handle(req => {
    const { rating, feedback = '' } = req.body ?? {};
    if (!uuid(req.params.downloadId) || !Number.isInteger(rating) || rating < 1 || rating > 5 || typeof feedback !== 'string' || feedback.length > 2000) {
      throw Object.assign(new Error('בחרו דירוג בין 1 ל־5 כוכבים ופידבק עד 2,000 תווים.'), { status: 400 });
    }
    return store.saveFeedback({ downloadId: req.params.downloadId, userUid: req.identity.uid, rating, feedback: feedback.trim() });
  }));
  return router;
}
