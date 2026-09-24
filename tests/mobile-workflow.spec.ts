import { test, expect } from '@playwright/test';
import { prepareApp, portraitVideo, testUid } from './app-fixtures';

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
