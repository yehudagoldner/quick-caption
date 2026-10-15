import { test, expect, devices, type Page } from '@playwright/test';
import { prepareApp, portraitVideo, segments as fixtureSegments, testUid } from './app-fixtures';
import type { Segment } from '../src/client/types';

async function setup(page: Page, mobile: boolean) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 });
  await prepareApp(page);
  await page.route('**/src/client/api.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `\nsetApiUser({ uid: '${testUid}', getIdToken: async () => 'appearance-fixture-token' });` });
  });
  let saved: Segment[] = structuredClone(fixtureSegments);
  let failSave = false;
  const burns: string[] = [];
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), portraitVideo.length - 1) : portraitVideo.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}) }, body: portraitVideo.subarray(start, end + 1) });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: saved, words_json: [], format: '.srt', stored_path: 'portrait.mp4' } } }));
  await page.route(/\/api\/videos\/(?:42\/subtitles|update-subtitles)$/, async route => {
    if (failSave) return route.fulfill({ status: 500, json: { error: 'fixture save failure' } });
    saved = JSON.parse(route.request().postDataJSON().subtitleJson);
    return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/burn-subtitles', route => {
    burns.push(route.request().postDataBuffer()!.toString());
    return route.fulfill({ contentType: 'video/webm', body: portraitVideo });
  });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  return { saved: () => saved, burns, fail: (value: boolean) => { failSave = value; } };
}

for (const mobile of [false, true]) test(`${mobile ? 'mobile' : 'desktop'} individual caption styles preview, save, reload, reset and burn in isolation`, async ({ page }) => {
  const state = await setup(page, mobile);
  const caption = page.getByTestId('caption-position');
  await caption.click();
  const panel = page.getByRole('region', { name: 'עיצוב כתובית נבחרת', exact: true });
  await expect(panel).toBeVisible();
  await panel.getByLabel('צבע הכתובית', { exact: true }).fill('#ff0000');
  await panel.getByLabel('צבע מסגרת הכתובית', { exact: true }).fill('#00ff00');
  await panel.getByLabel('גודל גופן לכתובית').fill('64');
  await panel.getByRole('combobox', { name: 'סוג פונט' }).fill('Fredoka');
  await page.getByRole('option', { name: 'Fredoka', exact: true }).click();
  await panel.getByRole('slider', { name: 'סיבוב', exact: true }).fill('25');
  await panel.getByRole('slider', { name: 'מיקום אופקי', exact: true }).fill('40');
  await panel.getByRole('slider', { name: 'גובה מהתחתית', exact: true }).fill('35');
  await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(caption).toHaveCSS('transform', /matrix\(0.906308, 0.422618/);
  // The phone drawer must leave the preview above it and usable.
  const stage = await page.getByTestId('media-stage').boundingBox();
  expect(stage!.height).toBeGreaterThan(100);
  if (mobile) expect(stage!.y + stage!.height).toBeLessThanOrEqual((await page.locator('.MuiDrawer-paper').boundingBox())!.y + 1);
  await page.screenshot({ path: `test-results/individual-${mobile ? 'mobile' : 'desktop'}.png` });
  await panel.getByRole('button', { name: 'שמירת עיצוב הכתובית', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(state.saved()[0].style).toMatchObject({ fontId: 'fredoka', fontSize: 64, fontColor: '#ff0000', outlineColor: '#00ff00', rotation: 25, positionXPercent: 40, offsetYPercent: 35 });
  expect(state.saved()[1].style).toBeUndefined();
  await page.reload();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
  await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await page.locator('video').evaluate((video: HTMLVideoElement) => { video.currentTime = 2.5; });
  await expect(page.getByTestId('subtitle-overlay')).toHaveText('סרטון לבדיקה');
  await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(caption).toHaveCSS('transform', /matrix\(1, 0, 0, 1,/);
  await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole(mobile ? 'button' : 'menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click();
  await download;
  await page.getByRole('button', { name: 'אולי אחר כך', exact: true }).click();
  expect(state.burns.at(-1)).toContain('"rotation":25');
  expect(state.burns.at(-1)).toContain('"fontId":"fredoka"');
  await page.locator('video').evaluate((video: HTMLVideoElement) => { video.currentTime = .5; });
  await caption.click();
  await panel.getByRole('button', { name: 'חזרה לעיצוב הכללי' }).click();
  await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await panel.getByRole('button', { name: 'ביטול', exact: true }).click();
  await expect(page.getByTestId('subtitle-overlay')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await caption.click();
  await panel.getByRole('button', { name: 'חזרה לעיצוב הכללי' }).click();
  await panel.getByRole('button', { name: 'שמירת עיצוב הכתובית', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(state.saved()[0].style).toBeUndefined();
  await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
  const nextDownload = page.waitForEvent('download');
  await page.getByRole(mobile ? 'button' : 'menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click();
  await nextDownload;
  expect(state.burns).toHaveLength(2);
  expect(state.burns[1]).not.toContain('"rotation":25');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe('touch appearance editing', () => {
  test.use({ hasTouch: true, isMobile: true, userAgent: devices['Pixel 7'].userAgent });
  test('Android selected caption moves from the preview background and rotates with a finger', async ({ page }) => {
    const state = await setup(page, true);
    const caption = page.getByTestId('caption-position');
    await caption.tap();
    const panel = page.getByRole('region', { name: 'עיצוב כתובית נבחרת', exact: true });
    await expect(panel).toBeVisible();
    await expect(page.locator('.MuiDrawer-paper')).toHaveCSS('transform', 'none');
    const stage = (await page.getByTestId('media-stage').boundingBox())!;
    const initial = (await caption.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const x = stage.x + stage.width / 2, y = stage.y + 55;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 2, y: y + i * 3 }] });
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const moved = (await caption.boundingBox())!;
    expect(moved.x - initial.x).toBeCloseTo(24, 0);
    expect(moved.y - initial.y).toBeCloseTo(36, 0);
    const pivot = { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 };
    const handle = (await page.getByRole('button', { name: 'ידית סיבוב הכתובית' }).boundingBox())!;
    const hx = handle.x + handle.width / 2, hy = handle.y + handle.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hx, y: hy }] });
    for (let i = 1; i <= 12; i++) {
      const angle = Math.PI / 6 * i / 12, dx = hx - pivot.x, dy = hy - pivot.y;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle) }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(panel.getByRole('slider', { name: 'סיבוב', exact: true })).toHaveValue('30');
    await panel.getByRole('button', { name: 'שמירת עיצוב הכתובית', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(state.saved()[0].style!.rotation).toBe(30);
    expect(state.saved()[1].style).toBeUndefined();
  });
  test('first touch drags immediately; two fingers rotate and pinch, then one finger continues without a jump', async ({ page }) => {
    const state = await setup(page, true);
    const caption = page.getByTestId('caption-position');
    const stage = page.getByTestId('media-stage');
    const cdp = await page.context().newCDPSession(page);
    const initial = (await caption.boundingBox())!;
    const before = (await stage.boundingBox())!;
    // A fingertip may land just below the glyphs, inside the enlarged hit target.
    const x = initial.x + initial.width / 2, y = initial.y + initial.height + 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x + 25, y: y - 25 }] });
    // The drawer waits until release; the preview must not resize underneath a finger.
    expect((await stage.boundingBox())!.height).toBeCloseTo(before.height, 0);
    const moved = (await caption.boundingBox())!;
    expect(moved.x - initial.x).toBeCloseTo(25, 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const panel = page.getByRole('region', { name: 'עיצוב כתובית נבחרת', exact: true });
    await expect(panel).toBeVisible();
    await expect(page.locator('.MuiDrawer-paper')).toHaveCSS('transform', 'none');
    const fontSize = Number(await panel.getByLabel('גודל גופן לכתובית').inputValue());
    const rect = (await caption.boundingBox())!, cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: cx - 30, y: cy }, { id: 2, x: cx + 30, y: cy }] });
    const second = { id: 2, x: cx + 45 * Math.cos(Math.PI / 6), y: cy + 22.5 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: cx - 45 * Math.cos(Math.PI / 6), y: cy - 22.5 }, second] });
    await expect(panel.getByRole('slider', { name: 'סיבוב', exact: true })).toHaveValue('30');
    expect(Number(await panel.getByLabel('גודל גופן לכתובית').inputValue())).toBe(Math.round(fontSize * 1.5));
    const position = Number(await panel.getByRole('slider', { name: 'מיקום אופקי', exact: true }).inputValue());
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id: 1, x: cx - 45 * Math.cos(Math.PI / 6), y: cy - 22.5 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...second, x: second.x + 10 }] });
    expect(Number(await panel.getByRole('slider', { name: 'מיקום אופקי', exact: true }).inputValue())).toBeGreaterThan(position);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await panel.getByRole('button', { name: 'שמירת עיצוב הכתובית', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(state.saved()[0].style!.rotation).toBeCloseTo(30, 0);
    expect(state.saved()[1].style).toBeUndefined();
  });
  test('touch selects and drags a caption, and resizing preserves its draft', async ({ page }) => {
    const state = await setup(page, true);
    await page.getByTestId('caption-position').tap();
    const panel = page.getByRole('region', { name: 'עיצוב כתובית נבחרת', exact: true });
    await expect(panel).toBeVisible();
    await expect(page.locator('.MuiDrawer-paper')).toHaveCSS('transform', 'none');
    const bounds = await page.getByTestId('caption-position').boundingBox();
    const x = bounds!.x + bounds!.width / 2, y = bounds!.y + bounds!.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 15, y: y - 15 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const position = Number(await panel.getByRole('slider', { name: 'מיקום אופקי', exact: true }).inputValue());
    expect(position).toBeGreaterThan(50);
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(panel).toBeVisible();
    expect(Number(await panel.getByRole('slider', { name: 'מיקום אופקי', exact: true }).inputValue())).toBe(position);
    await panel.getByRole('button', { name: 'שמירת עיצוב הכתובית', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(state.saved()[0].style!.positionXPercent).toBe(position);
  });
});

test('mouse drags on the first press and rotation handle rotates around the caption center', async ({ page }) => {
  const state = await setup(page, false);
  const caption = page.getByTestId('caption-position');
  const before = (await caption.boundingBox())!;
  const x = before.x + before.width / 2, y = before.y + before.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 30, y - 40, { steps: 6 });
  const moved = (await caption.boundingBox())!;
  expect(moved.x - before.x).toBeCloseTo(30, 0);
  expect(moved.y - before.y).toBeCloseTo(-40, 0);
  await page.mouse.up();
  const panel = page.getByRole('region', { name: 'עיצוב כתובית נבחרת', exact: true });
  await expect(panel).toBeVisible();
  const rect = (await caption.boundingBox())!, pivot = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const handle = page.getByRole('button', { name: 'ידית סיבוב הכתובית' });
  const hb = (await handle.boundingBox())!, hx = hb.x + hb.width / 2, hy = hb.y + hb.height / 2;
  const dx = hx - pivot.x, dy = hy - pivot.y, angle = Math.PI / 6;
  await page.mouse.move(hx, hy); await page.mouse.down();
  await page.mouse.move(pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle), pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle), { steps: 8 });
  await page.mouse.up();
  await expect(panel.getByRole('slider', { name: 'סיבוב', exact: true })).toHaveValue('30');
  const rotated = (await caption.boundingBox())!;
  expect(rotated.x + rotated.width / 2).toBeCloseTo(pivot.x, 0);
  expect(rotated.y + rotated.height / 2).toBeCloseTo(pivot.y, 0);
  await handle.focus(); await page.keyboard.press('Shift+ArrowRight');
  await expect(panel.getByRole('slider', { name: 'סיבוב', exact: true })).toHaveValue('45');
  await page.screenshot({ path: 'test-results/caption-rotation-handle.png' });
  await panel.getByRole('button', { name: 'שמירת עיצוב הכתובית', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(state.saved()[0].style!.rotation).toBe(45);
  expect(state.saved()[1].style).toBeUndefined();
});

test('dragging changes only the selected caption; failed saves retain the draft for retry', async ({ page }) => {
  const state = await setup(page, false);
  const caption = page.getByTestId('caption-position');
  await caption.focus(); await page.keyboard.press('Enter');
  const panel = page.getByRole('region', { name: 'עיצוב כתובית נבחרת', exact: true });
  await expect(panel).toBeVisible();
  const bounds = await caption.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds!.x + bounds!.width / 2 + 20, bounds!.y + bounds!.height / 2 - 20, { steps: 4 }); await page.mouse.up();
  expect(Number(await panel.getByRole('slider', { name: 'מיקום אופקי', exact: true }).inputValue())).toBeGreaterThan(50);
  expect(Number(await panel.getByRole('slider', { name: 'גובה מהתחתית', exact: true }).inputValue())).toBeGreaterThan(20);
  state.fail(true);
  await panel.getByRole('button', { name: 'שמירת עיצוב הכתובית', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('שמירת העיצוב נכשלה');
  expect(state.saved()[0].style).toBeUndefined();
  state.fail(false);
  await panel.getByRole('button', { name: 'שמירת עיצוב הכתובית', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(state.saved()[0].style!.positionXPercent).toBeGreaterThan(50);
  expect(state.saved()[1].style).toBeUndefined();
});
