import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { pluginPolicy, quoteTranscription } from '../src/pluginPolicy.js';
import { segmentsToSrt } from '../src/subtitleSrt.js';

export function createPluginPublicRouter({ sessions, authenticate, upsertUser, getUserCredits }) {
  const router = Router();
  const buckets = new Map();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    // No forwarded headers are trusted without an explicitly configured proxy.
    const key = req.ip;
    const now = Date.now();
    for (const [ip, bucket] of buckets) if (bucket.until < now) buckets.delete(ip);
    if (!buckets.has(key)) {
      if (buckets.size >= 5000) return res.status(429).json({ error: 'נסה שוב בעוד דקה' });
      buckets.set(key, { until: now + 60000, requests: 0, starts: 0 });
    }
    const bucket = buckets.get(key);
    if (++bucket.requests > 120 || (req.path === '/start' && ++bucket.starts > 5)) {
      res.set('Retry-After', '60');
      return res.status(429).json({ error: 'נסה שוב בעוד דקה' });
    }
    next();
  });
  router.post('/start', async (req, res) => res.json(await sessions.start()));
  router.post('/poll', async (req, res) => res.json(await sessions.poll(req.body?.id, req.body?.deviceSecret)));
  router.post('/refresh', async (req, res) => res.json(await sessions.refresh(req.body?.refreshToken)));
  router.post('/approve', authenticate, async (req, res) => {
    if (!req.identity.email) return res.status(400).json({ error: 'נדרש חשבון עם כתובת דואר' });
    if (await getUserCredits(req.identity.uid) === null) {
      await upsertUser({ ...req.identity, emailVerified: Boolean(req.identity.emailVerified) });
    }
    res.json(await sessions.approve(req.body?.id, req.body?.userCode, req.identity));
  });
  router.use((error, req, res, next) => {
    if (!error.status) console.error('Plugin linking failed', error.code || error.name);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'החיבור נכשל. נסה שוב מאוחר יותר' });
  });
  return router;
}

export function createPluginPrivateRouter({ sessions, getUserCredits, getVideoById, diagnostics }) {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const diagnosticLimits = new Map();
  router.use('/diagnostics', (req, res, next) => {
    if (!diagnostics) return res.sendStatus(404);
    const now = Date.now(), uid = req.identity.uid;
    for (const [key, bucket] of diagnosticLimits) if (bucket.until <= now) diagnosticLimits.delete(key);
    if (!diagnosticLimits.has(uid) && diagnosticLimits.size >= 1000) return res.sendStatus(429);
    const bucket = diagnosticLimits.get(uid) || { count: 0, until: now + 60000 };
    diagnosticLimits.set(uid, bucket);
    if (++bucket.count > 20) return res.status(429).json({ error: 'Too many diagnostic requests' });
    next();
  });
  router.post('/diagnostics', async (req, res) => {
    try { res.status(202).json(await diagnostics.accept(req.identity.uid, req.body)); }
    catch (error) { res.status(error.status || 503).json({ error: 'Diagnostic unavailable' }); }
  });
  router.get('/diagnostics', async (req, res) => {
    try { res.json({ reports: await diagnostics.list(req.identity.uid) }); }
    catch { res.status(503).json({ error: 'Diagnostic unavailable' }); }
  });
  router.get('/account', async (req, res) => {
    const credits = await getUserCredits(req.identity.uid);
    if (credits === null) return res.status(404).json({ error: 'חשבון לא נמצא' });
    const { uid, email, displayName } = req.identity;
    res.json({ user: { uid, email, displayName }, credits, policy: pluginPolicy(), asOf: new Date().toISOString() });
  });
  router.post('/quote', async (req, res) => {
    let estimatedCredits;
    try { estimatedCredits = quoteTranscription(req.body?.durationSeconds); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const credits = await getUserCredits(req.identity.uid);
    if (credits === null) return res.status(404).json({ error: 'חשבון לא נמצא' });
    res.json({ jobId: randomUUID(), estimatedCredits, credits, canStart: credits >= estimatedCredits,
      policyVersion: pluginPolicy().version, expiresAt: new Date(Date.now() + 5 * 60000).toISOString() });
  });
  router.post('/logout', async (req, res) => {
    if (req.identity.pluginSessionId) await sessions.revoke(req.identity.pluginSessionId);
    res.json({ status: 'ok' });
  });
  router.get('/videos/:id/subtitles', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'מזהה לא תקין' });
    const video = await getVideoById({ videoId: id, userUid: req.identity.uid });
    if (!video) return res.status(404).json({ error: 'קובץ לא נמצא' });
    const segments = typeof video.subtitle_json === 'string' ? JSON.parse(video.subtitle_json) : video.subtitle_json;
    if (!Array.isArray(segments) || !segments.length) return res.status(404).json({ error: 'לא נמצאו כתוביות' });
    res.json({ filename: `${video.original_filename.replace(/\.[^.]+$/, '')}_subtitle.srt`,
      srt: segmentsToSrt(segments.map(segment => ({ ...segment, text: segment.text.replace(/[\u202a-\u202e]/g, '') }))) });
  });
  router.use((error, req, res, next) => {
    console.error('Plugin request failed', error.code || error.name);
    res.status(500).json({ error: 'הפעולה נכשלה. נסה שוב מאוחר יותר' });
  });
  return router;
}
