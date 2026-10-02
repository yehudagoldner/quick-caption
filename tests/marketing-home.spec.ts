import { test, expect, type Page } from '@playwright/test';
import { prepareApp } from './app-fixtures';

async function guest(page: Page, loading = false) {
  await prepareApp(page);
  await page.route('**/src/client/contexts/AuthContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `export const useAuth = () => ({ user: null, loading: ${loading}, signIn: async () => { window.signInCalls = (window.signInCalls || 0) + 1; }, signOut: async () => {} }); export const AuthProvider = ({ children }) => children;` }));
}

for (const width of [320, 390, 900, 1366, 1920]) {
  test(`marketing fits ${width}px, styles work, and demo needs no login`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await guest(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('הסגנון שלכם.');
    await expect.poll(() => page.locator('.marketing-preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    if (width === 390 || width === 1366) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `tmp/marketing-redesign/home-${width}.png`, fullPage: true });
      if (width === 1366) await page.screenshot({ path: 'tmp/marketing-redesign/hero-desktop.png' });
    }
    if (width >= 900) {
      await expect(page.getByRole('button', { name: 'התחילו ליצור כתוביות' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('region', { name: 'הדגמת סגנונות כתוביות' })).toBeInViewport({ ratio: 1 });
    }
    await page.getByRole('button', { name: 'צפו בדוגמה' }).click();
    await expect(page.getByRole('button', { name: 'השהיית הדגמה' })).toBeVisible();
    await expect.poll(() => page.getByTestId('marketing-caption').locator('.is-active').innerText()).not.toBe('כל');
    await page.getByRole('button', { name: 'השהיית הדגמה' }).click();
    const paused = await page.getByTestId('marketing-caption').locator('.is-active').innerText();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('marketing-caption').locator('.is-active')).toHaveText(paused);
    await page.getByRole('button', { name: /נקי וקלאסי/ }).click();
    await expect(page.getByTestId('marketing-caption')).toHaveClass(/marketing-caption-clean/);
    await page.getByRole('button', { name: /בולט בסושיאל/ }).click();
    await expect(page.getByTestId('marketing-caption')).toHaveClass(/marketing-caption-bold/);
    expect(await page.evaluate(() => (window as any).signInCalls ?? 0)).toBe(0);
    await page.locator('summary').filter({ hasText: 'איך התשלום עובד?' }).click();
    await expect(page.getByText('התמלול משתמש בקרדיטים.', { exact: false })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.getByRole('button', { name: 'לסרטון הבא שלכם' }).click();
    expect(await page.evaluate(() => (window as any).signInCalls)).toBe(1);
  });
}

test('signed-in footer starts upload at the top and section links preserve browser history', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepareApp(page);
  await page.goto('/');
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole('link', { name: 'שאלות נפוצות', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'לפני שמתחילים.' })).toBeInViewport();
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.getByRole('button', { name: 'לסרטון הבא שלכם' }).click();
  await expect(page).toHaveURL(/screen=transcription/);
  await expect(page.getByTestId('media-dropzone')).toBeInViewport();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test('desktop marketing and demo are available while authentication loads', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await guest(page, true);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'טוענים...', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'צפו בדוגמה' }).click();
  await expect(page.getByRole('button', { name: 'השהיית הדגמה' })).toBeVisible();
});
