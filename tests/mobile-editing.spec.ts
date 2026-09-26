import { test, expect, type Page, type Locator } from '@playwright/test';
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

async function dragBy(page: Page, control: Locator, pixels: number) {
  await control.scrollIntoViewIfNeeded();
  const rect = (await control.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + pixels, rect.y + rect.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('inline word timeline drags, retains failed changes, saves and undoes without a popup', async ({ page }) => {
  await openEditor(page);
  let failSave = true;
  const saves: any[] = [];
  await page.route('**/api/videos/update-subtitles', async route => {
    const body = route.request().postDataJSON();
    saves.push({ segments: JSON.parse(body.subtitleJson), words: JSON.parse(body.wordsJson) });
    await route.fulfill({ status: failSave ? 500 : 200, json: failSave ? { error: 'test failure' } : { success: true } });
  });
  const timeline = page.getByTestId('mobile-word-timeline');
  await expect(timeline).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'tmp/review/mobile-word-timeline-390.png' });
  await dragBy(page, timeline.getByRole('slider', { name: 'סיום המילה', exact: true }), -40);
  await expect(page.getByText('שמירת הכתובית נכשלה.', { exact: false })).toBeVisible();
  const first = timeline.getByTestId('mobile-word-clip').first();
  const shortenedEnd = Number(await first.getAttribute('data-end'));
  expect(shortenedEnd).toBeLessThan(1);
  expect(shortenedEnd).toBeGreaterThan(0);
  failSave = false;
  await page.getByRole('button', { name: 'שמירה חוזרת', exact: true }).click();
  await expect(page.getByText('שמירת הכתובית נכשלה.', { exact: false })).toHaveCount(0);
  expect(saves.at(-1).segments).toEqual(segments);
  expect(saves.at(-1).words.find((word: any) => word.word === 'שלום').end).toBe(shortenedEnd);
  expect(saves.at(-1).words.filter((word: any) => word.word !== 'שלום').map(({ word, start, end, segmentId }: any) => ({ word, start, end, segmentId }))).toEqual(words.slice(1));
  await dragBy(page, first, 130);
  await expect(first).toHaveAttribute('data-end', '1');
  expect(Number(await first.getAttribute('data-start'))).toBeCloseTo(1 - shortenedEnd);
  await expect(timeline.getByRole('button', { name: 'ביטול תזמון מילה', exact: true })).toBeEnabled();
  await timeline.getByRole('button', { name: 'ביטול תזמון מילה', exact: true }).click();
  await expect(first).toHaveAttribute('data-start', '0');
  await expect(first).toHaveAttribute('data-end', String(shortenedEnd));
  await timeline.getByRole('button', { name: 'ביטול תזמון מילה', exact: true }).click();
  await expect.poll(() => saves.at(-1).words.find((word: any) => word.word === 'שלום').end).toBe(1);
});

test('inline word timing follows edited text and stays within a narrow phone', async ({ page }) => {
  await openEditor(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route('**/api/videos/update-subtitles', route => route.fulfill({ json: { success: true } }));
  await page.getByRole('textbox', { name: 'טקסט המקטע' }).fill('שלום עולם חדש');
  const timeline = page.getByTestId('mobile-word-timeline');
  await expect(timeline.getByTestId('mobile-word-clip')).toHaveCount(3);
  await timeline.scrollIntoViewIfNeeded();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await timeline.getByRole('slider', { name: 'זום ציר המילים' }).focus();
  await page.keyboard.press('End');
  expect(await page.getByTestId('mobile-word-scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/review/mobile-word-timeline-320.png' });
});

test('word changes finish saving before switching captions', async ({ page }) => {
  await openEditor(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let saves = 0;
  await page.route('**/api/videos/update-subtitles', async route => { saves++; await pending; await route.fulfill({ json: { success: true } }); });
  await dragBy(page, page.getByRole('slider', { name: 'סיום המילה', exact: true }), -40);
  await expect.poll(() => saves).toBe(1);
  await page.getByRole('button', { name: 'המקטע הבא' }).click();
  await expect(page.getByRole('textbox', { name: 'טקסט המקטע' })).toHaveValue('שלום עולם');
  release();
  await expect(page.getByRole('textbox', { name: 'טקסט המקטע' })).toHaveValue('סרטון לבדיקה');
  expect(saves).toBe(1);
});

test('touch dragging resizes a word and pointer cancellation leaves it unchanged', async ({ page, context }) => {
  await openEditor(page);
  let saves = 0;
  await page.route('**/api/videos/update-subtitles', route => { saves++; return route.fulfill({ json: { success: true } }); });
  const handle = page.getByRole('slider', { name: 'סיום המילה', exact: true });
  await handle.scrollIntoViewIfNeeded();
  const rect = (await handle.boundingBox())!;
  const client = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', delta = 0) => client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: rect.x + rect.width / 2 + delta, y: rect.y + rect.height / 2 }] });
  await touch('touchStart'); await touch('touchMove', -45); await touch('touchCancel');
  await expect(page.getByTestId('mobile-word-clip').first()).toHaveAttribute('data-end', '1');
  expect(saves).toBe(0);
  await touch('touchStart'); await touch('touchMove', -45); await touch('touchEnd');
  await expect.poll(() => saves).toBe(1);
  expect(Number(await page.getByTestId('mobile-word-clip').first().getAttribute('data-end'))).toBeLessThan(1);
  await client.detach();
});

test('each timing card opens its own word timeline and saves without changing caption bounds', async ({ page }) => {
  await openEditor(page);
  const saves: any[] = [];
  await page.route('**/api/videos/update-subtitles', route => {
    const body = route.request().postDataJSON();
    saves.push({ segments: JSON.parse(body.subtitleJson), words: JSON.parse(body.wordsJson) });
    return route.fulfill({ json: { success: true } });
  });
  await page.getByRole('button', { name: 'תזמון', exact: true }).click();
  await expect(page.locator('[data-word-timing-button]')).toHaveCount(2);
  await page.getByRole('button', { name: 'תזמון מילים: שלום עולם', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'תזמון מילים בכתובית' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('mobile-word-clip')).toHaveCount(2);
  await expect(dialog.getByTestId('mobile-word-clip').first()).toHaveText('שלום');
  await expect(page.locator('.MuiDialog-container')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'tmp/review/timing-word-dialog-390.png' });
  await dragBy(page, dialog.getByRole('slider', { name: 'סיום המילה', exact: true }), -40);
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].segments).toEqual(segments);
  const firstEnd = saves[0].words.find((word: any) => word.word === 'שלום').end;
  expect(firstEnd).toBeLessThan(1);
  await dialog.getByRole('button', { name: 'סיום', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('mobile-timing-editor')).toBeVisible();
  await page.getByRole('button', { name: 'תזמון מילים: שלום עולם', exact: true }).click();
  await expect(dialog.getByTestId('mobile-word-clip').first()).toHaveAttribute('data-end', String(firstEnd));
  await dialog.getByRole('button', { name: 'סיום', exact: true }).click();
  await page.getByRole('button', { name: 'תזמון מילים: סרטון לבדיקה', exact: true }).click();
  await expect(dialog.getByTestId('mobile-word-clip').first()).toHaveText('סרטון');
  await expect(dialog.getByTestId('mobile-word-clip').first()).toHaveAttribute('data-start', '2');
  await dialog.getByRole('button', { name: 'סיום', exact: true }).click();
  await page.getByRole('button', { name: 'עריכה', exact: true }).click();
  await expect(page.getByTestId('mobile-word-timeline')).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('timing popup protects pending and failed saves and fits a narrow phone', async ({ page }) => {
  await openEditor(page);
  await page.setViewportSize({ width: 320, height: 568 });
  let fail = true, saves = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/videos/update-subtitles', async route => {
    saves++;
    await pending;
    await route.fulfill({ status: fail ? 500 : 200, json: fail ? { error: 'failure' } : { success: true } });
  });
  await page.getByRole('button', { name: 'תזמון', exact: true }).click();
  await page.getByRole('button', { name: 'תזמון מילים: שלום עולם', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'סיום', exact: true })).toBeInViewport();
  expect(await dialog.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
  await dragBy(page, dialog.getByRole('slider', { name: 'סיום המילה', exact: true }), -40);
  await expect.poll(() => saves).toBe(1);
  await expect(dialog.getByRole('button', { name: 'סיום', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog.getByRole('alert')).toContainText('שמירת התזמון נכשלה');
  const draftEnd = await dialog.getByTestId('mobile-word-clip').first().getAttribute('data-end');
  expect(Number(draftEnd)).toBeLessThan(1);
  fail = false;
  await dialog.getByRole('button', { name: 'שמירה חוזרת' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'סיום', exact: true })).toBeEnabled();
  await expect(dialog.getByTestId('mobile-word-clip').first()).toHaveAttribute('data-end', draftEnd!);
  await dialog.getByRole('button', { name: 'ביטול תזמון מילה', exact: true }).click();
  await expect(dialog.getByTestId('mobile-word-clip').first()).toHaveAttribute('data-end', '1');
  await page.screenshot({ path: 'tmp/review/timing-word-dialog-320.png' });
  await dialog.getByRole('button', { name: 'סיום', exact: true }).click();
});

test('caption audio preview plays from the cursor, pauses at the boundary and stops on close', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'תזמון', exact: true }).click();
  await page.getByRole('button', { name: 'תזמון מילים: שלום עולם', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await video.evaluate((v: HTMLVideoElement) => { v.muted = true; v.volume = 0; });
  await dialog.getByRole('button', { name: 'השמעת הכתובית', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'השהיה', exact: true })).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.15);
  expect(await video.evaluate((v: HTMLVideoElement) => !v.muted && v.volume > 0)).toBe(true);
  await dialog.getByRole('button', { name: 'השהיה', exact: true }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await dialog.getByRole('button', { name: 'עולם', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 1);
  await dialog.getByRole('button', { name: 'השמעת הכתובית', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.15);
  await expect(dialog.getByRole('button', { name: 'השמעת הכתובית', exact: true })).toBeVisible();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 2);
  await dialog.getByRole('button', { name: 'מההתחלה', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'השהיה', exact: true })).toBeVisible();
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(1);
  await dialog.getByRole('button', { name: 'סיום', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByRole('button', { name: 'תזמון מילים: סרטון לבדיקה', exact: true }).click();
  await dialog.getByRole('button', { name: 'מההתחלה', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(2.1);
  await dialog.getByRole('button', { name: 'לבדיקה', exact: true }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('caption audio preview reports playback failure and can retry', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'תזמון', exact: true }).click();
  await page.getByRole('button', { name: 'תזמון מילים: שלום עולם', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    const play = v.play.bind(v);
    v.play = () => { v.play = play; return Promise.reject(new DOMException('test rejection', 'NotAllowedError')); };
  });
  await dialog.getByRole('button', { name: 'השמעת הכתובית', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('לא ניתן להשמיע');
  await dialog.getByRole('button', { name: 'השמעת הכתובית', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'השהיה', exact: true })).toBeVisible();
});

for (const width of [320, 390]) test(`compact timeline zoom keeps video size and playback position at ${width}px`, async ({ page, context }) => {
  await openEditor(page);
  await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
  let saves = 0;
  await page.route('**/api/videos/update-subtitles', route => { saves++; return route.fulfill({ json: { success: true } }); });
  await page.getByRole('button', { name: 'תזמון', exact: true }).click();
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 1.25; });
  await expect(page.getByTestId('playhead-timecode')).toHaveText('00:00:01:06');
  const bounds = (await video.boundingBox())!;
  const editor = page.getByTestId('mobile-timing-editor');
  const zoom = editor.getByRole('slider', { name: 'זום ציר התזמון', exact: true });
  expect((await zoom.boundingBox())!.height).toBeLessThanOrEqual(24);
  const overview = editor.getByRole('slider', { name: 'מיקום בהקלטה', exact: true });
  const overviewBounds = (await overview.boundingBox())!;
  expect((await zoom.boundingBox())!.y).toBeGreaterThanOrEqual(overviewBounds.y + overviewBounds.height + 3);
  // Both controls must use the existing timeline allocation, not take height from the video.
  await overview.evaluate(el => { el.parentElement!.style.display = 'none'; });
  const withoutControls = (await video.boundingBox())!;
  await editor.getByRole('slider', { name: 'מיקום בהקלטה', exact: true, includeHidden: true }).evaluate(el => { el.parentElement!.style.removeProperty('display'); });
  expect(withoutControls.height).toBeCloseTo(bounds.height, 1);
  for (const fraction of [0, .5, 1]) {
    await overview.click({ position: { x: Math.max(1, fraction * (overviewBounds.width - 1)), y: 8 } });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(fraction * 4, 1);
    for (const indicator of await overview.locator(':scope > div').all()) {
      const box = (await indicator.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(overviewBounds.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(overviewBounds.x + overviewBounds.width + 1);
    }
  }
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 1.25; });
  await expect(page.getByTestId('playhead-timecode')).toHaveText('00:00:01:06');
  await zoom.focus();
  await page.keyboard.press('End');
  await expect(editor).toHaveAttribute('data-window-seconds', '0.50');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1.25, 2);
  await page.keyboard.press('Home');
  await expect(editor).toHaveAttribute('data-window-seconds', '4.00');
  // A real touch gesture on the thin rail should change zoom without seeking or editing captions.
  const client = await context.newCDPSession(page);
  const rect = (await zoom.boundingBox())!;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + 6, y: rect.y + rect.height / 2 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x + rect.width * .6, y: rect.y + rect.height / 2 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  await expect.poll(async () => Number(await editor.getAttribute('data-window-seconds'))).toBeLessThan(3);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1.25, 2);
  const after = (await video.boundingBox())!;
  expect(after.height).toBeCloseTo(bounds.height, 1);
  expect(after.width).toBeCloseTo(bounds.width, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: `tmp/review/timing-zoom-${width}.png` });
  await editor.getByRole('button', { name: 'התאמת זום לעריכה' }).click();
  await expect(editor.getByRole('button', { name: 'התאמת זום לעריכה' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'תזמון מילים: שלום עולם', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const wordZoom = dialog.getByRole('slider', { name: 'זום ציר המילים', exact: true });
  const track = dialog.getByTestId('mobile-word-track');
  const trackBefore = (await track.boundingBox())!;
  await wordZoom.focus();
  await page.keyboard.press('End');
  await expect(wordZoom).toHaveValue('4');
  expect((await track.boundingBox())!.width).toBeGreaterThan(trackBefore.width * 3);
  expect((await track.boundingBox())!.height).toBe(trackBefore.height);
  await page.keyboard.press('ArrowLeft');
  await expect(wordZoom).toHaveValue('3.99');
  expect(await dialog.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
  await expect(dialog.getByRole('button', { name: 'סיום', exact: true })).toBeInViewport();
  await page.screenshot({ path: `tmp/review/word-zoom-${width}.png` });
  expect(saves).toBe(0);
});
