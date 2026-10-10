import { test, expect, type Page } from '@playwright/test';
import { portraitVideo, segments } from './app-fixtures';

const overview = { revenue: { revenueUSD: 0, payments: 0 }, users: { total: 0, paying: 0, free: 0 },
  media: { processed: 0, videos: 0, edited: 0, durationSeconds: 0 },
  usage: { costUSD: 0, inputTokens: 0, outputTokens: 0, calls: 0, unpriced: 0, trackingSince: null },
  models: [], admins: [], audit: [] };
async function setup(page: Page) {
  await page.route('**/src/client/contexts/AuthContext.tsx*', route => route.fulfill({
    contentType: 'application/javascript', body: `import { setApiUser } from '/src/client/api.ts';
      const user = { uid: 'error-ui-test', email: 'goldnery@gmail.com', displayName: 'Error review', getIdToken: async () => 'test-token' };
      setApiUser(user); export const useAuth = () => ({ user, loading: false, signIn: async () => {}, signOut: async () => {} });
      export const AuthProvider = ({children}) => children;`,
  }));
  await page.routeWebSocket('**/socket.io/**', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: { credits: 100, videos: [] } }));
  await page.route('**/api/admin/session', route => route.fulfill({ json: { isAdmin: true } }));
  await page.route('**/api/admin/overview', route => route.fulfill({ json: overview }));
  await page.route('**/api/admin/users?**', route => route.fulfill({ json: { users: [], total: 0, page: 0 } }));
}
const row = (id: number) => ({ id, source: 'server', status: 500, method: 'PUT', operation: '/api/videos/1/subtitles',
  message: `שגיאת בדיקה ${id}`, userUid: 'test-user', requestId: `request-${id}`, createdAt: '2026-10-02T09:00:00Z' });

test('admin errors load lazily, paginate 50 at a time, keep a snapshot and refresh to new records', async ({ page }) => {
  await setup(page);
  const requests: URL[] = [];
  let newest = 105;
  await page.route('**/api/admin/errors?**', route => {
    expect(route.request().headers().authorization).toBe('Bearer test-token');
    const url = new URL(route.request().url()); requests.push(url);
    const index = Number(url.searchParams.get('page'));
    const snapshot = Number(url.searchParams.get('snapshot') ?? newest);
    const ids = Array.from({ length: snapshot }, (_, i) => snapshot - i).slice(index * 50, index * 50 + 50);
    return route.fulfill({ json: { errors: ids.map(row), total: snapshot, page: index, pageSize: 50, snapshot } });
  });
  await page.goto('/admin');
  await expect(page.getByRole('tab', { name: 'שגיאות', exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('tab', { name: 'שגיאות', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'שגיאות', exact: true });
  await expect(panel.getByRole('row')).toHaveCount(51);
  await expect(panel.getByText('שגיאת בדיקה 105', { exact: true })).toBeVisible();
  newest = 106;
  await panel.getByRole('button', { name: 'הבא', exact: true }).click();
  await expect(panel.getByRole('row')).toHaveCount(51);
  await expect(panel.getByText('שגיאת בדיקה 55', { exact: true })).toBeVisible();
  expect(requests[1].searchParams.get('snapshot')).toBe('105');
  await panel.getByRole('button', { name: 'הבא', exact: true }).click();
  await expect(panel.getByRole('row')).toHaveCount(6);
  await expect(panel.getByRole('button', { name: 'הבא', exact: true })).toBeDisabled();
  await expect(panel.getByText('105 שגיאות · עמוד 3 מתוך 3')).toBeVisible();
  await page.getByRole('button', { name: 'רענון', exact: true }).click();
  await expect(panel.getByText('שגיאת בדיקה 106', { exact: true })).toBeVisible();
  await expect(panel.getByText('106 שגיאות · עמוד 1 מתוך 3')).toBeVisible();
  await page.screenshot({ path: 'tmp/review/admin-errors-desktop.png', fullPage: true });
});

test('admin errors handle HTML outages, retry, empty state and a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  let failed = true;
  await page.route('**/api/admin/errors?**', route => failed ? route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Unavailable</h1>' }) :
    route.fulfill({ json: { errors: [], total: 0, page: 0, pageSize: 50, snapshot: 0 } }));
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'שגיאות', exact: true }).click();
  await expect(page.getByText('שירות הניהול אינו זמין כרגע. אפשר לנסות שוב.')).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'ניסיון נוסף', exact: true }).click();
  await expect(page.getByText('לא נרשמו שגיאות.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/review/admin-errors-mobile.png', fullPage: true });
});

for (const malformed of ['HTML', 'unacknowledged JSON']) test(`a 200 ${malformed} save response retains the draft and allows retry`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: {
    video: { id: 42, subtitle_json: segments, words_json: [], format: '.srt', stored_path: 'portrait.mp4' },
  } }));
  await page.route('**/api/videos/42/media?**', route => route.fulfill({ contentType: 'video/webm', body: portraitVideo }));
  let fail = true;
  const saved: string[] = [];
  const reports: { code: string }[] = [];
  await page.route('**/api/client-errors', route => {
    reports.push(route.request().postDataJSON()); return route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.route('**/api/videos/update-subtitles', route => {
    saved.push(JSON.parse(route.request().postDataJSON().subtitleJson)[0].text);
    return route.fulfill(!fail ? { json: { status: 'ok' } } : malformed === 'HTML' ?
      { contentType: 'text/html', body: '<h1>Proxy landing page</h1>' } : { json: { status: 'unknown' } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await page.getByRole('button', { name: 'עריכת כתובית: שלום עולם', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'טקסט הכתובית' });
  await input.fill('טיוטה ללא אישור שמירה');
  await page.getByRole('button', { name: 'שמירה וסיום', exact: true }).click();
  await expect(page.getByText('שמירת הכתובית נכשלה.', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/screen=edit/);
  await expect(input).toHaveValue('טיוטה ללא אישור שמירה');
  await expect.poll(() => reports.some(report => report.code === 'save-invalid-response')).toBe(true);
  fail = false;
  await page.getByRole('button', { name: 'שמירה וסיום', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'לסרטונים שלי', exact: true }).click();
  await expect(page).toHaveURL(/screen=videos/);
  expect(saved.length).toBeGreaterThanOrEqual(2);
  expect(saved.every(text => text === 'טיוטה ללא אישור שמירה')).toBe(true);
});

for (const status of [429, 503]) test(`browser error reports survive a ${status} and retry without losing their deduplication ID`, async ({ page }) => {
  await setup(page);
  const reports: { code: string; eventId: string }[] = [];
  let unavailable = true;
  await page.route('**/api/client-errors', route => {
    reports.push(route.request().postDataJSON());
    return route.fulfill({ status: unavailable ? status : 202, json: { accepted: !unavailable } });
  });
  await page.goto('/admin');
  await expect(page.getByRole('tab', { name: 'שגיאות', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const module = await import('/src/client/errorReporting.ts');
    module.reportClientError('save-network-error');
  });
  const pending = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('quickcaption:error-reports:error-ui-test') ?? '[]'));
  await expect.poll(() => reports.length).toBe(1);
  await expect.poll(pending).toHaveLength(1);
  unavailable = false;
  // Online listeners trigger immediate recovery without waiting for the retry timer.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => reports.length).toBe(2);
  await expect.poll(pending).toHaveLength(0);
  expect(reports[0].eventId).toBe(reports[1].eventId);
});

for (const status of [200, 502]) test(`upload recovers from an HTML ${status} response without resubmitting or losing the selected file`, async ({ page }) => {
  await setup(page);
  const reports: { code: string; status: number }[] = [];
  let uploads = 0;
  const uploadBodies: string[] = [];
  await page.route('**/api/client-errors', route => {
    reports.push(route.request().postDataJSON()); return route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.route('**/api/transcribe', route => {
    uploadBodies.push(route.request().postDataBuffer()!.toString());
    uploads++; return route.fulfill({ status, contentType: 'text/html', body: '<h1>Proxy error</h1>' });
  });
  await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: { status: 'failed', error: 'העיבוד נכשל. אפשר לנסות שוב.' } }));
  await page.goto('/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: 'retry.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(128) });
  await page.getByRole('button', { name: 'שלחו לעיבוד', exact: true }).click();
  await expect(page.getByRole('button', { name: 'שלחו לעיבוד', exact: true })).toBeEnabled();
  await expect(page.getByText('העיבוד נכשל. אפשר לנסות שוב.')).toBeVisible();
  expect(uploads).toBe(1);
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]).toMatchObject({ code: 'upload-invalid-response', status });
  await page.getByRole('button', { name: 'שלחו לעיבוד', exact: true }).click();
  await expect.poll(() => uploads).toBe(2);
  expect(uploadBodies.every(body => body.includes('filename="retry.wav"'))).toBe(true);
});
