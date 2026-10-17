import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { prepareApp, segments } from './app-fixtures';
const landscape = Buffer.from(readFileSync('tests/fixtures/landscape-video.base64', 'utf8'), 'base64');

async function setup(page: Page, width = 1440, media = landscape) {
  await page.setViewportSize({ width, height: 1000 }); await prepareApp(page);
  let saved = structuredClone(segments); let fail = false; const burns: string[] = [];
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: saved, words_json: [], format: '.srt', stored_path: 'landscape.mp4' } } }));
  await page.route(/\/api\/videos\/(?:42\/subtitles|update-subtitles)$/, route => {
    if (fail) return route.fulfill({ status: 500, json: { error: 'fixture failure' } });
    saved = JSON.parse(route.request().postDataJSON().subtitleJson); return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/burn-subtitles', route => { burns.push(route.request().postDataBuffer()!.toString()); return route.fulfill({ contentType: 'video/mp4', body: landscape }); });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  return { saved: () => saved, fail: (value: boolean) => { fail = value; }, burns };
}
async function create(page: Page) { await page.getByRole('button', { name: 'כן, צור גרסאות', exact: true }).click(); await expect(page.getByRole('tablist', { name: 'גרסאות הסרטון' })).toBeVisible(); }
async function select(page: Page, format: string) { await page.getByRole('tab', { name: new RegExp(format) }).click(); await expect(page.getByRole('tab', { name: new RegExp(format) })).toHaveAttribute('aria-selected', 'true'); }
async function selectAtOne(page: Page) {
  await page.getByTestId('subtitle-clip').first().click();
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 1; });
  await expect(page.getByRole('button', { name: 'פיצול כתובית בנקודת הקו', exact: true })).toBeEnabled();
}
test('desktop: create, drag, independent split, split all, undo across versions and reload', async ({ page }) => {
  const state = await setup(page); await create(page); await select(page, '9:16');
  const frame = page.getByTestId('video-crop-frame'); await expect(frame).toBeVisible();
  const bounds = await frame.boundingBox();
  await page.mouse.move(bounds!.x + 20, bounds!.y + 20); await page.mouse.down(); await page.mouse.move(bounds!.x + 90, bounds!.y + 20, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => Number(await frame.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  const position = await frame.getAttribute('aria-valuenow');
  await selectAtOne(page); await page.getByRole('button', { name: 'פיצול כתובית בנקודת הקו', exact: true }).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3); expect(state.saved()).toHaveLength(2);
  await select(page, 'מקור'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await selectAtOne(page); await page.getByRole('button', { name: 'פיצול בכל הגרסאות', exact: true }).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3); expect(state.saved()).toHaveLength(3);
  await select(page, '1:1'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2); expect(state.saved()).toHaveLength(2);
  await select(page, '9:16'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'ביטול פעולה', exact: true })).toBeEnabled();
  await expect(frame).toHaveAttribute('aria-valuenow', position!);
  await page.reload(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await select(page, '9:16'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(3); await expect(frame).toHaveAttribute('aria-valuenow', position!);
  await page.screenshot({ path: 'test-results/video-versions-desktop.png' });
});
test('mobile and tablet do not offer versions for a wide upload', async ({ page }) => {
  for (const width of [390, 800]) { await setup(page, width); await expect(page.getByRole('dialog', { name: 'רוצה ליצור גרסאות נוספות?' })).toHaveCount(0); await expect(page.getByRole('tablist', { name: 'גרסאות הסרטון' })).toHaveCount(0); }
});
test('unavailable browser storage never prevents continuing with the original', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await setup(page);
  await page.getByRole('button', { name: 'כן, צור גרסאות', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'המשך עם המקור', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
});
test('decline is remembered, creating later works, failed group save is atomic', async ({ page }) => {
  const state = await setup(page); await page.getByRole('button', { name: 'המשך עם המקור', exact: true }).click();
  await page.reload(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'יצירת גרסאות לרשתות' }).click();
  await selectAtOne(page); state.fail(true); await page.getByRole('button', { name: 'פיצול בכל הגרסאות', exact: true }).click();
  await expect(page.getByText('פיצול בכל הגרסאות נכשל. נסו שוב.').first()).toBeVisible();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2); expect(state.saved()).toHaveLength(2);
  state.fail(false); await select(page, '9:16'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
});
test('automatic analysis loads local model and reports no faces without pretending success', async ({ page }) => {
  test.setTimeout(90000); await setup(page); await create(page); await select(page, '9:16');
  await page.getByRole('switch', { name: 'התאמה אוטומטית' }).check();
  await expect(page.getByText('לא זוהו פנים למעקב. אפשר לבחור את האזור ידנית.')).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('switch', { name: 'התאמה אוטומטית' })).not.toBeChecked();
});
test('automatic face tracking follows motion, persists, and manual adjustment disables it', async ({ page }) => {
  // Derived from Google's public MediaPipe test asset:
  // https://storage.googleapis.com/mediapipe-assets/portrait.jpg
  const face = Buffer.from(readFileSync('tests/fixtures/tracking-face.base64', 'utf8'), 'base64');
  await setup(page, 1440, face); await create(page); await select(page, '9:16');
  const automatic = page.getByRole('switch', { name: 'התאמה אוטומטית' });
  await automatic.check(); await expect(automatic).toBeEnabled({ timeout: 60000 }); await expect(automatic).toBeChecked();
  const points = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.includes('video-versions:'))!;
    return JSON.parse(localStorage.getItem(key)!).crops.vertical.points;
  });
  expect(points.length).toBeGreaterThan(1); expect(points.at(-1).x).toBeGreaterThan(points[0].x + .1);
  await page.reload(); await select(page, '9:16'); await expect(automatic).toBeChecked();
  await page.getByTestId('video-crop-frame').focus(); await page.keyboard.press('ArrowLeft'); await expect(automatic).not.toBeChecked();
});
test('export includes the selected crop and caption dimensions, and switching to mobile restores original', async ({ page }) => {
  const state = await setup(page); await create(page); await select(page, '4:5');
  await page.getByTestId('video-crop-frame').focus(); await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  await page.getByRole('menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click();
  await expect.poll(() => state.burns.length).toBe(1);
  expect(state.burns[0]).toContain('"format":"portrait"');
  expect(state.burns[0]).toContain('"x":0.51');
  expect(state.burns[0]).toMatch(/name="videoWidth"\r\n\r\n288/);
  expect(state.burns[0]).toMatch(/name="videoHeight"\r\n\r\n360/);
  await page.getByRole('button', { name: 'אולי אחר כך', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('video-crop-frame')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('tab', { name: /מקור/ })).toHaveAttribute('aria-selected', 'true');
});
