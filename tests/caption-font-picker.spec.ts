import { test, expect, type Page } from '@playwright/test';
import { CAPTION_FONTS } from '../src/captionFonts.js';
import { prepareApp, portraitVideo, segments, testUid } from './app-fixtures';

async function setup(page: Page, mobile = false) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 });
  await prepareApp(page);
  await page.route('**/src/client/api.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `\nsetApiUser({ uid: '${testUid}', getIdToken: async () => 'font-fixture-token' });` });
  });
  const burns: string[] = [];
  await page.route('**/api/burn-subtitles', route => {
    burns.push(route.request().postDataBuffer()!.toString());
    return route.fulfill({ contentType: 'video/webm', headers: { 'Content-Disposition': 'attachment; filename="fixture.webm"' }, body: portraitVideo });
  });
  return burns;
}

async function selectFont(page: Page, name: string, mobile = false) {
  await page.getByRole('button', { name: mobile ? 'עיצוב' : 'פונט', exact: true }).click();
  await page.getByRole('combobox', { name: 'סוג פונט', exact: true }).fill(name);
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByText('טוען פונט...', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('caption-font-sample')).toHaveCSS('font-family', `"QC Caption ${name}"`);
  if (mobile) await page.getByRole('button', { name: 'סגירת עיצוב', exact: true }).click();
  else await page.keyboard.press('Escape');
}

async function burn(page: Page, mobile = false) {
  await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole(mobile ? 'button' : 'menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click();
  await download;
}

test('all bundled Hebrew faces load in Chromium; initial editor loads only the default face', async ({ page }) => {
  test.setTimeout(90000);
  await setup(page);
  const requested: string[] = [];
  page.on('request', request => { if (/\/fonts\/.*\.ttf/.test(request.url())) requested.push(request.url()); });
  await page.goto('/?screen=edit&video=review-token');
  await expect(page.getByTestId('caption-track')).toBeVisible();
  await expect(page.getByText('טוען פונט...', { exact: true })).toBeHidden();
  expect(requested.every(url => url.endsWith('/Assistant-SemiBold.ttf'))).toBe(true);
  const loaded = await page.evaluate(async fonts => Promise.all(fonts.map(async font => {
    const faces = await document.fonts.load(`${font.weight} 32px "${font.cssFamily}"`, 'שלום עולם ABC 123?!');
    return { id: font.id, loaded: faces.length > 0 && faces.every(face => face.status === 'loaded') };
  })), CAPTION_FONTS);
  expect(loaded.filter(font => !font.loaded)).toEqual([]);
  // Exercise switching fonts, rather than only verifying that the assets exist.
  // A stale width measurement or a shared em ratio can clip the live captions.
  await page.getByRole('button', { name: 'פונט', exact: true }).click();
  for (const font of CAPTION_FONTS) {
    await page.getByRole('combobox', { name: 'סוג פונט', exact: true }).click();
    await page.getByRole('combobox', { name: 'סוג פונט', exact: true }).fill(font.label);
    await page.getByRole('option', { name: font.label, exact: true }).click();
    await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('font-family', `"${font.cssFamily}", Assistant, sans-serif`);
    await expect.poll(() => page.getByTestId('subtitle-overlay').evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const textWidth = range.getBoundingClientRect().width;
      return textWidth > 0 && textWidth <= element.getBoundingClientRect().width + 1;
    })).toBe(true);
  }
});

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} font choice changes preview, is sent to burning and persists`, async ({ page }) => {
    const burns = await setup(page, mobile);
    await page.goto('/?screen=edit&video=review-token');
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
    await selectFont(page, 'Rubik', mobile);
    await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('font-family', '"QC Caption Rubik", Assistant, sans-serif');
    await burn(page, mobile);
    expect(burns[0]).toMatch(/name="fontId"\r\n\r\nrubik\r\n/);
    await selectFont(page, 'Heebo', mobile);
    await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
    await expect(page.getByText('הורד סרטון צרוב מוכן', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await burn(page, mobile);
    expect(burns[1]).toMatch(/name="fontId"\r\n\r\nheebo\r\n/);
    await page.reload();
    await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('font-family', '"QC Caption Heebo", Assistant, sans-serif');
    await page.getByRole('button', { name: mobile ? 'עיצוב' : 'פונט', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'סוג פונט', exact: true })).toHaveValue('Heebo');
    await page.getByRole('combobox', { name: 'סוג פונט', exact: true }).click();
    await page.screenshot({ path: `tmp/font-library/${mobile ? 'mobile' : 'desktop'}-picker.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('new transcription also sends the selected font to burning', async ({ page }) => {
  const burns = await setup(page);
  await page.route('**/api/transcribe', route => route.fulfill({ json: { text: 'שלום עולם', segments, words: [], subtitle: { format: '.srt', content: 'test' } } }));
  await page.goto('/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: 'new.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await page.getByRole('button', { name: 'שלחו לעיבוד', exact: true }).click();
  await selectFont(page, 'Secular One');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  await burn(page);
  expect(burns[0]).toMatch(/name="fontId"\r\n\r\nsecularone\r\n/);
});

test('failed font loading is visible and blocks burning with a substituted face', async ({ page }) => {
  await setup(page);
  await page.route('**/fonts/heebo.ttf', route => route.abort());
  await page.goto('/?screen=edit&video=review-token');
  await page.getByRole('button', { name: 'פונט', exact: true }).click();
  await page.getByRole('combobox', { name: 'סוג פונט', exact: true }).fill('Heebo');
  await page.getByRole('option', { name: 'Heebo', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'טעינת הפונט נכשלה' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'ממתינים לטעינת הפונט', exact: true })).toBeDisabled();
});
