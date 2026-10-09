import { test, expect } from '@playwright/test';

test('account credits reflect external charges and purchases on focus and periodic refresh', async ({ page }) => {
  await page.route('**/src/client/contexts/AuthContext.tsx*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export const useAuth = () => ({ user: { uid: 'credit-sync-fixture', displayName: 'Fixture' }, loading: false, signIn: async () => {}, signOut: async () => {} }); export const AuthProvider = ({ children }) => children;`,
  }));
  await page.route('**/api/**', route => route.fulfill({ json: { videos: [], isAdmin: false } }));
  let credits = 50, unavailable = false;
  await page.route('**/api/users/credits*', route => route.fulfill({ status: unavailable ? 503 : 200, json: { credits } }));
  await page.clock.install();
  await page.goto('/');
  const header = page.getByTestId('app-header');
  await expect(header.getByText('50 קרדיטים', { exact: true })).toBeVisible();
  credits = 47;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(header.getByText('47 קרדיטים', { exact: true })).toBeVisible();
  credits = 147;
  await page.clock.fastForward(31000);
  await expect(header.getByText('147 קרדיטים', { exact: true })).toBeVisible();
  unavailable = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(header.getByText('147 קרדיטים', { exact: true })).toHaveCount(0);
  await expect(header.getByText('0 קרדיטים', { exact: true })).toHaveCount(0);
});
