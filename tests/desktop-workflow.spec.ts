import { test, expect } from '@playwright/test';
import { prepareApp, segments, testUid } from './app-fixtures';

for (const viewport of [{ width: 1366, height: 600 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`desktop editor fits ${viewport.width}x${viewport.height}, including word editing`, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit' && process.platform === 'win32', 'Windows WebKit cannot decode the media fixture; desktop media layout is verified in Chromium.');
    await page.setViewportSize(viewport);
    await prepareApp(page);
    await page.goto('/?screen=edit&video=review-token');
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
    const fits = async () => {
      await expect.poll(() => page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }))).toEqual({ x: 0, y: 0 });
      await expect(page.getByRole('group', { name: 'כלי עריכת כתוביות' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('caption-track')).toBeInViewport({ ratio: 1 });
      expect((await page.getByTestId('media-stage').boundingBox())!.height).toBeGreaterThanOrEqual(viewport.height < 700 ? 95 : 149);
    };
    await fits();
    await expect(page.getByText('עריכת כתוביות', { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'העלאת סרטון או אודיו אחר' })).toHaveCount(0);
    await page.getByTestId('subtitle-clip').first().click();
    const activeWord = page.getByRole('button', { name: 'מילה אקטיבית', exact: true });
    await activeWord.click();
    await expect(page.getByTestId('word-track')).toBeVisible();
    await fits();
    await expect(page.getByTestId('word-track')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `tmp/review/desktop-${viewport.width}x${viewport.height}.png` });
    await page.getByRole('button', { name: 'הצג עורך', exact: true }).click();
    await fits();
  });
}

test('new video in the header clears a completed transcription and opens file selection', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepareApp(page);
  await page.addInitScript(uid => localStorage.setItem(`quickcaption:transcription-job:${uid}`, '11111111-1111-4111-8111-111111111111'), testUid);
  await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: { status: 'completed', result: { videoId: 42, segments, words: [], warnings: ['תזמון משוער'], subtitle: { format: '.srt', content: 'test' } } } }));
  await page.goto('/?screen=transcription');
  await expect(page.getByTestId('caption-track')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QuickCaption' })).toBeHidden();
  await expect(page.getByText('תזמון משוער', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'סרטון חדש', exact: true }).click();
  await expect(page.getByTestId('media-dropzone')).toBeVisible();
  await expect(page.getByTestId('caption-track')).toHaveCount(0);
});

test('header navigation waits for a subtitle draft to be saved', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepareApp(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let savedText = '';
  await page.route('**/api/videos/update-subtitles', async route => {
    savedText = JSON.parse(route.request().postDataJSON().subtitleJson)[0].text;
    await pending;
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByRole('textbox', { name: 'טקסט המקטע' }).fill('טיוטה לפני סרטון חדש');
  await expect(page.getByRole('button', { name: 'סרטון חדש', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'טקסט המקטע' }).blur();
  await expect.poll(() => savedText).toBe('טיוטה לפני סרטון חדש');
  await expect(page).toHaveURL(/screen=edit/);
  release();
  await page.getByRole('button', { name: 'סרטון חדש', exact: true }).click();
  await expect(page.getByTestId('media-dropzone')).toBeVisible();
});
