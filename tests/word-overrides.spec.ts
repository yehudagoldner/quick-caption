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
