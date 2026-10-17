import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo, segments } from './app-fixtures';
import { readFileSync } from 'node:fs';
import type { Word } from '../src/client/types';
const landscape = Buffer.from(readFileSync('tests/fixtures/landscape-video.base64', 'utf8'), 'base64');

async function setup(page: Page, width = 1440, versions = false) {
  await page.setViewportSize({ width, height: 1000 }); await prepareApp(page);
  let saved = structuredClone(segments), words: Word[] = [], fail = false;
  const burns: string[] = []; const media = versions ? landscape : portraitVideo;
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: saved, words_json: words, format: '.srt', stored_path: 'fixture.mp4' } } }));
  await page.route(/\/api\/videos\/(?:42\/subtitles|update-subtitles)$/, route => {
    if (fail) return route.fulfill({ status: 500, json: { error: 'fixture failure' } });
    saved = JSON.parse(route.request().postDataJSON().subtitleJson); words = JSON.parse(route.request().postDataJSON().wordsJson ?? '[]');
    return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/burn-subtitles', route => { burns.push(route.request().postDataBuffer()!.toString()); return route.fulfill({ contentType: 'video/webm', body: media }); });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  return { words: () => words, fail: (value: boolean) => { fail = value; }, burns };
}
const panel = (page: Page) => page.getByRole('region', { name: 'עיצוב מילים נבחרות', exact: true });
const word = (page: Page, index: number) => page.getByTestId('subtitle-overlay').locator(`[data-word-index="${index}"]`);
async function choose(page: Page, index = 0) {
  await page.getByTestId('caption-position').focus(); await page.keyboard.press('Enter');
  await word(page, index).click(); await expect(panel(page)).toBeVisible();
}

test('desktop word styles save, multi-select, undo/redo, reload, burn and reset', async ({ page }) => {
  const state = await setup(page); await choose(page);
  await panel(page).getByRole('button', { name: 'צבע המילים: #ff3b30', exact: true }).click();
  await expect.poll(() => state.words()[0]?.style?.fontColor).toBe('#ff3b30');
  await expect(word(page, 0)).toHaveCSS('color', 'rgb(255, 59, 48)');
  await expect(word(page, 1)).toHaveCSS('color', 'rgb(255, 255, 255)');
  await word(page, 1).click({ modifiers: ['Control'] });
  await panel(page).getByRole('button', { name: 'מודגש', exact: true }).click();
  await expect.poll(() => state.words().slice(0, 2).every(w => w.style?.bold)).toBe(true);
  await panel(page).getByRole('combobox', { name: 'גודל המילים' }).click();
  await page.getByRole('option', { name: '150%', exact: true }).click();
  await expect.poll(() => state.words().slice(0, 2).every(w => w.style?.fontScale === 1.5)).toBe(true);
  await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => state.words()[0].style?.fontScale).toBeUndefined();
  await page.getByRole('button', { name: 'ביצוע חוזר', exact: true }).click();
  await expect.poll(() => state.words()[0].style?.fontScale).toBe(1.5);
  await page.screenshot({ path: 'test-results/word-appearance-desktop.png' });
  await page.reload(); await expect(word(page, 0)).toHaveCSS('color', 'rgb(255, 59, 48)');
  await expect(word(page, 0)).toHaveCSS('font-weight', '900');
  await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click(); await download;
  expect(state.burns[0]).toContain('"fontScale":1.5');
  await page.getByRole('button', { name: 'אולי אחר כך', exact: true }).click();
  await choose(page); await panel(page).getByRole('button', { name: 'איפוס לעיצוב הכתובית' }).click();
  await expect.poll(() => state.words()[0].style).toBeUndefined();
  expect(state.words()[1].style?.bold).toBe(true);
});

test('failed word save rolls back and can retry', async ({ page }) => {
  const state = await setup(page); await choose(page); state.fail(true);
  await panel(page).getByRole('button', { name: 'צבע המילים: #ff3b30', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toBeVisible();
  await expect(word(page, 0)).toHaveCSS('color', 'rgb(255, 255, 255)');
  state.fail(false); await panel(page).getByRole('button', { name: 'נסו שוב' }).click();
  await expect.poll(() => state.words()[0]?.style?.fontColor).toBe('#ff3b30');
});

test('word styling stays in one version after shared text correction and reload', async ({ page }) => {
  await setup(page, 1440, true); await page.getByRole('button', { name: 'כן, צור גרסאות', exact: true }).click();
  await page.getByRole('tab', { name: /9:16/ }).click(); await choose(page);
  await panel(page).getByRole('button', { name: 'צבע המילים: #ff3b30', exact: true }).click();
  await expect(word(page, 0)).toHaveCSS('color', 'rgb(255, 59, 48)');
  await page.getByRole('tab', { name: /מקור/ }).click(); await expect(word(page, 0)).toHaveCSS('color', 'rgb(255, 255, 255)');
  const text = page.getByRole('textbox', { name: 'טקסט הכתובית', exact: true }).first();
  await text.fill('שלומות עולם'); await text.blur();
  await page.getByRole('tab', { name: /9:16/ }).click();
  await expect(word(page, 0)).toHaveText('שלומות'); await expect(word(page, 0)).toHaveCSS('color', 'rgb(255, 59, 48)');
  await page.reload(); await page.getByRole('tab', { name: /9:16/ }).click();
  await expect(word(page, 0)).toHaveCSS('color', 'rgb(255, 59, 48)');
});

test('word appearance controls are desktop only and keyboard accessible', async ({ page }) => {
  await setup(page, 900); await choose(page);
  await word(page, 1).focus(); await page.keyboard.press('Control+Enter');
  await expect(word(page, 0)).toHaveAttribute('aria-pressed', 'true'); await expect(word(page, 1)).toHaveAttribute('aria-pressed', 'true');
  const bounds = (await panel(page).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
  await page.setViewportSize({ width: 800, height: 1000 }); await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('[data-word-editable]')).toHaveCount(0);
});

test('selected word drags independently, saves, undoes, reloads and resets position only', async ({ page }) => {
  const state = await setup(page); await choose(page);
  await panel(page).getByRole('button', { name: 'צבע המילים: #ff3b30', exact: true }).click();
  await expect.poll(() => state.words()[0]?.style?.fontColor).toBe('#ff3b30');
  const before = (await word(page, 0).boundingBox())!, neighbor = (await word(page, 1).boundingBox())!;
  const x = before.x + before.width / 2, y = before.y + before.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 35, y - 55, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => state.words()[0]?.style?.offsetY).toBeLessThan(0);
  const after = (await word(page, 0).boundingBox())!, still = (await word(page, 1).boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(-35, 0); expect(after.y - before.y).toBeCloseTo(-55, 0);
  expect(still.x).toBeCloseTo(neighbor.x, 1); expect(still.y).toBeCloseTo(neighbor.y, 1);
  expect(state.words()[1].style).toBeUndefined();
  const position = state.words()[0].style;
  await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => state.words()[0]?.style?.offsetY).toBeUndefined();
  await page.getByRole('button', { name: 'ביצוע חוזר', exact: true }).click();
  await expect.poll(() => state.words()[0]?.style).toEqual(position);
  await page.reload(); await expect.poll(async () => (await word(page, 0).boundingBox())!.y).toBeCloseTo(after.y, 0);
  await choose(page); await page.screenshot({ path: 'test-results/word-drag-desktop.png' });
  await panel(page).getByRole('button', { name: 'איפוס מיקום', exact: true }).click();
  await expect.poll(() => state.words()[0]?.style).toEqual({ fontColor: '#ff3b30' });
});

test('cropped rotated caption supports word dragging, rollback and version isolation', async ({ page }) => {
  const state = await setup(page, 1440, true);
  await page.getByRole('button', { name: 'כן, צור גרסאות', exact: true }).click();
  await page.getByRole('tab', { name: /9:16/ }).click(); await choose(page);
  const appearance = page.getByRole('region', { name: 'עיצוב כתובית נבחרת', exact: true });
  await appearance.getByRole('tab', { name: 'מיקום', exact: true }).click();
  await appearance.getByRole('slider', { name: 'סיבוב', exact: true }).fill('30');
  await expect(panel(page).getByRole('button', { name: 'מודגש', exact: true })).toBeEnabled();
  const before = (await word(page, 0).boundingBox())!, neighbor = (await word(page, 1).boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 15, before.y + before.height / 2 - 25, { steps: 6 }); await page.mouse.up();
  await expect(panel(page).getByRole('button', { name: 'איפוס מיקום', exact: true })).toBeEnabled();
  const after = (await word(page, 0).boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(-15, 0); expect(after.y - before.y).toBeCloseTo(-25, 0);
  expect((await word(page, 1).boundingBox())!.x).toBeCloseTo(neighbor.x, 1);
  await page.getByRole('tab', { name: /מקור/ }).click(); await choose(page);
  await expect(panel(page).getByRole('button', { name: 'איפוס מיקום', exact: true })).toBeDisabled();
  state.fail(true);
  const original = (await word(page, 0).boundingBox())!;
  const originalNeighbor = (await word(page, 1).boundingBox())!;
  await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2); await page.mouse.down();
  await page.mouse.move(original.x + original.width / 2 - 10, original.y + original.height / 2 - 20, { steps: 5 }); await page.mouse.up();
  await expect(page.getByText('הזזת המילה לא נשמרה. אפשר לנסות שוב.')).toBeVisible();
  // The save error banner shifts the editor; compare against its neighbor.
  expect((await word(page, 0).boundingBox())!.y - (await word(page, 1).boundingBox())!.y).toBeCloseTo(original.y - originalNeighbor.y, 0);
  state.fail(false); await page.getByRole('alert').filter({ hasText: 'הזזת המילה' }).getByRole('button', { name: 'נסו שוב' }).click();
  await expect.poll(() => state.words()[0]?.style?.offsetY).toBeLessThan(0);
});
