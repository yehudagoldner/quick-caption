import { test, expect, type Page } from '@playwright/test';
import { prepareApp, segments, portraitVideo } from './app-fixtures';

const words = [
  { word: 'שלום', start: 0, end: 1, segmentId: 1 },
  { word: 'עולם', start: 1, end: 2, segmentId: 1 },
  { word: 'סרטון', start: 2, end: 3, segmentId: 2 },
  { word: 'לבדיקה', start: 3, end: 4, segmentId: 2 },
];
async function openEditor(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), portraitVideo.length - 1) : portraitVideo.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm',
      headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}) },
      body: portraitVideo.subarray(start, end + 1) });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: segments, words_json: words, format: '.srt', stored_path: 'portrait.mp4' } } }));
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'עריכה', exact: true }).click();
}

test('mobile loop visibly toggles and stops on every exit from editing', async ({ page }) => {
  await openEditor(page);
  const off = page.getByRole('button', { name: 'לולאה כבויה · הפעלה' });
  const on = page.getByRole('button', { name: 'לולאה פעילה · כיבוי' });
  await expect(off).toHaveAttribute('aria-pressed', 'false');
  await off.click();
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  await on.click();
  await expect(off).toBeVisible();
  for (const destination of ['תזמון', 'עיצוב', 'עריכה', 'עוד']) {
    await off.click();
    await expect(on).toBeVisible();
    await page.getByRole('button', { name: destination, exact: true }).click();
    if (destination === 'עוד') await page.keyboard.press('Escape');
    if (destination === 'עיצוב') await page.getByRole('button', { name: 'סגירת עיצוב' }).click();
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
    await page.locator('video').evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 2.5; v.dispatchEvent(new Event('timeupdate')); });
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(2.4);
    if (destination !== 'עוד') await page.getByRole('button', { name: 'עריכה', exact: true }).click();
    await expect(off).toBeVisible();
  }
});

test('mobile word timing validates input, retries failed saves and preserves other words with undo', async ({ page }) => {
  await openEditor(page);
  let failSave = true;
  const saves: any[] = [];
  await page.route('**/api/videos/update-subtitles', async route => {
    const body = route.request().postDataJSON();
    saves.push({ segments: JSON.parse(body.subtitleJson), words: JSON.parse(body.wordsJson) });
    await route.fulfill({ status: failSave ? 500 : 200, json: failSave ? { error: 'test failure' } : { success: true } });
  });
  await page.getByRole('button', { name: 'תזמון מילים', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const first = dialog.getByRole('region', { name: 'תזמון מילה 1: שלום' });
  const save = dialog.getByRole('button', { name: 'שמירת תזמון' });
  await expect(save).toBeDisabled();
  await first.getByRole('textbox', { name: 'סיום המילה', exact: true }).fill('invalid');
  await expect(save).toBeDisabled();
  await first.getByRole('textbox', { name: 'סיום המילה', exact: true }).fill('00:00:01:15');
  await expect(dialog.getByText('התזמון חופף למילה אחרת. בחרו טווח פנוי.').first()).toBeVisible();
  await expect(save).toBeDisabled();
  await first.getByRole('textbox', { name: 'סיום המילה', exact: true }).fill('00:00:00:20');
  await save.click();
  await expect(dialog.getByText('שמירת התזמון נכשלה.', { exact: false })).toBeVisible();
  await expect(first.getByRole('textbox', { name: 'סיום המילה', exact: true })).toHaveValue('00:00:00:20');
  failSave = false;
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(saves.at(-1).segments).toEqual(segments);
  expect(saves.at(-1).words.find((word: any) => word.word === 'שלום').end).toBeCloseTo(20 / 24);
  expect(saves.at(-1).words.filter((word: any) => word.word !== 'שלום').map(({ word, start, end, segmentId }: any) => ({ word, start, end, segmentId }))).toEqual(words.slice(1));
  await page.getByRole('button', { name: 'תזמון מילים', exact: true }).click();
  await expect(first.getByRole('textbox', { name: 'סיום המילה', exact: true })).toHaveValue('00:00:00:20');
  await dialog.getByRole('button', { name: 'ביטול', exact: true }).click();
  await page.getByRole('button', { name: 'תזמון', exact: true }).click();
  await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => saves.at(-1).words.find((word: any) => word.word === 'שלום').end).toBe(1);
});

test('word timing flushes edited text before opening and fits a narrow phone', async ({ page }) => {
  await openEditor(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route('**/api/videos/update-subtitles', route => route.fulfill({ json: { success: true } }));
  await page.getByRole('textbox', { name: 'טקסט המקטע' }).fill('שלום עולם חדש');
  await page.getByRole('button', { name: 'תזמון מילים', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('region')).toHaveCount(3);
  const overflow = await dialog.evaluate(element => Array.from(element.querySelectorAll('section')).some(row => row.scrollWidth > row.clientWidth));
  expect(overflow).toBe(false);
  await expect(dialog.getByRole('button', { name: 'שמירת תזמון' })).toBeInViewport();
  await expect(page.locator('.MuiDialog-container')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'tmp/review/mobile-word-timing-320.png' });
});
