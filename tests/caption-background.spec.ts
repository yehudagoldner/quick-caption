import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo, segments as fixtureSegments, testUid } from './app-fixtures';
import type { Segment } from '../src/client/types';

async function setup(page: Page, mobile: boolean) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 });
  await prepareApp(page);
  await page.route('**/src/client/api.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `\nsetApiUser({ uid: '${testUid}', getIdToken: async () => 'appearance-fixture-token' });` });
  });
  let saved: Segment[] = structuredClone(fixtureSegments);
  let failSave = false;
  const burns: string[] = [];
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), portraitVideo.length - 1) : portraitVideo.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}) }, body: portraitVideo.subarray(start, end + 1) });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: saved, words_json: [], format: '.srt', stored_path: 'portrait.mp4' } } }));
  await page.route(/\/api\/videos\/(?:42\/subtitles|update-subtitles)$/, async route => {
    if (failSave) return route.fulfill({ status: 500, json: { error: 'fixture save failure' } });
    saved = JSON.parse(route.request().postDataJSON().subtitleJson);
    return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/burn-subtitles', route => {
    burns.push(route.request().postDataBuffer()!.toString());
    return route.fulfill({ contentType: 'video/webm', body: portraitVideo });
  });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  return { saved: () => saved, burns, fail: (value: boolean) => { failSave = value; } };
}

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} background controls preview, persist, override and export`, async ({ page }) => {
  const state = await setup(page, mobile);
  const overlay = page.getByTestId('subtitle-overlay');
  await expect(overlay).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: mobile ? 'עיצוב' : 'צבעים', exact: true }).click();
  const controls = page.getByTestId('caption-background-settings');
  await controls.getByLabel('צבע רקע הכתוביות', { exact: true }).fill('#123456');
  await controls.getByRole('slider', { name: 'שקיפות רקע הכתוביות' }).fill('50');
  await expect(overlay).toHaveCSS('background-color', 'rgba(18, 52, 86, 0.5)');
  await expect(overlay).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: `test-results/background-${mobile ? 'mobile' : 'desktop'}.png` });
  await page.reload();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  await expect(overlay).toHaveCSS('background-color', 'rgba(18, 52, 86, 0.5)');

  await page.getByTestId('caption-position').click();
  const panel = page.getByRole('region', { name: 'עיצוב כתובית נבחרת', exact: true });
  await panel.getByRole('tab', { name: 'צבע', exact: true }).click();
  await panel.getByRole('slider', { name: 'שקיפות רקע הכתוביות' }).fill('100');
  await expect(overlay).toHaveCSS('background-color', 'rgba(18, 52, 86, 0)');
  await expect.poll(() => state.saved()[0].style?.backgroundOpacity).toBe(0);
  await panel.getByRole('button', { name: 'סיום', exact: true }).click();
  await page.locator('video').evaluate((video: HTMLVideoElement) => { video.currentTime = 2.5; });
  await expect(overlay).toHaveText('סרטון לבדיקה');
  await expect(overlay).toHaveCSS('background-color', 'rgba(18, 52, 86, 0.5)');
  expect(state.saved()[1].style).toBeUndefined();

  await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole(mobile ? 'button' : 'menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click();
  await download;
  expect(state.burns.at(-1)).toMatch(/name="backgroundColor"\r\n\r\n#123456/);
  expect(state.burns.at(-1)).toMatch(/name="backgroundOpacity"\r\n\r\n50/);
  expect(state.burns.at(-1)).toContain('"backgroundOpacity":0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
