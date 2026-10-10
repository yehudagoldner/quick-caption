import { Router } from 'express';

export function createConnectionsRouter({ store }) {
  const router = Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.identity.browserConnectionId) return res.status(403).json({ error: 'יש לנהל חיבורים דרך האתר' });
    next();
  });
  router.get('/', async (req, res) => res.json({ connections: await store.list(req.identity.uid, req.identity.browserConnectionId) }));
  router.post('/logout', async (req, res) => {
    await store.revoke(req.identity.uid, req.identity.browserConnectionId);
    res.json({ status: 'ok', disconnectedCurrent: true });
  });
  router.post('/revoke-all', async (req, res) => {
    await store.revokeAll(req.identity.uid);
    res.json({ status: 'ok', disconnectedCurrent: true });
  });
  router.post('/:id/revoke', async (req, res) => {
    await store.revoke(req.identity.uid, req.params.id);
    res.json({ status: 'ok', disconnectedCurrent: req.params.id === req.identity.browserConnectionId });
  });
  router.use((error, req, res, next) => res.status(error.status || 503).json({ error: error.status ? error.message : 'ניהול החיבורים אינו זמין כרגע' }));
  return router;
}
