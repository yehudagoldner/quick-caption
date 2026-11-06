import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo, segments } from './app-fixtures';
import { readFileSync } from 'node:fs';
import type { Word } from '../src/client/types';
const landscape = Buffer.from(readFileSync('tests/fixtures/landscape-video.base64', 'utf8'), 'base64');

async function setup(page: Page, width = 1440, versions = false, source?: { segments: typeof segments; words: Word[] }) {
  await page.setViewportSize({ width, height: 1000 }); await prepareApp(page);
  let saved = structuredClone(source?.segments ?? segments), words: Word[] = structuredClone(source?.words ?? []), fail = false;
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
const alignmentSource = {
  segments: [{ id: 1, start: 0, end: 2, text: 'אחת עוד סוף' }],
  words: [
    { word: 'אחת', start: 0, end: .6, segmentId: 1, wordIndex: 0, style: { offsetY: -1 } },
    { word: 'עוד', start: .6, end: 1.2, segmentId: 1, wordIndex: 1 },
    { word: 'סוף', start: 1.2, end: 2, segmentId: 1, wordIndex: 2, style: { offsetY: .5, fontScale: 1.25 } },
  ],
};
async function choose(page: Page, index = 0) {
  await page.getByTestId('caption-position').focus(); await page.keyboard.press('Enter');
  await word(page, index).click(); await expect(panel(page)).toBeVisible();
}

test('word dragging guides and snaps to the lowest other word, releases and persists the alignment', async ({ page }) => {
  const state = await setup(page, 1440, false, alignmentSource); await choose(page);
  const from = (await word(page, 0).boundingBox())!, target = (await word(page, 2).boundingBox())!;
  const x = from.x + from.width / 2, y = from.y + from.height / 2;
  const dy = target.y + target.height - from.y - from.height;
  const guide = page.getByTestId('word-alignment-guide');
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x - 10, y + dy - 4, { steps: 8 });
  await expect(guide).toHaveAttribute('data-snapped', 'true');
  const aligned = (await word(page, 0).boundingBox())!;
  expect(Math.abs(aligned.y + aligned.height - target.y - target.height)).toBeLessThan(1);
  expect(Math.abs((await guide.boundingBox())!.y - target.y - target.height)).toBeLessThan(1);
  await page.screenshot({ path: 'tmp/review/word-bottom-alignment.png' });
  await page.mouse.move(x - 10, y + dy + 18, { steps: 4 });
  await expect(guide).toHaveAttribute('data-snapped', 'false');
  await page.mouse.move(x - 10, y + dy + 3, { steps: 4 });
  await expect(guide).toHaveAttribute('data-snapped', 'true');
  await page.mouse.up(); await expect(guide).toHaveCount(0);
  await expect.poll(() => state.words()[0].style?.offsetY).toBeGreaterThan(0);
  expect(state.words()[2].style).toEqual(alignmentSource.words[2].style);
  await page.reload();
  await expect.poll(async () => {
    const restored = (await word(page, 0).boundingBox())!, unchanged = (await word(page, 2).boundingBox())!;
    return Math.abs(restored.y + restored.height - unchanged.y - unchanged.height);
  }).toBeLessThan(1);
});

test('word alignment follows the local bottom edge of a rotated caption', async ({ page }) => {
  await setup(page, 1440, false, { ...alignmentSource, segments: alignmentSource.segments.map(segment => ({ ...segment, style: { rotation: 90 } })) });
  await choose(page);
  const from = (await word(page, 0).boundingBox())!, target = (await word(page, 2).boundingBox())!;
  const x = from.x + from.width / 2, y = from.y + from.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + target.x - from.x + 3, y, { steps: 8 });
  const guide = page.getByTestId('word-alignment-guide');
  await expect(guide).toHaveAttribute('data-snapped', 'true');
  expect(Math.abs((await word(page, 0).boundingBox())!.x - target.x)).toBeLessThan(1);
  const line = (await guide.boundingBox())!;
  expect(line.height).toBeGreaterThan(line.width);
  await page.mouse.up(); await expect(guide).toHaveCount(0);
});

test('group alignment preserves relative word positions and offers no self-alignment when all words are selected', async ({ page }) => {
  const state = await setup(page, 1440, false, alignmentSource); await choose(page);
  await word(page, 1).click({ modifiers: ['Control'] });
  const first = (await word(page, 0).boundingBox())!, second = (await word(page, 1).boundingBox())!, target = (await word(page, 2).boundingBox())!;
  const x = second.x + second.width / 2, y = second.y + second.height / 2;
  const dy = target.y + target.height - second.y - second.height;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + dy - 3, { steps: 6 });
  await expect(page.getByTestId('word-alignment-guide')).toHaveAttribute('data-snapped', 'true');
  const movedFirst = (await word(page, 0).boundingBox())!, movedSecond = (await word(page, 1).boundingBox())!;
  expect(movedFirst.y - movedSecond.y).toBeCloseTo(first.y - second.y, 0);
  await page.mouse.up();
  await expect.poll(() => state.words()[1].style?.offsetY).toBeGreaterThan(0);
  await word(page, 2).click({ modifiers: ['Control'] });
  const all = structuredClone(state.words());
  const last = (await word(page, 2).boundingBox())!;
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2); await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2 - 15, { steps: 5 });
  await expect(page.getByTestId('word-alignment-guide')).toHaveCount(0);
  await word(page, 2).dispatchEvent('pointercancel'); await page.mouse.up();
  expect(state.words()).toEqual(all);
});

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

for (const placement of ['above frame', 'rotate', 'scale']) test(`a word outside the caption frame can be reselected and dragged again (${placement})`, async ({ page }) => {
  const state = await setup(page); await choose(page);
  const before = (await word(page, 0).boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  const handle = (await page.locator(`[data-caption-handle="${placement === 'scale' ? 'scale' : 'rotate'}"]`).first().boundingBox())!;
  const target = placement !== 'above frame' ? { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    : { x: before.x + before.width / 2, y: before.y + before.height / 2 - 100 };
  await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => state.words()[0]?.style?.offsetY).toBeLessThan(0);
  await panel(page).getByRole('button', { name: 'סיום עריכת מילים', exact: true }).click();
  const moved = (await word(page, 0).boundingBox())!;
  const frame = (await page.getByTestId('caption-selection-frame').boundingBox())!;
  expect(moved.y).toBeLessThan(frame.y);
  await word(page, 0).click({ timeout: 3000 });
  await expect(word(page, 0)).toHaveAttribute('aria-pressed', 'true');
  const offset = state.words()[0].style!.offsetY!;
  const selected = (await word(page, 0).boundingBox())!;
  await page.mouse.move(selected.x + selected.width / 2, selected.y + selected.height / 2);
  await page.mouse.down(); await page.mouse.move(selected.x + selected.width / 2, selected.y + selected.height / 2 + 20, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => state.words()[0].style!.offsetY!).toBeGreaterThan(offset);
});
