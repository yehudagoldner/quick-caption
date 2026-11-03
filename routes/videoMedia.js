import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';

const run = promisify(execFile);
export async function inspectReplacementVideo(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type,width,height:stream_disposition=attached_pic:format=duration', '-of', 'json', file.path],
  { timeout: 30_000, windowsHide: true, maxBuffer: 256 * 1024 });
  const data = JSON.parse(stdout);
  const video = data.streams?.find(stream => stream.codec_type === 'video' && stream.width > 0 && stream.height > 0 && !stream.disposition?.attached_pic);
  const duration = Number(data.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid video');
  return duration;
}

export function createVideoMediaRouter({ upload, getVideoById, updateMedia, mediaStorage, issueMediaToken, inspect = inspectReplacementVideo }) {
  const router = Router();
  router.put('/:id/media', async (req, res, next) => {
    const videoId = Number(req.params.id);
    if (!Number.isSafeInteger(videoId) || videoId <= 0) return res.status(400).json({ error: 'מזהה הסרטון אינו תקין.' });
    try {
      const video = await getVideoById({ videoId, userUid: req.identity.uid });
      if (!video) return res.status(404).json({ error: 'הסרטון לא נמצא או שאין הרשאה לערוך אותו.' });
      if (video.status !== 'completed' || !video.subtitle_json) return res.status(409).json({ error: 'אפשר להחליף סרטון רק בפרויקט שהתמלול שלו הסתיים.' });
      req.replacementVideo = video;
      next();
    } catch (error) { next(error); }
  }, upload.single('media'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'יש לבחור קובץ וידאו.' });
    const video = req.replacementVideo;
    let storedPath;
    let committed = false;
    try {
      let durationSeconds;
      try { durationSeconds = await inspect(req.file); }
      catch { return res.status(400).json({ error: 'הקובץ אינו סרטון תקין. בחרו קובץ וידאו אחר.' }); }
      let originalFilename = req.file.originalname;
      if (/[Ã×]/.test(originalFilename)) {
        const decoded = Buffer.from(originalFilename, 'latin1').toString('utf8');
        if (!decoded.includes('�')) originalFilename = decoded;
      }
      const mimeType = /^video\/[a-z0-9.+-]+$/i.test(req.file.mimetype) ? req.file.mimetype : 'video/mp4';
      const mediaToken = issueMediaToken(video.id, req);
      storedPath = await mediaStorage.persist({ ...req.file, mimetype: mimeType }, originalFilename);
      committed = await updateMedia({ videoId: video.id, userUid: req.identity.uid, previousStoredPath: video.stored_path,
        storedPath, originalFilename, mimeType, durationSeconds, sizeBytes: req.file.size });
      if (!committed) return res.status(409).json({ error: 'הסרטון השתנה בזמן ההעלאה. רעננו את העמוד ונסו שוב.' });
      // A failed replacement retains the old source. Delete it only after the
      // ownership-checked compare-and-swap has acknowledged the new source.
      if (video.stored_path && video.stored_path !== storedPath) {
        await mediaStorage.remove(video.stored_path).catch(() => console.error('Could not remove replaced video source'));
      }
      res.json({ success: true, mediaToken, originalFilename, durationSeconds });
    } catch (error) {
      console.error('Failed to replace video source:', error.code ?? error.name);
      res.status(500).json({ error: 'החלפת הסרטון נכשלה. נסו שוב.' });
    } finally {
      if (storedPath && !committed) await mediaStorage.remove(storedPath).catch(() => console.error('Could not clean up failed video replacement'));
      await unlink(req.file.path).catch(error => { if (error.code !== 'ENOENT') console.error('Could not clean up replacement upload'); });
    }
  });
  return router;
}
