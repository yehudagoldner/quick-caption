import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { prepareApp, segments } from './app-fixtures';
import type { Word } from '../src/client/types';
const landscape = Buffer.from(readFileSync('tests/fixtures/landscape-video.base64', 'utf8'), 'base64');

async function setup(page: Page, width = 1440, media = landscape) {
  await page.setViewportSize({ width, height: 1000 }); await prepareApp(page);
  let saved = structuredClone(segments); let savedWords: Word[] = []; let fail = false; const burns: string[] = [];
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: saved, words_json: savedWords, format: '.srt', stored_path: 'landscape.mp4' } } }));
  await page.route(/\/api\/videos\/(?:42\/subtitles|update-subtitles)$/, route => {
    if (fail) return route.fulfill({ status: 500, json: { error: 'fixture failure' } });
    saved = JSON.parse(route.request().postDataJSON().subtitleJson); savedWords = JSON.parse(route.request().postDataJSON().wordsJson ?? '[]'); return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/burn-subtitles', route => { burns.push(route.request().postDataBuffer()!.toString()); return route.fulfill({ contentType: 'video/mp4', body: landscape }); });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  return { saved: () => saved, words: () => savedWords, fail: (value: boolean) => { fail = value; }, burns };
}
async function create(page: Page) { await page.getByRole('button', { name: 'כן, צור גרסאות', exact: true }).click(); await expect(page.getByRole('tablist', { name: 'גרסאות הסרטון' })).toBeVisible(); }
async function select(page: Page, format: string) { await page.getByRole('tab', { name: new RegExp(format) }).click(); await expect(page.getByRole('tab', { name: new RegExp(format) })).toHaveAttribute('aria-selected', 'true'); }
async function selectAtOne(page: Page) {
  await page.getByTestId('subtitle-clip').first().click();
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 1; });
  await expect(page.getByRole('button', { name: 'פיצול כתובית בנקודת הקו', exact: true })).toBeEnabled();
}
test('desktop: create, drag, independent split, split all, undo across versions and reload', async ({ page }) => {
  const state = await setup(page); await create(page); await select(page, '9:16');
  const frame = page.getByTestId('video-crop-frame'); await expect(frame).toBeVisible();
  const bounds = await frame.boundingBox();
  await page.mouse.move(bounds!.x + 20, bounds!.y + 20); await page.mouse.down(); await page.mouse.move(bounds!.x + 90, bounds!.y + 20, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => Number(await frame.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  const position = await frame.getAttribute('aria-valuenow');
  await selectAtOne(page); await page.getByRole('button', { name: 'פיצול כתובית בנקודת הקו', exact: true }).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3); expect(state.saved()).toHaveLength(2);
  await select(page, 'מקור'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await selectAtOne(page); await page.getByRole('button', { name: 'פיצול בכל הגרסאות', exact: true }).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3); expect(state.saved()).toHaveLength(3);
  await select(page, '1:1'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2); expect(state.saved()).toHaveLength(2);
  await select(page, '9:16'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'ביטול פעולה', exact: true })).toBeEnabled();
  await expect(frame).toHaveAttribute('aria-valuenow', position!);
  await page.reload(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await select(page, '9:16'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(3); await expect(frame).toHaveAttribute('aria-valuenow', position!);
  await page.screenshot({ path: 'test-results/video-versions-desktop.png' });
});
test('mobile and tablet do not offer versions for a wide upload', async ({ page }) => {
  for (const width of [390, 800]) { await setup(page, width); await expect(page.getByRole('dialog', { name: 'רוצה ליצור גרסאות נוספות?' })).toHaveCount(0); await expect(page.getByRole('tablist', { name: 'גרסאות הסרטון' })).toHaveCount(0); }
});
test('both split actions stay inside the editor at desktop widths with the sidebar open', async ({ page }) => {
  await setup(page, 1024); await create(page);
  for (const width of [900, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const format of ['מקור', '9:16']) {
      await select(page, format); await selectAtOne(page);
      const track = await page.getByTestId('timeline-tracks').boundingBox();
      for (const name of ['פיצול כתובית בנקודת הקו', 'פיצול בכל הגרסאות']) {
        const button = page.getByRole('button', { name, exact: true });
        await expect(button).toBeEnabled();
        const bounds = (await button.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(track!.x - 1);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(track!.x + track!.width + 1);
        expect(await button.evaluate(element => {
          const r = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        })).toBe(true);
      }
      if (width === 1024 && format === '9:16') await page.screenshot({ path: 'test-results/video-versions-split-actions.png' });
    }
  }
});
test('unavailable browser storage never prevents continuing with the original', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await setup(page);
  await page.getByRole('button', { name: 'כן, צור גרסאות', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'המשך עם המקור', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
});
test('decline is remembered, creating later works, failed group save is atomic', async ({ page }) => {
  const state = await setup(page); await page.getByRole('button', { name: 'המשך עם המקור', exact: true }).click();
  await page.reload(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'יצירת גרסאות לרשתות' }).click();
  await selectAtOne(page); state.fail(true); await page.getByRole('button', { name: 'פיצול בכל הגרסאות', exact: true }).click();
  await expect(page.getByText('פיצול בכל הגרסאות נכשל. נסו שוב.').first()).toBeVisible();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2); expect(state.saved()).toHaveLength(2);
  state.fail(false); await select(page, '9:16'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
});
test('automatic analysis loads local model and reports no faces without pretending success', async ({ page }) => {
  test.setTimeout(90000); await setup(page); await create(page); await select(page, '9:16');
  await page.getByRole('switch', { name: 'התאמה אוטומטית' }).check();
  await expect(page.getByText('לא זוהו פנים למעקב. אפשר לבחור את האזור ידנית.')).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('switch', { name: 'התאמה אוטומטית' })).not.toBeChecked();
});
test('automatic face tracking follows motion, persists, and manual adjustment disables it', async ({ page }) => {
  // Derived from Google's public MediaPipe test asset:
  // https://storage.googleapis.com/mediapipe-assets/portrait.jpg
  const face = Buffer.from(readFileSync('tests/fixtures/tracking-face.base64', 'utf8'), 'base64');
  await setup(page, 1440, face); await create(page); await select(page, '9:16');
  const automatic = page.getByRole('switch', { name: 'התאמה אוטומטית' });
  await automatic.check(); await expect(automatic).toBeEnabled({ timeout: 60000 }); await expect(automatic).toBeChecked();
  const points = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.includes('video-versions:'))!;
    return JSON.parse(localStorage.getItem(key)!).crops.vertical.points;
  });
  expect(points.length).toBeGreaterThan(1); expect(points.at(-1).x).toBeGreaterThan(points[0].x + .1);
  await page.reload(); await select(page, '9:16'); await expect(automatic).toBeChecked();
  await page.getByTestId('video-crop-frame').focus(); await page.keyboard.press('ArrowLeft'); await expect(automatic).not.toBeChecked();
});
test('export includes the selected crop and caption dimensions, and switching to mobile restores original', async ({ page }) => {
  const state = await setup(page); await create(page); await select(page, '4:5');
  await page.getByTestId('video-crop-frame').focus(); await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  await page.getByRole('menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click();
  await expect.poll(() => state.burns.length).toBe(1);
  expect(state.burns[0]).toContain('"format":"portrait"');
  expect(state.burns[0]).toContain('"x":0.51');
  expect(state.burns[0]).toMatch(/name="videoWidth"\r\n\r\n288/);
  expect(state.burns[0]).toMatch(/name="videoHeight"\r\n\r\n360/);
  await page.getByRole('button', { name: 'אולי אחר כך', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('video-crop-frame')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('tab', { name: /מקור/ })).toHaveAttribute('aria-selected', 'true');
});

async function storedRevisions(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.includes('video-versions:'))!;
    return JSON.parse(localStorage.getItem(key)!).revisions;
  });
}

test('hover download menu exports another version with its saved split and crop, and supports keyboard', async ({ page }) => {
  const state = await setup(page); await create(page); await select(page, '9:16'); await selectAtOne(page);
  await page.getByRole('button', { name: 'פיצול כתובית בנקודת הקו', exact: true }).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await page.getByTestId('video-crop-frame').focus(); await page.keyboard.press('ArrowRight');
  await select(page, 'מקור');
  const button = page.getByRole('button', { name: 'הורדה', exact: true });
  await button.hover();
  const menu = page.getByRole('menu', { name: 'אפשרויות הורדה' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'הורדת גרסת 9:16', exact: true }).hover();
  await page.waitForTimeout(350); // Cross the hover-close delay while inside the menu.
  await expect(menu).toBeVisible();
  await page.screenshot({ path: 'test-results/version-download-menu.png' });
  const download = page.waitForEvent('download');
  await menu.getByRole('menuitem', { name: 'הורדת גרסת 9:16', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/-vertical\.mp4$/);
  expect(state.burns).toHaveLength(1);
  expect(state.burns[0]).toContain('"format":"vertical"');
  expect(state.burns[0]).toContain('"x":0.51');
  expect(state.burns[0]).toMatch(/name="videoWidth"\r\n\r\n202/);
  expect(state.burns[0].match(/name="subtitleContent"\r\n\r\n([\s\S]*?)\r\n--/)![1].match(/ --> /g)).toHaveLength(3);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await page.getByRole('button', { name: 'אולי אחר כך', exact: true }).click();
  for (const [label, format, width] of [['1:1', 'square', 360], ['4:5', 'portrait', 288], ['מקור', null, 640]] as const) {
    await button.focus(); await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape'); await expect(button).toBeFocused();
    await button.click();
    const next = page.waitForEvent('download');
    await menu.getByRole('menuitem', { name: `הורדת גרסת ${label}`, exact: true }).click(); await next;
    const burn = state.burns.at(-1)!;
    if (format) expect(burn).toContain(`"format":"${format}"`);
    else expect(burn).not.toContain('name="crop"');
    expect(burn).toContain(`name="videoWidth"\r\n\r\n${width}`);
    expect(burn.match(/name="subtitleContent"\r\n\r\n([\s\S]*?)\r\n--/)![1].match(/ --> /g)).toHaveLength(2);
    await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
    const feedback = page.getByRole('button', { name: 'אולי אחר כך', exact: true });
    if (await feedback.isVisible()) await feedback.click();
  }
  expect(state.burns).toHaveLength(4);
  await button.hover(); await expect(menu).toBeVisible();
  await page.mouse.move(1, 1); await expect(menu).toHaveCount(0);
});

test('each version offers relevant platforms and a correctly cropped download fallback', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined }));
  const state = await setup(page); await create(page);
  for (const [label, platformNames] of [
    ['מקור', ['YouTube']], ['9:16', ['TikTok', 'YouTube Shorts', 'Instagram Reels / Stories', 'Facebook Reels / Stories']],
    ['1:1', ['Instagram', 'Facebook']], ['4:5', ['Instagram', 'Facebook']],
  ] as const) {
    await select(page, label);
    await page.getByRole('button', { name: 'שיתוף הגרסה', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `שיתוף גרסת ${label}`, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link')).toHaveCount(platformNames.length);
    for (const platform of platformNames) {
      const link = dialog.getByRole('link', { name: `פתיחת ${platform}`, exact: true });
      await expect(link).toHaveAttribute('href', /^https:\/\//);
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    await expect(dialog.getByRole('button', { name: 'שיתוף דרך המכשיר' })).toHaveCount(0);
    if (label === '9:16') {
      await expect(page.locator('.MuiDialog-container').filter({ has: dialog })).toHaveCSS('opacity', '1');
      await page.screenshot({ path: 'test-results/version-sharing.png' });
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'הורדת הקובץ לשיתוף' }).click();
      expect((await download).suggestedFilename()).toMatch(/-vertical\.mp4$/);
      await page.getByRole('button', { name: 'אולי אחר כך', exact: true }).click();
      await expect(dialog).toBeVisible(); // Keep the platform links available after downloading.
    }
    await dialog.getByRole('button', { name: 'סגור', exact: true }).click();
  }
  expect(state.burns).toHaveLength(4);
  expect(state.burns[1]).toContain('"format":"vertical"');
  expect(state.burns[2]).toContain('"format":"square"');
  expect(state.burns[3]).toContain('"format":"portrait"');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'שיתוף הגרסה', exact: true })).toHaveCount(0);
});

test('native version sharing uses an explicit gesture and retries cancellation without another burn', async ({ page }) => {
  await page.addInitScript(() => {
    let inClick = false;
    document.addEventListener('click', () => { inClick = true; setTimeout(() => { inClick = false; }, 0); }, true);
    (window as any).shares = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => {
      (window as any).shares.push({ name: data.files![0].name, size: data.files![0].size, inClick });
      if ((window as any).shares.length === 1) throw new DOMException('Cancelled', 'AbortError');
    } });
  });
  const state = await setup(page); await create(page); await select(page, '4:5');
  await page.getByRole('button', { name: 'שיתוף הגרסה', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'שיתוף גרסת 4:5', exact: true });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (window as any).shares)).toEqual([]);
  const share = dialog.getByRole('button', { name: 'שיתוף דרך המכשיר' });
  await share.click(); await expect(dialog).toBeVisible(); await expect(dialog.getByRole('alert')).toHaveCount(0);
  await share.click(); await expect(dialog).toHaveCount(0);
  const shares = await page.evaluate(() => (window as any).shares);
  expect(shares).toHaveLength(2);
  expect(shares.every((s: any) => s.inClick && s.size === landscape.length && s.name.endsWith('-portrait.mp4'))).toBe(true);
  expect(state.burns).toHaveLength(1);
});

test('a failed save blocks switching for download and a retry exports the requested version', async ({ page }) => {
  const state = await setup(page); await create(page); state.fail(true);
  const text = page.getByRole('textbox', { name: 'טקסט הכתובית', exact: true }).first();
  await text.fill('שלומות עולם'); await text.blur();
  await expect(page.getByText('שמירת השינוי בכל הגרסאות נכשלה. נסו שוב.').first()).toBeVisible();
  await page.getByRole('button', { name: 'הורדה', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'הורדת גרסת 9:16', exact: true }).click();
  await expect(page.getByText('לא ניתן לעבור לגרסה להורדה. שמרו את השינויים ונסו שוב.')).toBeVisible();
  expect(state.burns).toHaveLength(0);
  await expect(page.getByRole('tab', { name: /מקור/ })).toHaveAttribute('aria-selected', 'true');
  state.fail(false);
  await page.getByRole('button', { name: 'הורדה', exact: true }).hover();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'הורדת גרסת 9:16', exact: true }).click(); await download;
  expect(state.burns).toHaveLength(1); expect(state.burns[0]).toContain('"format":"vertical"');
});

test('shared text, insertions, deletions and word timing survive different splits, undo, redo and reload', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('caption-editor-preferences', JSON.stringify({ fps: 25 })));
  const state = await setup(page); await create(page); await select(page, '9:16'); await selectAtOne(page);
  await page.getByRole('button', { name: 'פיצול כתובית בנקודת הקו', exact: true }).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await select(page, 'מקור');
  const text = page.getByRole('textbox', { name: 'טקסט הכתובית', exact: true }).first();
  await text.fill('שלומות עולם'); await text.blur();
  await expect.poll(() => state.saved()[0].text).toBe('שלומות עולם');
  await select(page, '9:16');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await expect(text).toHaveValue('שלומות');
  await select(page, 'מקור'); await page.getByTestId('subtitle-clip').first().click();
  await page.getByRole('button', { name: 'מילה אקטיבית', exact: true }).click();
  await page.getByTestId('word-clip').first().click();
  await page.getByRole('button', { name: 'ערוך מילה ותזמון', exact: true }).click();
  await page.getByRole('textbox', { name: 'תחילת המילה', exact: true }).fill('00:00:00:05');
  await page.getByRole('button', { name: 'החל בטיוטה', exact: true }).click();
  await expect.poll(() => state.words()[0]?.start).toBe(.2);
  for (const r of Object.values(await storedRevisions(page)) as any[]) expect(r.words[0].sourceStart).toBe(.2);
  await select(page, '9:16'); await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => state.words()[0]?.start).toBe(0);
  await page.getByRole('button', { name: 'ביצוע חוזר', exact: true }).click();
  await expect.poll(() => state.words()[0]?.start).toBe(.2);
  await page.reload(); await select(page, '9:16'); await expect(text).toHaveValue('שלומות');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await select(page, 'מקור'); await text.fill('שלומות כל עולם'); await text.blur();
  await expect.poll(() => state.saved()[0].text).toBe('שלומות כל עולם');
  for (const r of Object.values(await storedRevisions(page)) as any[]) expect(r.words.map((w: Word) => w.word)).toEqual(['שלומות', 'כל', 'עולם', 'סרטון', 'לבדיקה']);
  await text.fill('כל עולם'); await text.blur();
  await expect.poll(() => state.saved()[0].text).toBe('כל עולם');
  for (const r of Object.values(await storedRevisions(page)) as any[]) expect(r.words.map((w: Word) => w.word)).toEqual(['כל', 'עולם', 'סרטון', 'לבדיקה']);
  await select(page, '9:16'); await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
});

test('failed shared correction and failed undo preserve all saved versions and can be retried', async ({ page }) => {
  const state = await setup(page); await create(page); await select(page, '9:16');
  const before = await storedRevisions(page); state.fail(true);
  const text = page.getByRole('textbox', { name: 'טקסט הכתובית', exact: true }).first();
  await text.fill('שלומות עולם'); await text.blur();
  await expect(page.getByText('שמירת השינוי בכל הגרסאות נכשלה. נסו שוב.').first()).toBeVisible();
  expect(state.saved()[0].text).toBe('שלום עולם');
  expect(await storedRevisions(page)).toEqual(before);
  state.fail(false); await page.getByRole('button', { name: 'נסה לשמור שוב', exact: true }).click();
  await expect.poll(() => state.saved()[0].text).toBe('שלומות עולם');
  const corrected = await storedRevisions(page); state.fail(true);
  await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect(page.getByText('שחזור השינוי בכל הגרסאות נכשל. נסו שוב.').first()).toBeVisible();
  expect(await storedRevisions(page)).toEqual(corrected);
  state.fail(false); await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => state.saved()[0].text).toBe('שלום עולם');
  for (const r of Object.values(await storedRevisions(page)) as any[]) expect(r.words[0].word).toBe('שלום');
});
