import { test, expect, type Page } from '@playwright/test';
import { prepareApp } from './app-fixtures';

async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepareApp(page);
  await page.goto('/?screen=edit&video=review-token');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  await page.locator('video').evaluate((video: HTMLVideoElement) => {
    video.muted = true;
    video.playbackRate = .1;
    const counts = { play: 0, pause: 0 };
    (window as any).__playbackEvents = counts;
    video.addEventListener('play', () => counts.play++);
    video.addEventListener('pause', () => counts.pause++);
  });
}
async function paused(page: Page, value: boolean) {
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(value);
}

test('Space from an editor toolbar button toggles playback without activating the button', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'הסתר עורך', exact: true }).click();
  await page.keyboard.press('Space');
  await paused(page, false);
  await expect(page.getByRole('button', { name: 'הצג עורך', exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await paused(page, true);
});

test('timeline and video focus each toggle exactly once and a held Space never repeats', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('subtitle-clip').first().click();
  await page.keyboard.press('Space');
  await paused(page, false);
  await page.keyboard.press('Space');
  await paused(page, true);
  await page.locator('video').focus();
  await page.keyboard.down('Space');
  await paused(page, false);
  for (let i = 0; i < 5; i++) await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  await expect.poll(() => page.evaluate(() => (window as any).__playbackEvents)).toEqual({ play: 2, pause: 1 });
  await page.keyboard.press('Space');
  await paused(page, true);
  await expect.poll(() => page.evaluate(() => (window as any).__playbackEvents)).toEqual({ play: 2, pause: 2 });
});

test('Space works from a selected word without changing word selection', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByRole('button', { name: 'מילה אקטיבית', exact: true }).click();
  const word = page.getByTestId('word-clip').first();
  await word.click();
  await expect(word).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await paused(page, false);
  await expect(word).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await paused(page, true);
});

test('Space stays a typed character and does not toggle playback in a dialog', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('subtitle-clip').first().click();
  const text = page.getByRole('textbox', { name: 'טקסט המקטע', exact: true });
  await text.fill('שלום');
  await page.keyboard.press('End');
  await page.keyboard.press('Space');
  await expect(text).toHaveValue('שלום ');
  await paused(page, true);
  // Cancel the draft so opening the keyboard help does not depend on saving.
  await page.getByRole('button', { name: 'ביטול טיוטה', exact: true }).click();
  await page.getByRole('button', { name: 'קיצורי מקלדת', exact: true }).click();
  await page.getByRole('button', { name: 'סגירה', exact: true }).focus();
  await page.keyboard.press('Space');
  await paused(page, true);
  await expect.poll(() => page.evaluate(() => (window as any).__playbackEvents.play)).toBe(0);
});

test('Space works with page focus, but never activates the editor from header navigation', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Space');
  await paused(page, false);
  await page.keyboard.press('Space');
  await paused(page, true);
  await page.getByRole('button', { name: 'היסטוריית סרטונים', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(/screen=videos/);
  await expect.poll(() => page.evaluate(() => (window as any).__playbackEvents.play)).toBe(1);
});
