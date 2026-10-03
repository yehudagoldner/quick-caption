import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { ISSUE_REPORT_SCHEMA, createIssueReportStore } from '../src/issueReports.js';

test('MySQL stores Hebrew reports, filters, paginates and updates statuses', { skip: process.env.RUN_MYSQL_TESTS !== '1' }, async t => {
  await import('../src/loadAppEnv.js');
  const db = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 10000 });
  t.after(() => db.end());
  await db.execute(ISSUE_REPORT_SCHEMA.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE'));
  const store = createIssueReportStore(db);
  const image = { buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC2kAAAAASUVORK5CYII=', 'base64'), mimeType: 'image/png' };
  const firstId = await store.createIssueReport({ userUid: 'test-only-user', email: 'test@example.com', displayName: 'משתמש בדיקה', title: 'תקלה בהורדה', description: 'לא ניתן להוריד 🎬', screen: 'edit', screenshot: image });
  for (let i = 0; i < 50; i++) await store.createIssueReport({ userUid: 'test-only-user', email: null, displayName: null, title: `דיווח ${i}`, description: 'בדיקה', screen: 'home' });
  const first = await store.getIssueReports({ page: 1 });
  const second = await store.getIssueReports({ page: 2 });
  assert.equal(first.total, 51); assert.equal(first.reports.length, 50); assert.equal(second.reports.length, 1);
  assert.equal(second.reports[0].description, 'לא ניתן להוריד 🎬');
  assert.equal(second.reports[0].has_screenshot, 1);
  assert.equal(first.reports[0].has_screenshot, 0);
  assert.equal('screenshot' in second.reports[0], false);
  const storedImage = await store.getIssueReportScreenshot(firstId);
  assert.deepEqual(storedImage.buffer, image.buffer); assert.equal(storedImage.mimeType, 'image/png');
  assert.equal(await store.updateIssueReportStatus({ reportId: firstId, status: 'resolved' }), true);
  assert.equal(await store.updateIssueReportStatus({ reportId: firstId, status: 'resolved' }), true);
  const resolved = await store.getIssueReports({ page: 1, status: 'resolved' });
  assert.equal(resolved.total, 1); assert.equal(resolved.reports[0].id, firstId);
  assert.equal((await store.getIssueReports({ page: 1, status: 'open' })).total, 50);
  assert.equal(await store.updateIssueReportStatus({ reportId: 999, status: 'resolved' }), false);
});
