import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo } from './app-fixtures';

const segments = [
  { id: 1, start: .4, end: 1.2, text: 'שלום עולם' },
  { id: 2, start: 1.6, end: 2.4, text: 'עוד כתובית' },
  { id: 3, start: 3, end: 3.8, text: 'סיום סרטון' },
];
const words = segments.flatMap(s => s.text.split(' ').map((word, index) => ({ word, segmentId: s.id, start: s.start + index * .4, end: Math.min(s.end, s.start + (index + 1) * .4) })));
async function open(page: Page, loadedSegments = segments, loadedWords = words) {
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
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: loadedSegments, words_json: loadedWords, format: '.srt', stored_path: 'portrait.mp4' } } }));
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

test('Up jumps to the selected caption end and Down to its exact start without changing data', async ({ page }) => {
  const preciseSegments = segments.map((segment, i) => i === 0 ? { ...segment, start: .413, end: 1.237 } : segment);
  const preciseWords = words.map(word => word.segmentId === 1 ? { ...word, start: Math.max(word.start, .413) } : word);
  const saves = await open(page, preciseSegments, preciseWords);
  for (const index of [0, 2, 1]) {
    const clip = page.getByTestId('subtitle-clip').nth(index);
    await clip.click();
    for (const [key, time] of [['ArrowUp', preciseSegments[index].end], ['ArrowDown', preciseSegments[index].start]] as const) {
      await page.keyboard.press(key);
      await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(time, 3);
      await expect(clip).toHaveAttribute('aria-pressed', 'true');
      expect(Number(await clip.getAttribute('data-start'))).toBeCloseTo(preciseSegments[index].start, 6);
      expect(Number(await clip.getAttribute('data-end'))).toBeCloseTo(preciseSegments[index].end, 6);
    }
  }
  expect(saves).toHaveLength(0);
});

test('caption boundary shortcuts work from the word track and preserve multiple word selections', async ({ page }) => {
  const saves = await open(page);
  await page.getByTestId('subtitle-clip').nth(1).click();
  await page.getByRole('button', { name: 'מילה אקטיבית', exact: true }).click();
  const words = page.getByTestId('word-clip');
  await words.first().click();
  await words.last().click({ modifiers: ['Control'] });
  for (const [key, time] of [['ArrowUp', 2.4], ['ArrowDown', 1.6]] as const) {
    await page.keyboard.press(key);
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(time, 3);
    await expect(page.locator('[data-testid="word-clip"][aria-pressed="true"]')).toHaveCount(2);
    await expect(page.getByTestId('subtitle-clip').nth(1)).toHaveAttribute('aria-pressed', 'true');
  }
  expect(saves).toHaveLength(0);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  expect(saves[0].segments).toEqual([segments[0], segments[2]]);
});

test('boundary shortcuts respect fields, dialogs, sliders, modifiers and absent or multiple caption selection', async ({ page }) => {
  const saves = await open(page);
  await page.getByTestId('subtitle-clip').first().click();
  await page.keyboard.press('ArrowDown');
  const currentTime = () => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime);
  await expect.poll(currentTime).toBeCloseTo(.4, 3);
  await page.getByRole('textbox', { name: 'טקסט המקטע' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(currentTime).toBeCloseTo(.4, 3);
  await page.getByRole('slider', { name: 'זום ציר ראשי' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('slider', { name: 'זום ציר ראשי' })).toHaveValue('1');
  await expect.poll(currentTime).toBeCloseTo(.4, 3);
  await page.getByRole('button', { name: 'סרטון חדש', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(currentTime).toBeCloseTo(.4, 3);
  await toolbar(page).getByRole('button', { name: 'קיצורי מקלדת' }).click();
  await expect(page.getByRole('dialog').getByText('מעבר לסוף / לתחילת הכתובית הנבחרת', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect.poll(currentTime).toBeCloseTo(.4, 3);
  await page.keyboard.press('Escape');
  await page.getByTestId('subtitle-clip').first().click();
  for (const modifier of ['Control', 'Meta', 'Alt', 'Shift']) {
    await page.keyboard.press(`${modifier}+ArrowUp`);
    await expect.poll(currentTime).toBeCloseTo(.4, 3);
  }
  await page.getByTestId('subtitle-clip').nth(1).click({ modifiers: ['Control'] });
  await page.keyboard.press('ArrowUp');
  await expect.poll(currentTime).toBeCloseTo(.4, 3);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowUp');
  await expect.poll(currentTime).toBeCloseTo(.4, 3);
  expect(saves).toHaveLength(0);
});

async function trackPoint(page: Page, time: number, y: number) {
  const track = (await page.getByTestId('caption-track').boundingBox())!;
  const clip = (await page.getByTestId('subtitle-clip').first().boundingBox())!;
  const scroll = await page.getByTestId('caption-track').locator('.timeline-editor-edit-area .ReactVirtualized__Grid').evaluate(el => el.scrollLeft);
  const pixelsPerSecond = clip.width / (segments[0].end - segments[0].start);
  return { x: track.x + 20 + time * pixelsPerSecond - scroll, y: track.y + y };
}

test('every empty timeline surface seeks without changing caption selection or data', async ({ page }) => {
  const saves = await open(page);
  await page.getByTestId('subtitle-clip').nth(2).click();
  const cases = [{ time: 1.4, y: 54 }, { time: 2.76, y: 54 }, { time: .2, y: 37 }, { time: 3.4, y: 84 }, { time: 1.4, y: 8 }];
  for (const point of cases) {
    const position = await trackPoint(page, point.time, point.y);
    await page.mouse.click(position.x, position.y);
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(point.time, 2);
    await expect(selected(page)).toHaveCount(1);
    await expect(page.getByTestId('subtitle-clip').nth(2)).toHaveAttribute('aria-pressed', 'true');
  }
  expect(saves).toHaveLength(0);
});

test('the playhead drags continuously from every height, including over a caption', async ({ page }) => {
  const saves = await open(page);
  for (const y of [8, 37, 54, 84]) {
    const initial = await trackPoint(page, .88, 84);
    await page.mouse.click(initial.x, initial.y);
    const start = await trackPoint(page, .88, y);
    const end = await trackPoint(page, 2.76, y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    // Assert before release: the playhead must scrub, not only seek on click-up.
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2.76, 2);
    await page.mouse.up();
    await expect(page.getByTestId('playhead-timecode')).toHaveText('00:00:02:19');
    await expect(selected(page)).toHaveCount(0);
  }
  expect(saves).toHaveLength(0);
  await expect(page.getByTestId('subtitle-clip').first()).toHaveAttribute('data-start', '0.4');
});

test('scrubbing captures the pointer outside the track and clamps at recording boundaries', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  const saves = await open(page);
  const initial = await trackPoint(page, 1.4, 54);
  await page.mouse.move(initial.x, initial.y);
  await page.mouse.down();
  const track = (await page.getByTestId('caption-track').boundingBox())!;
  await page.mouse.move(track.x + track.width + 100, track.y - 50, { steps: 8 });
  const duration = await page.locator('video').evaluate((v: HTMLVideoElement) => v.duration);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(duration, 2);
  await page.mouse.move(0, track.y - 50, { steps: 8 });
  await expect(page.getByTestId('playhead-timecode')).toHaveText('00:00:00:00');
  await page.mouse.up();
  expect(saves).toHaveLength(0);
  expect(errors).toHaveLength(0);
});

test('word-track empty space seeks absolute media time and its cursor drags over words', async ({ page }) => {
  const saves = await open(page);
  await page.getByTestId('subtitle-clip').nth(1).click();
  await page.getByRole('button', { name: 'מילה אקטיבית', exact: true }).click();
  const track = page.getByTestId('word-track');
  await expect(track).toBeVisible();
  const rect = (await track.boundingBox())!;
  const zoom = Number(await page.getByRole('slider', { name: 'זום מילים' }).inputValue());
  await page.mouse.click(rect.x + 20 + .24 * zoom, rect.y + rect.height - 4);
  await expect(page.getByTestId('playhead-timecode')).toHaveText('00:00:01:21');
  await page.mouse.move(rect.x + 20 + .24 * zoom, rect.y + 54);
  await page.mouse.down();
  await page.mouse.move(rect.x + 20 + .68 * zoom, rect.y + 8, { steps: 8 });
  await expect(page.getByTestId('playhead-timecode')).toHaveText('00:00:02:07');
  await page.mouse.up();
  await expect(page.getByTestId('subtitle-clip').nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(saves).toHaveLength(0);
  await page.screenshot({ path: 'tmp/review/timeline-scrubbing.png' });
});

test('zoomed long-track scrubbing scrolls at the edge and seeks correctly after scrolling', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/tests/editor-harness.html');
  await page.getByRole('button', { name: 'בדיקת ציר ארוך — 90 שניות', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((a: HTMLVideoElement) => a.readyState)).toBeGreaterThan(0);
  const track = page.getByTestId('caption-track');
  await track.scrollIntoViewIfNeeded();
  const rect = (await track.boundingBox())!;
  const clip = (await page.getByTestId('subtitle-clip').first().boundingBox())!;
  const pixelsPerSecond = clip.width / 3;
  const grid = track.locator('.timeline-editor-edit-area .ReactVirtualized__Grid');
  await page.mouse.move(rect.x + 20 + 10 * pixelsPerSecond, rect.y + rect.height - 5);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 8, rect.y + rect.height - 5, { steps: 8 });
  await expect.poll(() => page.locator('video').evaluate((a: HTMLVideoElement) => a.currentTime)).toBeGreaterThan(32);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 8);
  await page.mouse.up();
  const scroll = await grid.evaluate(el => el.scrollLeft);
  expect(scroll).toBeGreaterThan(0);
  const x = rect.width / 3;
  const expected = Math.round(((scroll + x - 20) / pixelsPerSecond) * 24) / 24;
  await page.mouse.click(rect.x + x, rect.y + 37);
  await expect.poll(() => page.locator('video').evaluate((a: HTMLVideoElement) => a.currentTime)).toBeCloseTo(expected, 2);
  expect(errors).toHaveLength(0);
  await expect(page.getByTestId('save-count')).toHaveText('שמירות בדיקה: 0');
});

test('desktop blank space clears multiple selected captions without saving or affecting controls', async ({ page }) => {
  const saves = await open(page);
  const clips = page.getByTestId('subtitle-clip');
  const chooseTwo = async () => {
    await clips.first().click();
    await clips.nth(1).click({ modifiers: ['Control'] });
    await expect(selected(page)).toHaveCount(2);
  };
  await chooseTwo();
  await page.getByRole('button', { name: 'הצג עורך', exact: true }).click();
  await expect(selected(page)).toHaveCount(2);
  const editor = (await page.getByTestId('desktop-caption-editor').boundingBox())!;
  await page.mouse.click(editor.x + 20, editor.y + 160);
  await expect(selected(page)).toHaveCount(0);
  await chooseTwo();
  const position = await trackPoint(page, 1.4, 54);
  await page.mouse.click(position.x, position.y);
  await expect(selected(page)).toHaveCount(0);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(1.4, 2);
  expect(saves).toHaveLength(0);
});

test('desktop Escape clears selection outside the track and lets a dialog close first', async ({ page }) => {
  const saves = await open(page);
  const clips = page.getByTestId('subtitle-clip');
  await clips.first().click();
  await clips.nth(1).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'הגדרות כתוביות', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'הגדרות כתוביות' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'הגדרות כתוביות' })).toBeHidden();
  await expect(selected(page)).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(selected(page)).toHaveCount(0);
  await clips.first().click();
  await clips.nth(1).click({ modifiers: ['Control'] });
  await page.getByRole('slider', { name: 'מיקום בהקלטה', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(selected(page)).toHaveCount(0);
  expect(saves).toHaveLength(0);
});

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
  const emptyTrackPoint = await trackPoint(page, 1.4, 54);
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
  await page.mouse.click(emptyTrackPoint.x, emptyTrackPoint.y);
  await expect(page.getByTestId('playhead-timecode')).toHaveText('00:00:01:10');
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
  // The request is observed before the editor finishes unlocking its actions.
  await expect(toolbar(page).getByRole('button', { name: 'הזזת הבחירה פריים ימינה' })).toBeEnabled();
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
