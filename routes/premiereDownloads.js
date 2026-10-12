import { Router } from 'express';
import { PREMIERE_DOWNLOADS } from '../src/premiereRelease.js';

export function createPremiereDownloadsRouter({ directory, enabled = false }) {
  const router = Router();
  router.use((req, res, next) => {
    if (!enabled || !['GET', 'HEAD'].includes(req.method) || !PREMIERE_DOWNLOADS.includes(req.path.slice(1))) {
      return res.status(404).json({ error: 'ההורדה אינה זמינה' });
    }
    next();
  });
  router.get('/:filename', (req, res) => {
    res.download(req.params.filename, req.params.filename, {
      root: directory,
      dotfiles: 'deny',
      headers: { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' },
    }, error => {
      if (error && !res.headersSent) res.status(error.code === 'ENOENT' ? 503 : 500).json({ error: 'קובץ ההתקנה אינו זמין כרגע. נסו שוב בעוד כמה דקות.' });
    });
  });
  return router;
}
