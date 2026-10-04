import { test, expect, type Page } from '@playwright/test';
import { prepareApp } from './app-fixtures';

async function guest(page: Page, loading = false) {
  await prepareApp(page);
  await page.route('**/src/client/contexts/AuthContext.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: `export const useAuth = () => ({ user: null, loading: ${loading}, signIn: async () => { window.signInCalls = (window.signInCalls || 0) + 1; }, signOut: async () => {} }); export const AuthProvider = ({ children }) => children;` }));
}

const liveDemo = (page: Page) => page.getByRole('region', { name: 'הדגמה חיה של עורך הכתוביות' });
const caption = (page: Page) => page.getByTestId('demo-caption');
const activeWord = (page: Page) => caption(page).locator('[data-active-word]');

for (const width of [320, 390, 900, 1366, 1920]) {
  test(`marketing fits ${width}px and the live demo works without login`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await guest(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('שעוצרות את הגלילה.');
    await expect.poll(() => liveDemo(page).getByTestId('demo-stage').locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    if (width === 390 || width === 1366) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `tmp/marketing-redesign/home-${width}.png`, fullPage: true });
      if (width === 1366) await page.screenshot({ path: 'tmp/marketing-redesign/hero-desktop.png' });
    }
    if (width >= 900) {
      await expect(page.getByRole('button', { name: 'התחילו ליצור כתוביות' })).toBeInViewport({ ratio: 1 });
      await expect(liveDemo(page)).toBeInViewport();
    }

    await page.getByRole('button', { name: 'צפו בדוגמה' }).click();
    await expect(liveDemo(page)).toBeInViewport();
    const first = await activeWord(page).innerText();
    await expect.poll(() => activeWord(page).innerText(), { timeout: 10_000 }).not.toBe(first);
    await liveDemo(page).getByTestId('demo-stage').click();
    const paused = await activeWord(page).innerText();
    await page.waitForTimeout(800);
    await expect(activeWord(page)).toHaveText(paused);

    if (width >= 900) {
      const demo = liveDemo(page);
      await expect(demo.getByRole('button', { name: 'נגן', exact: true })).toBeVisible();
      await demo.getByRole('button', { name: 'מילה אקטיבית' }).click();
      await expect(activeWord(page)).toHaveCount(0);
      await demo.getByRole('button', { name: 'מילה אקטיבית' }).click();
      await expect(activeWord(page)).toHaveCount(1);

      await demo.getByRole('button', { name: 'צבעים' }).click();
      await page.getByLabel('צבע טקסט').fill('#ff0000');
      await expect(caption(page)).toHaveCSS('color', 'rgb(255, 0, 0)');
      await page.keyboard.press('Escape');

      await demo.getByRole('button', { name: 'עריכת כתובית: מתקנים מילה בקליק' }).click();
      await expect(page.getByTestId('demo-inspector')).toBeVisible();
      await page.getByTestId('demo-inspector').getByRole('textbox', { name: 'טקסט המקטע' }).fill('מתקנים כל מילה');
      await expect(caption(page)).toHaveText('מתקנים כל מילה');
      await expect(demo.getByRole('textbox', { name: 'טקסט הכתובית' }).nth(2)).toHaveValue('מתקנים כל מילה');
    }

    await page.getByRole('button', { name: 'צהוב בולט: נסו בעורך' }).click();
    await expect(page.getByRole('button', { name: 'צהוב בולט: נסו בעורך' })).toHaveAttribute('aria-pressed', 'true');
    await expect(caption(page)).toHaveCSS('color', 'rgb(255, 225, 77)');
    expect(await page.evaluate(() => (window as any).signInCalls ?? 0)).toBe(0);

    await page.locator('summary').filter({ hasText: 'איך התשלום עובד?' }).click();
    await expect(page.getByText('התמלול משתמש בקרדיטים.', { exact: false })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.getByRole('button', { name: 'לסרטון הבא שלכם' }).click();
    expect(await page.evaluate(() => (window as any).signInCalls)).toBe(1);
  });
}

test('phone layout shows the start dock after the hero and swipes features with dots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await guest(page);
  await page.goto('/');
  const dock = page.getByRole('region', { name: 'פעולות מהירות' });
  const dockStart = dock.getByRole('button', { name: 'התחילו עכשיו' });
  await expect(page.getByRole('button', { name: 'התחילו ליצור כתוביות' })).toBeInViewport({ ratio: 1 });
  await expect(dockStart).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'ניווט בעמוד השיווקי' })).toBeHidden();

  await page.locator('#how-it-works').scrollIntoViewIfNeeded();
  await expect(dockStart).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#how-it-works li').first()).toBeInViewport();

  const dots = page.getByRole('group', { name: 'מעבר בין יכולות' });
  await dots.scrollIntoViewIfNeeded();
  await expect(dots.getByRole('button')).toHaveCount(6);
  await expect(dots.getByRole('button', { name: '1 מתוך 6' })).toHaveAttribute('aria-current', 'true');
  await dots.getByRole('button', { name: '3 מתוך 6' }).click();
  await expect(dots.getByRole('button', { name: '3 מתוך 6' })).toHaveAttribute('aria-current', 'true');
  // Navigation changes the visible card without pulling the whole page upward.
  await expect.poll(() => page.getByRole('heading', { name: 'עריכה עם AI' }).evaluate(el => {
    const card = el.getBoundingClientRect();
    const carousel = el.closest('.marketing-bento')!.getBoundingClientRect();
    return card.left >= carousel.left && card.right <= carousel.right;
  })).toBe(true);

  await page.getByRole('button', { name: 'לסרטון הבא שלכם' }).scrollIntoViewIfNeeded();
  await expect(dockStart).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.locator('#how-it-works').scrollIntoViewIfNeeded();
  await dockStart.click();
  expect(await page.evaluate(() => (window as any).signInCalls)).toBe(1);
});

test('demo does not autoplay with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await guest(page);
  await page.goto('/');
  await expect(liveDemo(page).getByRole('button', { name: 'נגן', exact: true })).toBeVisible();
  const time = await page.getByTestId('demo-timecode').innerText();
  await page.waitForTimeout(700);
  await expect(page.getByTestId('demo-timecode')).toHaveText(time);
  await liveDemo(page).getByRole('button', { name: 'פריים קדימה' }).click();
  await expect(page.getByTestId('demo-timecode')).not.toHaveText(time);
});

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
  await expect(liveDemo(page).getByRole('button', { name: 'השהה', exact: true })).toBeVisible();
});
