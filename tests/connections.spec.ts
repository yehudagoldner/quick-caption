import { test, expect } from '@playwright/test';
import { prepareApp } from './app-fixtures';

for (const width of [390, 1280]) {
  test(`connections list and targeted disconnection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prepareApp(page);
    let connections = [
      { id: 'web-current', kind: 'browser', label: 'Chrome · Windows', current: true, createdAt: '2026-10-10T09:00:00Z', lastSeenAt: '2026-10-10T10:00:00Z' },
      { id: 'premiere-other', kind: 'premiere', label: 'Premiere Pro', current: false, createdAt: null, lastSeenAt: null },
    ];
    const revoked: string[] = [];
    await page.route('**/api/connections', route => route.fulfill({ json: { connections } }));
    await page.route('**/api/connections/*/revoke', route => {
      revoked.push(route.request().url()); connections = connections.slice(0, 1);
      return route.fulfill({ json: { status: 'ok', disconnectedCurrent: false } });
    });
    await page.goto('/?screen=connections');
    await expect(page.getByRole('heading', { name: 'החיבורים שלי' })).toBeVisible();
    await expect(page.getByText('החיבור הנוכחי', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ניתוק Premiere Pro', exact: true }).click();
    await page.getByRole('button', { name: 'ביטול', exact: true }).click();
    expect(revoked).toHaveLength(0);
    await page.getByRole('button', { name: 'ניתוק Premiere Pro', exact: true }).click();
    await page.getByRole('button', { name: 'אישור ניתוק', exact: true }).click();
    await expect(page.getByText('החיבור נותק בהצלחה.')).toBeVisible();
    await expect(page.getByText('Premiere Pro', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Chrome · Windows', { exact: true })).toBeVisible();
    expect(revoked).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('profile navigation exposes connections and all-device confirmation includes current connection', async ({ page }) => {
  await prepareApp(page);
  await page.route('**/api/connections', route => route.fulfill({ json: { connections: [{ id: 'current', kind: 'browser', label: 'Chrome', current: true }] } }));
  await page.route('**/api/connections/revoke-all', route => route.fulfill({ status: 503, json: { error: 'ניתוק זמנית אינו זמין' } }));
  await page.goto('/');
  await page.getByTestId('app-header').locator('.MuiAvatar-root').click();
  await page.getByRole('menuitem', { name: 'החיבורים שלי' }).click();
  await expect(page).toHaveURL(/screen=connections/);
  await page.getByRole('button', { name: 'ניתוק כל החיבורים' }).click();
  await expect(page.getByRole('dialog')).toContainText('כולל החיבור שבו אתם משתמשים עכשיו');
  await page.getByRole('button', { name: 'אישור ניתוק' }).click();
  await expect(page.getByRole('alert')).toContainText('ניתוק זמנית אינו זמין');
  await expect(page.getByText('Chrome', { exact: true })).toBeVisible();
});

test('current/all disconnect emits sign-out event only after server success', async ({ page }) => {
  await prepareApp(page);
  await page.addInitScript(() => {
    (window as any).revokedUids = [];
    window.addEventListener('qc-connection-revoked', (event: Event) => (window as any).revokedUids.push((event as CustomEvent).detail.uid));
  });
  await page.route('**/api/connections', route => route.fulfill({ json: { connections: [{ id: 'current', kind: 'browser', label: 'Chrome', current: true }] } }));
  await page.route('**/api/connections/revoke-all', route => route.fulfill({ json: { status: 'ok', disconnectedCurrent: true } }));
  await page.goto('/?screen=connections');
  await page.getByRole('button', { name: 'ניתוק כל החיבורים' }).click();
  expect(await page.evaluate(() => (window as any).revokedUids)).toEqual([]);
  await page.getByRole('button', { name: 'אישור ניתוק' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).revokedUids)).toEqual(['review-user']);
});
