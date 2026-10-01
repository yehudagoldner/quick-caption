import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function setup(page: Page, mode: 'admin' | 'member' | 'guest' = 'admin') {
  const account = { uid: 'member-id', email: 'member@example.com', displayName: 'משתמש לבדיקה', credits: 50, createdAt: '2026-09-30T08:00:00Z', paying: false, admin: false };
  const overview = {
    revenue: { revenueUSD: '25.00', payments: 2 }, users: { total: 2, free: 1, paying: 1 },
    media: { processed: 3, videos: 2, edited: 1, durationSeconds: 3600 },
    usage: { costUSD: '0.0450', inputTokens: 12345, outputTokens: 1000, calls: 4, unpriced: 1, trackingSince: '2026-09-30T08:00:00Z' },
    models: [{ model: 'gpt-6-luna', serviceTier: 'fast', calls: 4, inputTokens: 12345, outputTokens: 1000, cachedTokens: 200, durationSeconds: 0, costUSD: '0.0450', unpriced: 1 }],
    admins: [{ email: 'goldnery@gmail.com', grantedBy: 'goldnery@gmail.com', createdAt: '2026-09-30' }], audit: [],
  };
  await page.route('**/src/client/contexts/AuthContext.tsx', route => route.fulfill({ contentType: 'application/javascript', body: `const user = ${mode === 'guest' ? 'null' : `{ uid: 'owner-id', email: '${mode === 'admin' ? 'goldnery@gmail.com' : 'member@example.com'}', displayName: 'Review', getIdToken: async () => 'ui-test-token' }`}; export const useAuth = () => ({ user, loading: false, signIn: async () => {}, signOut: async () => {} }); export const AuthProvider = ({ children }) => children;` }));
  await page.routeWebSocket('**/socket.io/**', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: { credits: 50, videos: [] } }));
  const grants: object[] = [];
  await page.route('**/api/admin/**', async route => {
    expect(route.request().headers().authorization).toBe('Bearer ui-test-token');
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/session')) return route.fulfill({ json: { isAdmin: mode === 'admin' } });
    if (mode === 'member') return route.fulfill({ status: 403, json: { error: 'אין לחשבון זה גישה לניהול.' } });
    if (url.pathname.endsWith('/overview')) return route.fulfill({ json: overview });
    if (url.pathname.endsWith('/users')) return route.fulfill({ json: { users: [account], total: 1, page: 0 } });
    const body = route.request().postDataJSON(); grants.push(body);
    if (url.pathname.endsWith('/credits')) account.credits += body.credits;
    else overview.admins.push({ email: body.email, grantedBy: 'goldnery@gmail.com', createdAt: '2026-09-30' });
    return route.fulfill({ json: { success: true, newBalance: account.credits } });
  });
  return grants;
}

test('admin deep link, user search, audited credit grants, admin invitations and route exit', async ({ page }) => {
  const grants = await setup(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'ניהול QuickCaption' })).toBeVisible();
  await expect(page.getByText('1 חינמיים · 1 משלמים')).toBeVisible();
  const search = page.getByLabel('חיפוש לפי אימייל או שם');
  await search.fill('member');
  await expect(search).toHaveValue('member');
  await page.getByRole('button', { name: 'הוספת קרדיטים', exact: true }).click();
  await page.getByLabel('מספר קרדיטים להוספה').fill('75');
  await page.getByLabel('סיבת הזיכוי').fill('פיצוי על תקלה');
  await page.getByRole('button', { name: 'הוספת הקרדיטים', exact: true }).click();
  await expect(page.getByText('נוספו 75 קרדיטים ל־member@example.com.')).toBeVisible();
  expect(grants[0]).toMatchObject({ userUid: 'member-id', credits: 75, reason: 'פיצוי על תקלה' });
  await page.getByRole('button', { name: 'הוספת מנהל', exact: true }).click();
  await page.getByLabel('אימייל המנהל').fill('another@example.com');
  await page.getByRole('button', { name: 'הוספת גישת ניהול' }).click();
  await expect(page.getByText('another@example.com', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'tmp/review/admin-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'דף הבית', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin$/);
});

test('mobile admin dashboard contains horizontal tables without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/admin');
  await expect(page.getByText('משתמשים וקרדיטים', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/review/admin-mobile.png', fullPage: true });
});

test('ordinary accounts see an access error, and guests see sign-in', async ({ page }) => {
  await setup(page, 'member'); await page.goto('/admin');
  await expect(page.getByText('אין לחשבון זה גישה לניהול.')).toBeVisible();
  await expect(page.getByText('משתמשים וקרדיטים', { exact: true })).toHaveCount(0);
});

test('guest admin route asks for login', async ({ page }) => {
  await setup(page, 'guest'); await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'התחברות לניהול' })).toBeVisible();
});
