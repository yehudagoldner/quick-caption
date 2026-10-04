import { test, expect, type Page } from '@playwright/test';
import { prepareApp, mockPayPal } from './app-fixtures';

async function prepareSession(page: Page, loading = false, failSignOut = false) {
  await prepareApp(page);
  await mockPayPal(page);
  await page.route('**/api/admin/session', route => route.fulfill({ json: { isAdmin: true } }));
  await page.route('**/api/admin/overview', route => route.fulfill({ json: {
    revenue: { revenueUSD: 0, payments: 0 }, users: { total: 0, paying: 0, free: 0 },
    media: { processed: 0, videos: 0, edited: 0, durationSeconds: 0 },
    usage: { costUSD: 0, inputTokens: 0, outputTokens: 0, calls: 0, unpriced: 0, trackingSince: null },
    models: [], admins: [], audit: [],
  } }));
  await page.route('**/api/admin/users?**', route => route.fulfill({ json: { users: [], total: 0, page: 0 } }));
  await page.route('**/src/client/contexts/AuthContext.tsx*', async route => {
    const original = await (await route.fetch()).text();
    const reactUrl = original.match(/from "([^"]*\/react\.js[^"]*)"/)![1];
    await route.fulfill({
      contentType: 'application/javascript',
      body: `import React from '${reactUrl}';
      const { useState, useEffect } = React;
      const user = { uid: 'review-user', displayName: 'Review', getIdToken: async () => 'test-token' };
      let session = { user: ${loading ? 'null' : 'user'}, loading: ${loading} };
      const publish = next => { session = next; window.dispatchEvent(new Event('test-auth')); };
      window.finishAuth = () => publish({ user, loading: false });
      export function useAuth() {
        const [state, setState] = useState(session);
        useEffect(() => {
          const update = () => setState(session);
          window.addEventListener('test-auth', update);
          return () => window.removeEventListener('test-auth', update);
        }, []);
        return { ...state, signIn: async () => {}, signOut: async () => {
          window.signOutCalls = (window.signOutCalls || 0) + 1;
          if (${failSignOut}) throw new Error('Sign-out unavailable');
          publish({ user: null, loading: false });
        } };
      }
      export const AuthProvider = ({ children }) => children;`,
    });
  });
  // Record even brief error flashes between loading and the authenticated render.
  await page.addInitScript(() => {
    (window as any).errorFlashes = [];
    new MutationObserver(() => {
      document.querySelectorAll('[role=alert]').forEach(alert => (window as any).errorFlashes.push(alert.textContent));
    }).observe(document, { subtree: true, childList: true });
  });
}

for (const screen of ['edit&video=review-token', 'videos', 'buy-credits', 'transcription']) {
  test(`refresh waits for authentication on ${screen}`, async ({ page }) => {
    await prepareSession(page, true);
    await page.goto(`/?screen=${screen}`);
    const loading = page.getByRole('status', { name: 'טוען את החשבון' });
    await expect(loading).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.evaluate(() => (window as any).finishAuth());
    await expect(loading).toHaveCount(0);
    if (screen.startsWith('edit')) await expect(page.getByTestId('desktop-caption-editor')).toBeVisible();
    await page.reload();
    await expect(loading).toBeVisible();
    await page.evaluate(() => (window as any).finishAuth());
    await expect(loading).toHaveCount(0);
    if (screen.startsWith('edit')) await expect(page.getByTestId('desktop-caption-editor')).toBeVisible();
    expect(await page.evaluate(() => (window as any).errorFlashes)).toEqual([]);
  });
}

for (const route of ['/?screen=edit&video=review-token', '/?screen=videos', '/?screen=transcription', '/?screen=buy-credits', '/admin']) {
  test(`sign-out returns to marketing from ${route}`, async ({ page }) => {
    await prepareSession(page);
    await page.goto(route);
    if (route.includes('screen=edit')) await expect(page.getByTestId('desktop-caption-editor')).toBeVisible();
    await page.getByTestId('app-header').locator('.MuiAvatar-root').click();
    await page.getByRole('menuitem', { name: 'התנתקות' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: 'התחילו ליצור כתוביות' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'התחברות', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).signOutCalls)).toBe(1);
  });
}

test('failed sign-out keeps the signed-in account on the current screen', async ({ page }) => {
  await prepareSession(page, false, true);
  await page.goto('/?screen=videos');
  await page.getByTestId('app-header').locator('.MuiAvatar-root').click();
  await page.getByRole('menuitem', { name: 'התנתקות' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).signOutCalls)).toBe(1);
  await expect(page).toHaveURL(/screen=videos/);
  await expect(page.getByTestId('app-header').locator('.MuiAvatar-root')).toBeVisible();
  await expect(page.getByRole('status', { name: 'טוען את החשבון' })).toHaveCount(0);
});

test('mobile editor sign-out waits for a successful draft save', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareSession(page);
  let failSave = true;
  await page.route('**/api/videos/update-subtitles', route => route.fulfill({
    status: failSave ? 500 : 200, json: failSave ? { error: 'failed save' } : { success: true },
  }));
  await page.goto('/?screen=edit&video=review-token');
  await page.getByRole('button', { name: 'עריכה', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'טקסט המקטע' });
  await field.fill('טיוטה לפני התנתקות');
  const signOut = async () => {
    await page.getByRole('button', { name: 'תפריט', exact: true }).click();
    await page.getByRole('menuitem', { name: 'התנתקות' }).click();
  };
  await signOut();
  await expect(page.getByRole('alert').filter({ hasText: 'שמירת הכתובית נכשלה' })).toBeVisible();
  await expect(field).toHaveValue('טיוטה לפני התנתקות');
  expect(await page.evaluate(() => (window as any).signOutCalls ?? 0)).toBe(0);
  failSave = false;
  await signOut();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'התחילו ליצור כתוביות' })).toBeVisible();
});
