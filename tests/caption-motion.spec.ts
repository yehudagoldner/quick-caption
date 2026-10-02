import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { prepareApp, portraitVideo, testUid } from './app-fixtures';

const segments = [{ id: 1, start: 0, end: 2, text: 'כן, כן!' }, { id: 2, start: 2, end: 4, text: 'שלום עולם' }];
const words = [{ word: 'כן', start: 0, end: .4 }, { word: 'כן', start: 1, end: 1.6 }, { word: 'שלום', start: 2, end: 2.8 }, { word: 'עולם', start: 3, end: 4 }];
async function setup(page: Page, mobile: boolean) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 });
  await prepareApp(page);
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), portraitVideo.length - 1) : portraitVideo.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm',
      headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}) },
      body: portraitVideo.subarray(start, end + 1) });
  });
  await page.route('**/src/client/api.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `\nsetApiUser({ uid: '${testUid}', getIdToken: async () => 'motion-fixture-token' });` });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: segments, words_json: words, format: '.srt', stored_path: 'portrait.mp4' } } }));
  const burns: string[] = [];
  await page.route('**/api/burn-subtitles', route => {
    burns.push(route.request().postDataBuffer()!.toString());
    return route.fulfill({ contentType: 'video/webm', body: portraitVideo });
  });
  return burns;
}
async function settings(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'עוד', exact: true }).click();
  await page.getByRole('button', { name: 'הגדרות כתוביות', exact: true }).click();
  await expect(page.getByRole('combobox', { name: /^אנימציית כתוביות/ })).toBeVisible();
  if (!mobile) await expect(page.getByRole('dialog', { name: 'הגדרות כתוביות', exact: true })).toHaveCSS('opacity', '1');
}
async function choose(page: Page, label: string, value: string) {
  await page.getByRole('combobox', { name: new RegExp(`^${label}`) }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
async function closeSettings(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'סגור', exact: true }).click();
  else await page.getByRole('button', { name: 'סגירת הגדרות כתוביות', exact: true }).click();
}
async function seek(page: Page, time: number) {
  await page.locator('video').evaluate((video: HTMLVideoElement, time) => { video.pause(); video.currentTime = time; }, time);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(time, 3);
}
async function scale(page: Page) {
  return page.getByTestId('caption-pop-word').evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
}
async function burn(page: Page, mobile: boolean) {
  await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole(mobile ? 'button' : 'menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click();
  await download;
}
mkdirSync('tmp/caption-motion', { recursive: true });

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} pop animation follows seek and pause, restarts repeated words, persists and reaches MP4 export`, async ({ page }) => {
    const burns = await setup(page, mobile);
    await page.goto('/?screen=edit&video=review-token');
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
    await expect(page.getByTestId('subtitle-overlay')).toHaveText('כן, כן!');
    await settings(page, mobile);
    await choose(page, 'אנימציית כתוביות', 'מילה בודדת עם קפיצה');
    await choose(page, 'עוצמת הקפיצה', 'חזקה');
    await closeSettings(page, mobile);
    await seek(page, .01);
    await expect(page.getByTestId('caption-pop-word')).toHaveText('כן,');
    await expect.poll(() => scale(page)).toBeLessThan(.8);
    await seek(page, .14);
    await expect.poll(() => scale(page)).toBeGreaterThan(1.1);
    const pausedScale = await scale(page);
    await page.waitForTimeout(250);
    expect(await scale(page)).toBe(pausedScale);
    await seek(page, .3);
    await expect.poll(() => scale(page)).toBe(1);
    await seek(page, .7);
    await expect(page.getByTestId('subtitle-overlay')).toHaveCount(0);
    await seek(page, 1.01);
    await expect(page.getByTestId('caption-pop-word')).toHaveText('כן!');
    await expect.poll(() => scale(page)).toBeLessThan(.8);
    await page.locator('video').evaluate((video: HTMLVideoElement) => { video.muted = true; return video.play(); });
    await expect.poll(() => scale(page)).toBe(1);
    await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
    await seek(page, 2.3);
    await expect(page.getByTestId('caption-pop-word')).toHaveText('שלום');
    await page.screenshot({ path: `tmp/caption-motion/${mobile ? 'mobile' : 'desktop'}-preview.png` });
    await burn(page, mobile);
    expect(burns[0]).toMatch(/name="captionMotion"\r\n\r\npop\r\n/);
    expect(burns[0]).toMatch(/name="popIntensity"\r\n\r\nstrong\r\n/);
    expect(burns[0]).toMatch(/name="words"/);
    expect(burns[0]).not.toMatch(/name="activeWordEnabled"/);
    await settings(page, mobile);
    await choose(page, 'עוצמת הקפיצה', 'עדינה');
    await closeSettings(page, mobile);
    await burn(page, mobile);
    expect(burns).toHaveLength(2);
    expect(burns[1]).toMatch(/name="popIntensity"\r\n\r\ngentle\r\n/);
    await page.reload();
    await expect(page.getByTestId('caption-pop-word')).toHaveText('כן,');
    await settings(page, mobile);
    await expect(page.getByRole('combobox', { name: /^עוצמת הקפיצה/ })).toHaveText('עדינה');
    await page.screenshot({ path: `tmp/caption-motion/${mobile ? 'mobile' : 'desktop'}-settings.png` });
    await choose(page, 'אנימציית כתוביות', 'ללא אנימציה');
    await closeSettings(page, mobile);
    await expect(page.getByTestId('subtitle-overlay')).toHaveText('כן, כן!');
    // Standard subtitle files retain the entire original caption text.
    await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
    const subtitleDownload = page.waitForEvent('download');
    await page.getByRole(mobile ? 'link' : 'menuitem', { name: 'הורד קובץ כתוביות', exact: true }).click();
    const downloaded = await subtitleDownload;
    const { readFile } = await import('node:fs/promises');
    expect(await readFile((await downloaded.path())!, 'utf8')).toContain('כן, כן!');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('new transcription sends animation settings and word timings to burning', async ({ page }) => {
  const burns = await setup(page, false);
  await page.route('**/api/transcribe', route => route.fulfill({ json: { text: 'כן, כן!', segments, words, subtitle: { format: '.srt', content: 'test' } } }));
  await page.goto('/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: 'new.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await page.getByRole('button', { name: 'שלחו לעיבוד', exact: true }).click();
  await settings(page, false);
  await choose(page, 'אנימציית כתוביות', 'מילה בודדת עם קפיצה');
  await closeSettings(page, false);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  await burn(page, false);
  expect(burns[0]).toMatch(/name="captionMotion"\r\n\r\npop\r\n/);
  expect(burns[0]).toMatch(/name="segments"/);
  expect(burns[0]).toMatch(/name="words"/);
});
