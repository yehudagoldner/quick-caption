import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo } from './app-fixtures';

const segments = [
  { id: 1, start: .4, end: 1.2, text: 'שלום עולם' },
  { id: 2, start: 1.6, end: 2.4, text: 'עוד כתובית' },
  { id: 3, start: 3, end: 3.8, text: 'סיום סרטון' },
];
const words = segments.flatMap(s => s.text.split(' ').map((word, index) => ({ word, segmentId: s.id, start: s.start + index * .4, end: Math.min(s.end, s.start + (index + 1) * .4) })));
async function open(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepareApp(page);
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), portraitVideo.length - 1) : portraitVideo.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm',
      headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}) },
      body: portraitVideo.subarray(start, end + 1) });
  });
  await page.addInitScript(() => localStorage.setItem("caption-editor-preferences", JSON.stringify({ fps: 25 })));
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: segments, words_json: words, format: '.srt', stored_path: 'portrait.mp4' } } }));
  const saves: { segments: typeof segments; words: typeof words }[] = [];
  await page.route('**/api/videos/update-subtitles', async route => {
    const body = route.request().postDataJSON();
    saves.push({ segments: JSON.parse(body.subtitleJson), words: JSON.parse(body.wordsJson) });
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  return saves;
}
const selected = (page: Page) => page.locator('[data-testid="subtitle-clip"][aria-pressed="true"]');
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'פעולות בחירת כתוביות' });

test('Ctrl toggles, Shift selects a range; toolbar merges and keyboard undoes/redoes', async ({ page }) => {
  const saves = await open(page);
  const clips = page.getByTestId('subtitle-clip');
  await clips.first().click();
  await clips.nth(2).click({ modifiers: ['Control'] });
  await expect(selected(page)).toHaveCount(2);
  await expect(toolbar(page).getByRole('button', { name: 'חיבור כתוביות נבחרות' })).toBeDisabled();
  await clips.nth(2).click({ modifiers: ['Control'] });
  await expect(selected(page)).toHaveCount(1);
  await clips.first().click();
  await clips.nth(1).click({ modifiers: ['Shift'] });
  await expect(selected(page)).toHaveCount(2);
  await page.screenshot({ path: 'tmp/review/desktop-selection.png' });
  await toolbar(page).getByRole('button', { name: 'חיבור כתוביות נבחרות' }).click();
  await expect(clips).toHaveCount(2);
  expect(saves[0].segments[0]).toMatchObject({ start: .4, end: 2.4, text: 'שלום עולם עוד כתובית' });
  expect(saves[0].words.map(w => [w.start, w.end])).toEqual(words.map(w => [w.start, w.end]));
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(clips).toHaveCount(3);
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(clips).toHaveCount(2);
});

test('Delete and toolbar delete multiple captions; deleting all retains timeline and Undo', async ({ page }) => {
  await open(page);
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByTestId('subtitle-clip').nth(2).click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(1);
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  await page.keyboard.press('Control+a');
  await expect(selected(page)).toHaveCount(3);
  await toolbar(page).getByRole('button', { name: 'מחיקת כתוביות נבחרות' }).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(0);
  await expect(page.getByTestId('caption-track')).toBeVisible();
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
});

test('arrows and toolbar translate all selected words by whole frames and preserve selection', async ({ page }) => {
  const saves = await open(page);
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByTestId('subtitle-clip').nth(1).click({ modifiers: ['Control'] });
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => saves.length).toBe(1);
  await expect(selected(page)).toHaveCount(2);
  expect(saves[0].segments[0].start).toBeCloseTo(.44);
  expect(saves[0].segments[1].start).toBeCloseTo(1.64);
  expect(saves[0].words[0].start).toBeCloseTo(.44);
  expect(saves[0].words[2].start).toBeCloseTo(1.64);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1].segments[0].start).toBeCloseTo(.24);
  await toolbar(page).getByRole('button', { name: 'הזזת הבחירה פריים ימינה' }).click();
  await expect.poll(() => saves.length).toBe(3);
  expect(saves[2].segments[0].start).toBeCloseTo(.28);
  expect(saves[2].segments[2]).toEqual(segments[2]);
});

test('group mouse drag previews all clips, commits once, clamps at neighbours and cancels with Escape', async ({ page }) => {
  const saves = await open(page);
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByTestId('subtitle-clip').nth(1).click({ modifiers: ['Control'] });
  const rect = (await page.getByTestId('subtitle-clip').first().boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 70, rect.y + rect.height / 2, { steps: 8 });
  await expect.poll(async () => Number(await page.getByTestId('subtitle-clip').nth(1).getAttribute('data-start'))).toBeGreaterThan(1.6);
  expect(saves).toHaveLength(0);
  await page.mouse.up();
  await expect.poll(() => saves.length).toBe(1);
  const delta = saves[0].segments[0].start - .4;
  expect(delta).toBeGreaterThan(0);
  expect(saves[0].segments[1].start - 1.6).toBeCloseTo(delta);
  await expect(selected(page)).toHaveCount(2);
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('subtitle-clip').first()).toHaveAttribute('data-start', '0.4');
  const again = (await page.getByTestId('subtitle-clip').first().boundingBox())!;
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
  await page.mouse.down();
  await page.mouse.move(again.x + again.width / 2 + 90, again.y + again.height / 2, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('subtitle-clip').first()).toHaveAttribute('data-start', '0.4');
  expect(saves).toHaveLength(2);
});

test('shortcuts do not delete while typing or in a dialog and help is discoverable', async ({ page }) => {
  const saves = await open(page);
  await page.getByTestId('subtitle-clip').first().click();
  const input = page.getByRole('textbox', { name: 'טקסט המקטע' });
  await input.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  expect(saves).toHaveLength(0);
  await toolbar(page).getByRole('button', { name: 'קיצורי מקלדת' }).click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('failed group move rolls back and keeps selection for retry, with pending actions locked', async ({ page }) => {
  await open(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let fail = true;
  await page.route('**/api/videos/update-subtitles', async route => {
    await pending;
    await route.fulfill({ status: fail ? 500 : 200, json: fail ? { error: 'failure' } : { success: true } });
  });
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByTestId('subtitle-clip').nth(1).click({ modifiers: ['Control'] });
  await page.keyboard.press('ArrowRight');
  await expect(toolbar(page).getByRole('button', { name: 'מחיקת כתוביות נבחרות' })).toBeDisabled();
  release();
  await expect(page.getByTestId('subtitle-clip').first()).toHaveAttribute('data-start', '0.4');
  await expect(selected(page)).toHaveCount(2);
  fail = false;
  await toolbar(page).getByRole('button', { name: 'הזזת הבחירה פריים ימינה' }).click();
  await expect.poll(async () => Number(await page.getByTestId('subtitle-clip').first().getAttribute('data-start'))).toBeCloseTo(.44);
});

test('split, seek, zoom and playback shortcuts work on the main track and Cmd can select multiple', async ({ page }) => {
  const saves = await open(page);
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByTestId('subtitle-clip').nth(1).click({ modifiers: ['Meta'] });
  await expect(selected(page)).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(selected(page)).toHaveCount(0);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('playhead-timecode')).toHaveText('00:00:00:01');
  await page.keyboard.press('Equal');
  await expect(page.getByRole('slider', { name: 'זום ציר ראשי' })).toHaveValue('10');
  await page.keyboard.press('Control+0');
  await expect(page.getByRole('slider', { name: 'זום ציר ראשי' })).toHaveValue('0');
  await page.keyboard.press('Space');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.keyboard.press('Space');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = .88; v.dispatchEvent(new Event('timeupdate')); });
  await page.getByTestId('subtitle-clip').first().click();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(4);
  expect(saves.at(-1)!.segments[0].end).toBeCloseTo(.88);
  expect(saves.at(-1)!.segments[1].start).toBeCloseTo(.88);
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
});

test('failed delete and failed undo restore data and history so both can be retried', async ({ page }) => {
  await open(page);
  let fail = true;
  await page.route('**/api/videos/update-subtitles', route => route.fulfill({ status: fail ? 500 : 200, json: fail ? { error: 'failed' } : { success: true } }));
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByTestId('subtitle-clip').nth(1).click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await expect(selected(page)).toHaveCount(2);
  fail = false;
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(1);
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  fail = true;
  await page.keyboard.press('Control+z');
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(1);
  fail = false;
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await expect(toolbar(page).getByRole('button', { name: 'בחירת הכול' })).toBeEnabled();
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(1);
});
