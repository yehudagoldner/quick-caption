import { test, expect, type Page } from '@playwright/test';

const overview = { revenue: { revenueUSD: 0, payments: 0 }, users: { total: 0, paying: 0, free: 0 },
  media: { processed: 0, videos: 0, edited: 0, durationSeconds: 0 },
  usage: { costUSD: 0, inputTokens: 0, outputTokens: 0, calls: 0, unpriced: 0, trackingSince: null }, models: [], admins: [], audit: [] };
const report = { id: 7, title: 'תקלה בהורדת סרטון', description: 'הלחיצה על הורדה אינה מגיבה.',
  user_uid: 'report-user', user_display_name: 'משתמש בדיקה', user_email: 'user@example.com',
  screen: 'home', status: 'open', created_at: '2026-10-03T08:00:00Z', updated_at: '2026-10-03T08:00:00Z' };

async function setup(page: Page, admin = true) {
  await page.route('**/src/client/contexts/AuthContext.tsx*', route => route.fulfill({
    contentType: 'application/javascript', body: `const user = { uid: 'report-user', email: 'user@example.com', displayName: 'Report review', getIdToken: async () => 'report-test-token' };
      export const useAuth = () => ({ user, loading: false, signIn: async () => {}, signOut: async () => {} });
      export const AuthProvider = ({children}) => children;`,
  }));
  await page.routeWebSocket('**/socket.io/**', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: { credits: 100, videos: [] } }));
  await page.route('**/api/admin/session', route => route.fulfill({ json: { isAdmin: admin } }));
  await page.route('**/api/admin/overview', route => route.fulfill({ json: overview }));
  await page.route('**/api/admin/users?**', route => route.fulfill({ json: { users: [], total: 0, page: 0 } }));
}

test('profile report preserves failed drafts, retries and appears in existing admin tab', async ({ page }) => {
  await setup(page);
  let fail = true;
  let saved: typeof report | null = null;
  await page.route('**/api/issue-reports', async route => {
    expect(route.request().headers().authorization).toBe('Bearer report-test-token');
    if (fail) return route.fulfill({ status: 503, json: { error: 'שגיאה זמנית. נסו שוב.' } });
    saved = { ...report, ...route.request().postDataJSON() };
    return route.fulfill({ status: 201, json: { reportId: report.id } });
  });
  await page.route('**/api/admin/issue-reports**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/status')) {
      saved!.status = route.request().postDataJSON().status;
      return route.fulfill({ json: { status: saved!.status } });
    }
    const status = url.searchParams.get('status');
    const reports = saved && (!status || status === saved.status) ? [saved] : [];
    return route.fulfill({ json: { reports, total: reports.length, page: 1, pageSize: 50 } });
  });
  await page.goto('/');
  await page.locator('header .MuiIconButton-root').last().click();
  await page.getByRole('menuitem', { name: 'דיווח על תקלה' }).click();
  const dialog = page.getByRole('dialog', { name: 'דיווח על תקלה' });
  await expect(dialog.getByRole('button', { name: 'שליחת דיווח' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'נושא התקלה' }).fill(report.title);
  await dialog.getByRole('textbox', { name: 'תיאור התקלה' }).fill(report.description);
  await dialog.getByRole('button', { name: 'שליחת דיווח' }).click();
  await expect(dialog.getByText('שגיאה זמנית. נסו שוב.')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'תיאור התקלה' })).toHaveValue(report.description);
  fail = false;
  await dialog.getByRole('button', { name: 'שליחת דיווח' }).click();
  await expect(dialog.getByText(/מספר הדיווח: 7/)).toBeVisible();
  await dialog.getByRole('button', { name: 'סגירה' }).click();
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'דיווחי משתמשים' }).click();
  const panel = page.getByRole('tabpanel', { name: 'דיווחי משתמשים' });
  await expect(panel.getByText(report.description)).toBeVisible();
  await panel.getByRole('combobox', { name: /סטטוס טיפול/ }).click();
  await page.getByRole('option', { name: 'בטיפול', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: /סטטוס טיפול/ })).toContainText('בטיפול');
  await panel.getByRole('combobox', { name: /^סטטוס כל הדיווחים$/ }).click();
  await page.getByRole('option', { name: 'טופל', exact: true }).click();
  await expect(panel.getByText('אין דיווחים בסטטוס שנבחר.')).toBeVisible();
  await panel.getByRole('combobox', { name: /^סטטוס טופל$/ }).click();
  await page.getByRole('option', { name: 'כל הדיווחים', exact: true }).click();
  await expect(panel.getByText(report.description)).toBeVisible();
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.screenshot({ path: 'tmp/review/user-issue-reports.png', fullPage: true });
});

test('mobile member can report without seeing admin entry, and malformed success retains draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, false);
  await page.route('**/api/issue-reports', route => route.fulfill({ json: { unexpected: true } }));
  await page.goto('/');
  await page.locator('header .MuiIconButton-root').last().click();
  await expect(page.getByRole('menuitem', { name: 'ניהול', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'דיווח על תקלה' }).click();
  const dialog = page.getByRole('dialog', { name: 'דיווח על תקלה' });
  await dialog.getByRole('textbox', { name: 'נושא התקלה' }).fill(report.title);
  await dialog.getByRole('textbox', { name: 'תיאור התקלה' }).fill(report.description);
  await dialog.getByRole('button', { name: 'שליחת דיווח' }).click();
  await expect(dialog.getByText('לא התקבל אישור שליחה תקין. נסו שוב.')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'נושא התקלה' })).toHaveValue(report.title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('screenshots upload, paste with Ctrl+V, retain drafts and open in the admin viewer', async ({ page, context }) => {
  await setup(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let savedScreenshot: { data: string; mimeType: string } | null = null;
  let fail = true;
  await page.route('**/api/issue-reports', route => {
    const body = route.request().postDataJSON();
    savedScreenshot = body.screenshot;
    return route.fulfill(fail ? { status: 503, json: { error: 'נסו שוב.' } } : { status: 201, json: { reportId: 7 } });
  });
  await page.route('**/api/admin/issue-reports**', route => {
    if (route.request().url().endsWith('/screenshot')) {
      expect(route.request().headers().authorization).toBe('Bearer report-test-token');
      return route.fulfill({ contentType: savedScreenshot!.mimeType, body: Buffer.from(savedScreenshot!.data, 'base64') });
    }
    return route.fulfill({ json: { reports: [{ ...report, has_screenshot: 1 }], total: 1, page: 1, pageSize: 50 } });
  });
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#eaf2ff'; ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = '#1976d2'; ctx.font = '24px sans-serif'; ctx.fillText('Screenshot example', 30, 95);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('header .MuiIconButton-root').last().click();
  await page.getByRole('menuitem', { name: 'דיווח על תקלה' }).click();
  const dialog = page.getByRole('dialog', { name: 'דיווח על תקלה' });
  await dialog.getByRole('textbox', { name: 'נושא התקלה' }).fill(report.title);
  await dialog.getByRole('textbox', { name: 'תיאור התקלה' }).fill(report.description);
  await dialog.getByLabel('בחירת צילום מסך').setInputFiles({ name: 'example.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(dialog.getByRole('img', { name: 'תצוגה מקדימה של צילום המסך' })).toBeVisible();
  await dialog.getByRole('button', { name: 'הסרת צילום' }).click();
  await expect(dialog.getByRole('img', { name: 'תצוגה מקדימה של צילום המסך' })).toHaveCount(0);
  await page.evaluate(async data => {
    const blob = new Blob([Uint8Array.from(atob(data), character => character.charCodeAt(0))], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, png);
  await dialog.getByRole('textbox', { name: 'תיאור התקלה' }).press('Control+V');
  await expect(dialog.getByRole('img', { name: 'תצוגה מקדימה של צילום המסך' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'תיאור התקלה' })).toHaveValue(report.description);
  await dialog.getByRole('button', { name: 'שליחת דיווח' }).click();
  await expect(dialog.getByText('נסו שוב.')).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'תצוגה מקדימה של צילום המסך' })).toBeVisible();
  expect(savedScreenshot!.mimeType).toBe('image/png');
  fail = false;
  await dialog.getByRole('button', { name: 'שליחת דיווח' }).click();
  await expect(dialog.getByText(/מספר הדיווח: 7/)).toBeVisible();
  await dialog.getByRole('button', { name: 'סגירה' }).click();
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'דיווחי משתמשים' }).click();
  await page.getByRole('button', { name: 'הצגת צילום מסך' }).click();
  const viewer = page.getByRole('dialog', { name: 'צילום מסך · דיווח #7' });
  await expect(viewer.getByRole('img', { name: 'צילום המסך המצורף לדיווח' })).toBeVisible();
  await viewer.getByRole('button', { name: 'סגירה' }).click();
  await expect(page.getByRole('img', { name: 'צילום מסך בדיווח 7' })).toBeVisible();
});

test('oversized uploads are rejected without replacing an attached screenshot', async ({ page }) => {
  await setup(page, false);
  await page.goto('/');
  await page.locator('header .MuiIconButton-root').last().click();
  await page.getByRole('menuitem', { name: 'דיווח על תקלה' }).click();
  const dialog = page.getByRole('dialog', { name: 'דיווח על תקלה' });
  await expect(dialog.getByRole('button', { name: 'צילום מסך', exact: true })).toHaveCount(0);
  await dialog.getByLabel('בחירת צילום מסך').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC2kAAAAASUVORK5CYII=', 'base64') });
  await expect(dialog.getByRole('img', { name: 'תצוגה מקדימה של צילום המסך' })).toBeVisible();
  await dialog.getByLabel('בחירת צילום מסך').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(dialog.getByText('יש לבחור תמונת PNG, JPG או WebP בגודל עד 5 MB.')).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'תצוגה מקדימה של צילום המסך' })).toBeVisible();
});
