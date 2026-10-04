import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createIssueReportsRouter } from '../routes/issueReports.js';
import { createAdminRouter } from '../routes/admin.js';
import { parseReportScreenshot, MAX_SCREENSHOT_BYTES } from '../src/issueReports.js';

const screenshot = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC2kAAAAASUVORK5CYII=' };

test('user reports use authenticated identity and existing admin permissions', async t => {
  const rows = [];
  const store = {
    isAdmin: async email => email === 'owner@example.com',
    createIssueReport: async row => { rows.push({ ...row, id: rows.length + 1, status: 'open' }); return rows.length; },
    getIssueReports: async ({ status, page }) => {
      const reports = rows.filter(row => !status || row.status === status);
      return { reports: reports.slice((page - 1) * 50, page * 50), total: reports.length, page, pageSize: 50 };
    },
    updateIssueReportStatus: async ({ reportId, status }) => {
      const row = rows.find(row => row.id === reportId);
      if (!row) return false;
      row.status = status; return true;
    },
    getIssueReportScreenshot: async id => rows.find(row => row.id === id)?.screenshot ?? null,
  };
  const authenticate = (req, res, next) => {
    const email = req.headers.authorization;
    if (!['member@example.com', 'owner@example.com'].includes(email)) return res.sendStatus(401);
    req.identity = { uid: 'verified-user', email, emailVerified: true, displayName: 'משתמש מאומת' }; next();
  };
  const app = express(); app.use(express.json({ limit: '8mb' }));
  app.use('/api/admin', createAdminRouter({ authenticate, store }));
  app.use('/api/issue-reports', authenticate, createIssueReportsRouter({ store }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, email, body) => fetch(`${base}/api${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(email ? { Authorization: email } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const valid = { title: ' תקלה בהורדה ', description: 'לא ניתן להוריד סרטון 🎬', screen: 'edit', userUid: 'forged', email: 'owner@example.com' };
  assert.equal((await request('/issue-reports', null, valid)).status, 401);
  const submitted = await request('/issue-reports', 'member@example.com', valid);
  assert.equal(submitted.status, 201); assert.equal((await submitted.json()).reportId, 1);
  assert.equal(rows[0].userUid, 'verified-user'); assert.equal(rows[0].email, 'member@example.com');
  assert.equal(rows[0].title, 'תקלה בהורדה'); assert.equal(rows[0].status, 'open');
  for (const invalid of [{ title: ' ' }, { title: 'x'.repeat(201) }, { description: ' ' }, { description: 'x'.repeat(5001) }, { screen: 'unknown' }, { title: {} }]) {
    assert.equal((await request('/issue-reports', 'member@example.com', { ...valid, ...invalid })).status, 400);
  }
  assert.equal((await request('/admin/issue-reports', 'member@example.com')).status, 403);
  assert.equal((await request('/admin/issue-reports/1/status', 'member@example.com', { status: 'resolved' })).status, 403);
  const list = await (await request('/admin/issue-reports', 'owner@example.com')).json();
  assert.equal(list.total, 1); assert.equal(list.reports[0].description, valid.description);
  for (const status of ['in_progress', 'resolved', 'open']) {
    assert.equal((await request('/admin/issue-reports/1/status', 'owner@example.com', { status })).status, 200);
    assert.equal((await (await request(`/admin/issue-reports?status=${status}`, 'owner@example.com')).json()).total, 1);
  }
  assert.equal((await request('/admin/issue-reports/999/status', 'owner@example.com', { status: 'open' })).status, 404);
  assert.equal((await request('/admin/issue-reports/1/status', 'owner@example.com', { status: 'invalid' })).status, 400);
  for (const query of ['page=-1', 'page=1.5', 'page=1000001', 'status=unknown']) {
    assert.equal((await request(`/admin/issue-reports?${query}`, 'owner@example.com')).status, 400);
  }
  const originalSave = store.createIssueReport;
  store.createIssueReport = async () => { throw new Error('Database down'); };
  assert.equal((await request('/issue-reports', 'member@example.com', valid)).status, 503);
  store.createIssueReport = originalSave;
  assert.equal((await request('/issue-reports', 'member@example.com', { ...valid, screenshot })).status, 201);
  assert.equal((await request('/admin/issue-reports/2/screenshot', 'member@example.com')).status, 403);
  assert.equal((await request('/admin/issue-reports/2/screenshot')).status, 401);
  const image = await request('/admin/issue-reports/2/screenshot', 'owner@example.com');
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(screenshot.data, 'base64'));
  assert.equal((await request('/admin/issue-reports/1/screenshot', 'owner@example.com')).status, 404);
  assert.equal((await request('/admin/issue-reports/invalid/screenshot', 'owner@example.com')).status, 400);
  for (const invalid of [{ ...screenshot, mimeType: 'image/svg+xml' }, { ...screenshot, data: Buffer.from('<svg/>').toString('base64') }, { ...screenshot, data: 'bad base64' }, { ...screenshot, data: Buffer.alloc(MAX_SCREENSHOT_BYTES + 1).toString('base64') }]) {
    assert.equal((await request('/issue-reports', 'member@example.com', { ...valid, screenshot: invalid })).status, 400);
  }
});

test('screenshot validation checks bytes and preserves optional screenshots', () => {
  assert.equal(parseReportScreenshot(null), null);
  assert.equal(parseReportScreenshot(undefined), null);
  assert.equal(parseReportScreenshot(screenshot).mimeType, 'image/png');
  assert.throws(() => parseReportScreenshot({ ...screenshot, mimeType: 'image/jpeg' }));
});
