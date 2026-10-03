import { Router } from 'express';
import { parseReportScreenshot } from '../src/issueReports.js';

const screens = new Set(['home', 'transcription', 'videos', 'edit', 'buy-credits', 'admin']);

// Mounted after the application's existing /api authentication middleware.
export function createIssueReportsRouter({ store }) {
  const router = Router();
  router.post('/', async (req, res) => {
    if (!req.identity?.uid) return res.status(401).json({ error: 'יש להתחבר כדי לדווח על תקלה.' });
    const { title, description, screen } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 200 ||
        typeof description !== 'string' || !description.trim() || description.trim().length > 5000 ||
        (screen !== undefined && !screens.has(screen))) {
      return res.status(400).json({ error: 'יש להזין כותרת (עד 200 תווים) ותיאור (עד 5,000 תווים).' });
    }
    try {
      const screenshot = parseReportScreenshot(req.body?.screenshot);
      const reportId = await store.createIssueReport({
        userUid: req.identity.uid, email: req.identity.email ?? null, displayName: req.identity.displayName ?? null,
        title: title.trim(), description: description.trim(), screen: screen ?? 'home',
        screenshot,
      });
      res.status(201).json({ reportId });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      res.status(503).json({ error: 'שליחת הדיווח נכשלה. התוכן נשמר בטופס, ואפשר לנסות שוב.' });
    }
  });
  return router;
}
