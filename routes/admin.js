import express from 'express';
import { normalizeEmail } from '../src/adminStore.js';

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
