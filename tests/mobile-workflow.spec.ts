import { test, expect } from '@playwright/test';
import { prepareApp, portraitVideo, testUid } from './app-fixtures';

test('oversized media is rejected before upload and exactly 500 MB can be selected', async ({ page }) => {
  await prepareApp(page);
  await page.addInitScript(() => {
    const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
    Object.defineProperty(File.prototype, 'size', { get() {
      return this.name === 'too-large.webm' ? 500_000_001 : this.name === 'boundary.webm' ? 500_000_000 : size.call(this);
    } });
  });
  let uploads = 0;
  await page.route('**/api/transcribe', route => { uploads++; return route.abort(); });
  await page.goto('/?screen=transcription');
  await expect(page.getByText('עד 500MB לקובץ.', { exact: false })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'too-large.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await expect(page.getByText('הקובץ גדול מדי.', { exact: false })).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  expect(uploads).toBe(0);
  await page.locator('input[type=file]').setInputFiles({ name: 'boundary.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await expect(page.locator('video')).toBeVisible();
  await expect(page.getByText('הקובץ גדול מדי.', { exact: false })).toHaveCount(0);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`upload fits ${viewport.width}px before selection, after selection, and while processing`, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit' && process.platform === 'win32', 'Windows WebKit cannot decode the media fixture; media layout is verified in Chromium.');
    await page.setViewportSize(viewport);
    await prepareApp(page);
    await page.goto('/?screen=transcription');
    await expect(page.getByTestId('media-dropzone')).toBeInViewport();
    await expect(page.getByRole('slider')).toHaveCount(0);
    const overflow = () => page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }));
    expect(await overflow()).toEqual({ x: 0, y: 0 });
    await page.locator('input[type=file]').setInputFiles({ name: 'portrait.webm', mimeType: 'video/webm', buffer: portraitVideo });
    await expect(page.locator('video')).toBeVisible();
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
    const slider = page.getByRole('slider', { name: 'מספר תווים בכתובית לפני תמלול' });
    const sliderTrack = slider.locator('..').locator('..');
    await expect(sliderTrack).toBeInViewport();
    const submit = page.getByRole('button', { name: 'שלחו לעיבוד' });
    expect((await submit.boundingBox())!.y).toBeLessThan((await sliderTrack.boundingBox())!.y);
    expect(await overflow()).toEqual({ x: 0, y: 0 });
    await slider.fill('7');
    let postedCharacters: string | undefined;
    await page.route('**/api/transcribe', async route => {
      postedCharacters = route.request().postData()?.match(/name="maxCharactersPerSubtitle"\r\n\r\n(\d+)/)?.[1];
      await route.abort('failed');
    });
    await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: { status: 'processing', stages: [{ stage: 'upload', status: 'done' }, { stage: 'correction', status: 'start' }] } }));
    await submit.click();
    await expect.poll(() => postedCharacters).toBe('7');
    await expect(page.getByRole('button', { name: 'חזרה לבחירת קובץ' })).toBeInViewport();
    await expect(page.getByText('100%', { exact: true })).toHaveCount(0);
    expect(await overflow()).toEqual({ x: 0, y: 0 });
    await page.screenshot({ path: `tmp/review/upload-processing-${viewport.width}.png` });
  });
}

test('mobile styles drawer keeps a large, interactive video and restores normal navigation', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit' && process.platform === 'win32', 'Windows WebKit cannot decode the media fixture; media layout is verified in Chromium.');
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);
  await page.goto('/?screen=edit&video=review-token');
  const editor = page.getByTestId('mobile-caption-editor');
  await expect(editor).toBeVisible();
  await expect.poll(() => editor.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'עיצוב', exact: true }).click();
  const drawer = page.getByRole('region', { name: 'עיצוב כתוביות' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS('transform', 'none');
  const fontSize = drawer.getByRole('combobox', { name: 'גודל פונט', exact: true });
  await expect(fontSize).toHaveText('105');
  const overlay = page.getByTestId('subtitle-overlay');
  const defaultSize = await overlay.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await fontSize.click();
  await page.getByRole('option', { name: '240', exact: true }).click();
  await expect(fontSize).toHaveText('240');
  await expect.poll(() => overlay.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(defaultSize * 240 / 105, 1);
  await fontSize.click();
  await page.getByRole('option', { name: '105', exact: true }).click();
  await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0);
  const rect = await page.getByTestId('media-stage').boundingBox();
  expect(rect!.height).toBeGreaterThan(280);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual((await drawer.boundingBox())!.y + 2);
  expect(await editor.locator('video').evaluate(video => {
    const rect = video.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + 20) === video;
  })).toBe(true);
  await page.screenshot({ path: 'tmp/review/editor-style.png' });
  await page.getByRole('button', { name: 'סגירת עיצוב' }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: 'לסרטונים שלי', exact: true }).click();
  await expect(page).toHaveURL(/screen=videos/);
});

test('leaving immediately after typing waits for the exact draft to save', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const saves: string[] = [];
  await page.route('**/api/videos/update-subtitles', async route => {
    saves.push(JSON.parse(route.request().postDataJSON().subtitleJson)[0].text);
    await pending;
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await page.getByRole('button', { name: 'עריכה', exact: true }).click();
  await page.getByRole('textbox', { name: 'טקסט המקטע' }).fill('טקסט שנשמר לפני יציאה');
  await page.getByRole('button', { name: 'לסרטונים שלי', exact: true }).click();
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  await expect(page).toHaveURL(/screen=edit/);
  release();
  await expect(page).toHaveURL(/screen=videos/);
  expect(saves.every(text => text === 'טקסט שנשמר לפני יציאה')).toBe(true);
});

test('a failed draft save retains the text and allows an explicit retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);
  let fail = true;
  await page.route('**/api/videos/update-subtitles', async route => {
    // Let the optimistic update render before its rollback, as on a slow mobile connection.
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ status: fail ? 500 : 200, json: fail ? { error: 'test save failure' } : { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await page.getByRole('button', { name: 'עריכה', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'טקסט המקטע' });
  await input.fill('טיוטה שחייבת להישאר');
  await page.getByRole('button', { name: 'לסרטונים שלי', exact: true }).click();
  await expect(page).toHaveURL(/screen=edit/);
  await expect(input).toHaveValue('טיוטה שחייבת להישאר');
  await expect(page.getByText('שמירת הכתובית נכשלה.', { exact: false })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'לסרטונים שלי', exact: true }).click();
  await expect(page).toHaveURL(/screen=videos/);
});

test('refresh recovers the actual processing stage', async ({ page }) => {
  await prepareApp(page);
  await page.addInitScript(uid => localStorage.setItem(`quickcaption:transcription-job:${uid}`, '11111111-1111-4111-8111-111111111111'), testUid);
  await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: { status: 'processing', stages: [{ stage: 'upload', status: 'done' }, { stage: 'timed-transcription', status: 'done' }, { stage: 'correction', status: 'start', message: 'restored-correction' }] } }));
  await page.goto('/?screen=transcription');
  await expect(page.getByText('restored-correction')).toBeVisible();
  await expect(page.getByText('תמלול מתוזמן').locator('..').locator('..')).toContainText('הושלם');
});


test('the arrow itself returns to videos after saving the draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);
  let savedText = '';
  await page.route('**/api/videos/update-subtitles', async route => {
    savedText = JSON.parse(route.request().postDataJSON().subtitleJson)[0].text;
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await page.getByRole('button', { name: 'עריכה', exact: true }).click();
  await page.getByRole('textbox', { name: 'טקסט המקטע' }).fill('נשמר דרך החץ');
  const arrow = page.getByTestId('my-videos-back-arrow');
  await arrow.click();
  await expect(page).toHaveURL(/screen=videos/);
  expect(savedText).toBe('נשמר דרך החץ');
});

test('mobile timing trims speech and adjacent captions, saves words and undoes together', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);
  const clips = [{ id: 1, start: 0, end: 2, text: 'שלום עולם' }, { id: 2, start: 2, end: 4, text: 'סרטון לבדיקה' }];
  const words = [{ word: 'שלום', start: 0, end: 1, segmentId: 1 }, { word: 'עולם', start: 1, end: 2, segmentId: 1 }, { word: 'סרטון', start: 2, end: 3, segmentId: 2 }, { word: 'לבדיקה', start: 3, end: 4, segmentId: 2 }];
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: clips, words_json: words, format: '.srt', stored_path: 'portrait.mp4' } } }));
  const saves: { clips: typeof clips; words: typeof words }[] = [];
  await page.route('**/api/videos/update-subtitles', route => {
    const body = route.request().postDataJSON();
    saves.push({ clips: JSON.parse(body.subtitleJson), words: JSON.parse(body.wordsJson) });
    return route.fulfill({ json: { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await page.getByRole('button', { name: 'תזמון', exact: true }).click();
  const timeline = page.getByTestId('mobile-timing-editor');
  const first = page.getByTestId('mobile-timing-clip').first();
  await first.click();
  // Seek near the edge so the handle stays inside the mobile viewport.
  const overview = page.getByRole('slider', { name: 'מיקום בהקלטה' });
  const overviewRect = (await overview.boundingBox())!;
  await overview.click({ position: { x: overviewRect.width / 2, y: overviewRect.height / 2 } });
  const dragEnd = async (delta: number) => {
    const handle = first.getByRole('slider', { name: 'הזזת סיום', exact: true });
    const rect = (await handle.boundingBox())!;
    const track = (await page.getByTestId('mobile-timing-track').boundingBox())!;
    const seconds = Number(await timeline.getAttribute('data-window-seconds'));
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + delta * track.width / seconds, rect.y + rect.height / 2, { steps: 12 });
    await page.mouse.up();
  };
  await dragEnd(-2);
  await expect.poll(() => saves.at(-1)?.clips[0].end).toBe(.5);
  expect(saves.at(-1)!.words[1].end).toBe(.5);
  await timeline.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect(first).toHaveAttribute('data-end', '2');
  await dragEnd(2);
  await expect.poll(() => saves.at(-1)?.clips[0].end).toBe(3.5);
  expect(saves.at(-1)!.clips[1].start).toBe(3.5);
  expect(saves.at(-1)!.words[2].start).toBe(3.5);
  await timeline.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => saves.at(-1)?.clips).toEqual(clips);
  expect(saves.at(-1)!.words.map(({ word, start, end, segmentId }) => ({ word, start, end, segmentId }))).toEqual(words);
});


test.describe('mobile word selection', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('a single tap highlights a word after fractional-time seeking settles', async ({ page }) => {
    await prepareApp(page);
    await page.addInitScript(() => localStorage.setItem('activeWordEnabled', 'true'));
    await page.route('**/api/videos/42/media?**', route => {
      const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), portraitVideo.length - 1) : portraitVideo.length - 1;
      return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm',
        headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}) },
        body: portraitVideo.subarray(start, end + 1) });
    });
    const clips = [{ id: 1, start: 0, end: 2, text: 'אז תודה רבה' }];
    const words = [
      { word: 'אז', start: 0, end: 7 / 9, segmentId: 1 },
      { word: 'תודה', start: 7 / 9, end: 4 / 3, segmentId: 1 },
      { word: 'רבה', start: 4 / 3, end: 2, segmentId: 1 },
    ];
    await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: clips, words_json: words, format: '.srt', stored_path: 'portrait.mp4' } } }));
    await page.goto('/?screen=edit&video=review-token');
    await page.getByRole('button', { name: 'עריכה', exact: true }).tap();
    const video = page.locator('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBe(4);
    const wordButtons = page.locator('[aria-label="מילים במקטע"]');
    for (const text of ['תודה', 'רבה', 'אז', 'רבה', 'תודה']) {
      await wordButtons.getByRole('button', { name: text, exact: true }).tap();
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
      await expect(page.locator('[data-active-word="true"]')).toHaveText(text);
      await expect(wordButtons.getByRole('button', { name: text, exact: true })).toHaveCSS('background-color', /rgb\((25, 118, 210|21, 101, 192)\)/);
      await expect(wordButtons.getByRole('button', { pressed: true })).toHaveText(text);
    }
  });
});
