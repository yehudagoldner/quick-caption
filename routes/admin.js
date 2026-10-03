import express from 'express';
import { normalizeEmail } from '../src/adminStore.js';
import { ISSUE_REPORT_STATUSES } from '../src/issueReports.js';

export function createAdminRouter({ authenticate, store }) {
  const router = express.Router();
  router.use(authenticate);
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const { email, emailVerified } = req.identity;
    if (!email || !emailVerified) return res.status(403).json({ error: 'נדרש חשבון עם אימייל מאומת.' });
    try {
      req.isAdmin = await store.isAdmin(email);
      if (req.path === '/session') return next();
      if (!req.isAdmin) return res.status(403).json({ error: 'אין לחשבון זה גישה לניהול.' });
      next();
    } catch { res.status(503).json({ error: 'לא ניתן לבדוק הרשאות כרגע.' }); }
  });
  router.get('/session', (req, res) => res.json({ isAdmin: req.isAdmin }));
  const handle = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (error) { res.status(error.status ?? 503).json({ error: error.status ? error.message : 'לא ניתן להשלים את הפעולה כרגע. אפשר לנסות שוב.' }); }
  };
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  router.get('/overview', handle(() => store.overview()));
  router.get('/issue-reports', handle(req => {
    const page = Number(req.query.page ?? 1), status = req.query.status;
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
        (status !== undefined && !ISSUE_REPORT_STATUSES.has(status))) {
      const error = new Error('סינון או מספר עמוד לא תקינים.'); error.status = 400; throw error;
    }
    return store.getIssueReports({ page, status });
  }));
  router.post('/issue-reports/:id/status', handle(async req => {
    const reportId = Number(req.params.id), status = req.body?.status;
    if (!Number.isSafeInteger(reportId) || reportId < 1 || !ISSUE_REPORT_STATUSES.has(status)) {
      const error = new Error('מספר דיווח או סטטוס לא תקינים.'); error.status = 400; throw error;
    }
    if (!await store.updateIssueReportStatus({ reportId, status })) {
      const error = new Error('הדיווח לא נמצא.'); error.status = 404; throw error;
    }
    return { status };
  }));
  router.get('/issue-reports/:id/screenshot', async (req, res) => {
    const reportId = Number(req.params.id);
    if (!Number.isSafeInteger(reportId) || reportId < 1) return res.status(400).json({ error: 'מספר דיווח לא תקין.' });
    try {
      const screenshot = await store.getIssueReportScreenshot(reportId);
      if (!screenshot) return res.status(404).json({ error: 'צילום המסך לא נמצא.' });
      res.set('Content-Type', screenshot.mimeType);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Disposition', 'inline');
      res.send(screenshot.buffer);
    } catch { res.status(503).json({ error: 'לא ניתן לטעון את צילום המסך כרגע.' }); }
  });
  router.get('/errors', handle(req => {
    const page = Number(req.query.page ?? 0);
    const snapshot = req.query.snapshot == null ? undefined : Number(req.query.snapshot);
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000 ||
        (snapshot != null && (!Number.isSafeInteger(snapshot) || snapshot < 0))) {
      const error = new Error('מספר עמוד לא תקין.'); error.status = 400; throw error;
    }
    return store.errors(page, snapshot);
  }));
  router.get('/users', handle(req => {
    const page = Number(req.query.page ?? 0), search = req.query.search ?? '';
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000 || typeof search !== 'string' || search.length > 255) {
      const error = new Error('חיפוש לא תקין.'); error.status = 400; throw error;
    }
    return store.users(search, page);
  }));
  router.post('/admins', handle(async req => {
    const email = normalizeEmail(req.body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 || !uuid(req.body?.requestId)) {
      const error = new Error('יש להזין כתובת אימייל תקינה.'); error.status = 400; throw error;
    }
    await store.grantAdmin({ email, requestId: req.body.requestId, actor: req.identity.email });
    return { success: true };
  }));
  router.post('/credits', handle(req => {
    const { userUid, credits, requestId, reason } = req.body ?? {};
    if (typeof userUid !== 'string' || !userUid || userUid.length > 128 || !Number.isSafeInteger(credits) || credits < 1 || credits > 1000000 ||
        !uuid(requestId) || typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
      const error = new Error('יש להזין 1–1,000,000 קרדיטים וסיבת זיכוי.'); error.status = 400; throw error;
    }
    return store.grantCredits({ userUid, credits, requestId, reason: reason.trim(), actor: req.identity.email });
  }));
  return router;
}
