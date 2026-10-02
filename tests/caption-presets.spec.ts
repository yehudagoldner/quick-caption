import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { CAPTION_PRESETS } from '../src/captionPresets.js';
import { getCaptionFont } from '../src/captionFonts.js';
import { prepareApp, portraitVideo, testUid } from './app-fixtures';

async function setup(page: Page, mobile = false) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 });
  await prepareApp(page);
  await page.route('**/src/client/api.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `\nsetApiUser({ uid: '${testUid}', getIdToken: async () => 'style-fixture-token' });` });
  });
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), portraitVideo.length - 1) : portraitVideo.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}) }, body: portraitVideo.subarray(start, end + 1) });
  });
  const burns: string[] = [];
  await page.route('**/api/burn-subtitles', route => { burns.push(route.request().postDataBuffer()!.toString()); return route.fulfill({ contentType: 'video/webm', body: portraitVideo }); });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  return burns;
}
async function open(page: Page, mobile: boolean) {
  await page.getByRole('button', { name: mobile ? 'עיצוב' : 'סגנונות', exact: true }).click();
  if (mobile) await expect(page.locator('.MuiDrawer-paper')).toHaveCSS('transform', 'none');
  else await expect(page.getByRole('dialog', { name: 'סגנונות כתוביות', exact: true })).toHaveCSS('opacity', '1');
}
async function close(page: Page, mobile: boolean) { await page.getByRole('button', { name: mobile ? 'סגירת עיצוב' : 'סגירת סגנונות', exact: true }).click(); }
async function burn(page: Page, mobile: boolean) {
  await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole(mobile ? 'button' : 'menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click(); await download;
}
mkdirSync('tmp/caption-styles', { recursive: true });
for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} style cards apply complete appearances to preview, persistence and MP4 requests`, async ({ page }) => {
  test.setTimeout(90000);
  const burns = await setup(page, mobile);
  await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('font-family', '"QC Caption Heebo", Assistant, sans-serif');
  await open(page, mobile);
  await expect(page.getByRole('button', { name: 'בחירת סגנון נקי', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
  await page.screenshot({ path: `tmp/caption-styles/${mobile ? 'mobile' : 'desktop'}-library.png` });
  for (const preset of CAPTION_PRESETS) {
    const card = page.getByRole('button', { name: `בחירת סגנון ${preset.name}`, exact: true });
    await card.click(); await expect(card).toHaveAttribute('aria-pressed', 'true');
    await close(page, mobile);
    await expect(page.getByText('טוען פונט...', { exact: true })).toHaveCount(0);
    const overlay = page.getByTestId('subtitle-overlay');
    await expect(overlay).toHaveCSS('font-family', `"${getCaptionFont(preset.style.fontId).cssFamily}", Assistant, sans-serif`);
    if (preset.style.activeWordEnabled) {
      const rgb = preset.style.activeWordColor.slice(1).match(/../g)!.map(channel => parseInt(channel, 16)).join(', ');
      await expect(overlay.locator('[data-active-word=true]')).toHaveCSS('color', `rgb(${rgb})`);
    }
    if (preset.style.captionMotion === 'pop') await expect(page.getByTestId('caption-pop-word')).toHaveText('שלום');
    else await expect(overlay).toHaveText('שלום עולם');
    await burn(page, mobile);
    const request = burns.at(-1)!;
    for (const key of ['fontId', 'fontColor', 'outlineColor', 'activeWordColor', 'captionMotion', 'popIntensity'] as const)
      expect(request).toContain(`name="${key}"\r\n\r\n${preset.style[key]}\r\n`);
    expect(request.includes('name="activeWordEnabled"')).toBe(preset.style.activeWordEnabled);
    await open(page, mobile);
  }
  await close(page, mobile);
  await page.screenshot({ path: `tmp/caption-styles/${mobile ? 'mobile' : 'desktop'}-preview.png` });
  await page.reload();
  await expect(page.getByTestId('subtitle-overlay').locator('[data-active-word=true]')).toHaveCSS('color', 'rgb(233, 168, 255)');
  await open(page, mobile);
  await expect(page.getByRole('button', { name: 'בחירת סגנון ניאון', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('custom styles save, rename, persist and restore a complete appearance; categories filter the cards', async ({ page }) => {
  await setup(page); await open(page, false);
  const categories = page.getByRole('group', { name: 'קטגוריות סגנונות' });
  await categories.getByRole('button', { name: 'נקי', exact: true }).click();
  await expect(page.getByRole('button', { name: /^בחירת סגנון/ })).toHaveCount(2);
  await categories.getByRole('button', { name: 'צבעוני', exact: true }).click();
  await page.getByRole('button', { name: 'בחירת סגנון ניאון', exact: true }).click();
  await close(page, false);
  await page.getByRole('button', { name: 'צבעים', exact: true }).click();
  await page.getByLabel('צבע מילה פעילה', { exact: true }).fill('#ff8800');
  await page.keyboard.press('Escape');
  await open(page, false);
  await page.getByRole('button', { name: 'שמירת העיצוב כסגנון אישי', exact: true }).click();
  await page.getByRole('textbox', { name: 'שם הסגנון' }).fill('המותג שלי');
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(page.getByRole('button', { name: 'בחירת סגנון המותג שלי', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'שינוי שם המותג שלי', exact: true }).click();
  await page.getByRole('textbox', { name: 'שם הסגנון' }).fill('ממותג');
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  await page.reload(); await open(page, false);
  await categories.getByRole('button', { name: 'הכול', exact: true }).click();
  await page.getByRole('button', { name: 'בחירת סגנון נקי', exact: true }).click();
  await categories.getByRole('button', { name: 'שלי', exact: true }).click();
  await page.getByRole('button', { name: 'בחירת סגנון ממותג', exact: true }).click();
  await expect(page.getByTestId('subtitle-overlay').locator('[data-active-word=true]')).toHaveCSS('color', 'rgb(255, 136, 0)');
  await page.getByRole('button', { name: 'מחיקת סגנון ממותג', exact: true }).click();
  await expect(page.getByRole('button', { name: 'בחירת סגנון ממותג', exact: true })).toHaveCount(0);
  await page.reload(); await open(page, false); await categories.getByRole('button', { name: 'שלי', exact: true }).click();
  await expect(page.getByRole('button', { name: /^בחירת סגנון/ })).toHaveCount(0);
  // Deleting a reusable template does not change the project's current design.
  await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('color', 'rgb(103, 232, 249)');
});

test('font and active-word choices remain isolated between projects, including legacy font preferences', async ({ page }) => {
  await setup(page);
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: route.request().url().includes('second-token') ? 43 : 42,
    subtitle_json: [{ id: 1, start: 0, end: 4, text: 'שלום עולם' }], words_json: [], format: '.srt', stored_path: 'portrait.mp4' } } }));
  await page.route('**/api/videos/43/media?**', route => route.fulfill({ contentType: 'video/webm', body: portraitVideo }));
  await open(page, false);
  await page.getByRole('button', { name: 'בחירת סגנון עגול', exact: true }).click();
  await close(page, false);
  await page.goto('/?screen=edit&video=second-token');
  await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('font-family', '"QC Caption Heebo", Assistant, sans-serif');
  await expect(page.getByTestId('subtitle-overlay').locator('[data-active-word=true]')).toHaveCount(0);
  await page.goto('/?screen=edit&video=review-token');
  await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('font-family', '"QC Caption Fredoka", Assistant, sans-serif');
  await expect(page.getByTestId('subtitle-overlay').locator('[data-active-word=true]')).toHaveCSS('color', 'rgb(255, 193, 237)');
  await page.evaluate(() => localStorage.setItem('caption-editor-preferences', JSON.stringify({ fontId: 'assistant' })));
  await page.goto('/?screen=edit&video=second-token');
  // An explicitly saved old font remains in use until a project chooses a font.
  await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('font-family', '"Assistant SemiBold", Assistant, sans-serif');
});
