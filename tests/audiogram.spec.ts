import { test, expect, type Page } from '@playwright/test';
import { prepareApp, segments as fixtureSegments, testUid } from './app-fixtures';
import type { Segment } from '../src/client/types';

function wav(seconds = 4, rate = 8000) {
  const samples = seconds * rate, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 3000), 44 + i * 2);
  return buffer;
}
const audio = wav();
const redPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function setup(page: Page, mobile = false) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 });
  await prepareApp(page);
  await page.route('**/src/client/api.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `\nsetApiUser({ uid: '${testUid}', getIdToken: async () => 'audiogram-fixture-token' });` });
  });
  let saved: Segment[] = structuredClone(fixtureSegments);
  const burns: string[] = [];
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}) }, body: audio.subarray(start, end + 1) });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: saved, words_json: [], format: '.srt', stored_path: 'podcast.wav', media_type: 'audio' } } }));
  await page.route(/\/api\/videos\/(?:42\/subtitles|update-subtitles)$/, async route => {
    saved = JSON.parse(route.request().postDataJSON().subtitleJson);
    return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/burn-subtitles', route => {
    burns.push(route.request().postDataBuffer()!.toString('latin1'));
    return route.fulfill({ contentType: 'video/mp4', body: Buffer.from('fixture') });
  });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('audio, video').first().evaluate((media: HTMLMediaElement) => media.readyState)).toBeGreaterThan(0);
  return { saved: () => saved, burns };
}

const ratio = async (page: Page) => { const box = (await page.getByTestId('media-stage').boundingBox())!; return box.height / box.width; };

test('an audio project gets a video frame: format, background, image and waveform; captions drag and the video downloads', async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByTestId('audiogram-backdrop')).toBeVisible();
  await expect(page.getByTestId('audiogram-wave')).toBeVisible();
  await expect(page.getByText('אודיו בלבד — תצוגה מקדימה של הכתוביות')).toHaveCount(0);
  await expect.poll(() => ratio(page)).toBeCloseTo(16 / 9, 1);
  // The frame's own play bar replaces native controls that would cover the captions.
  expect(await page.locator('video').evaluate((media: HTMLVideoElement) => media.controls)).toBe(false);
  await page.getByRole('button', { name: 'ניגון האודיו' }).click();
  await expect(page.getByRole('button', { name: 'השהיית האודיו' })).toBeVisible();
  await page.getByRole('button', { name: 'השהיית האודיו' }).click();
  await page.locator('video').evaluate((media: HTMLVideoElement) => { media.currentTime = .5; });

  await page.getByRole('button', { name: 'רקע', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'רקע לסרטון' });
  await settings.getByRole('button', { name: 'ריבוע 1:1' }).click();
  await expect.poll(() => ratio(page)).toBeCloseTo(1, 1);
  await settings.getByRole('button', { name: 'צבע רקע: #1e3a8a' }).click();
  await expect(page.getByTestId('audiogram-backdrop')).toHaveCSS('background-color', 'rgb(30, 58, 138)');
  await settings.getByLabel('בחירת תמונת רקע').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: redPixel });
  await expect(page.getByTestId('audiogram-image')).toBeVisible();
  await settings.getByRole('button', { name: 'מילוי המסך' }).click();
  await expect(page.getByTestId('audiogram-image')).toHaveCSS('object-fit', 'cover');
  await settings.getByRole('button', { name: 'צבע גל הקול: #facc15' }).click();
  await page.screenshot({ path: 'test-results/audiogram-desktop.png' });
  await settings.getByRole('button', { name: 'סגירת הגדרות הרקע' }).click();
  await expect(settings).toBeHidden();

  // The caption now moves like on a video, and the move is saved.
  const caption = page.getByTestId('caption-position');
  await expect(page.locator('.MuiModal-root:not(.MuiModal-hidden)')).toHaveCount(0);
  const box = (await caption.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 30, { steps: 5 }); await page.mouse.up();
  await expect(page.getByRole('region', { name: 'עיצוב כתובית נבחרת', exact: true })).toBeVisible();
  await expect.poll(() => state.saved()[0].style?.positionXPercent ?? 50).toBeGreaterThan(50);

  await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  await page.getByRole('menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click();
  await expect.poll(() => state.burns.length).toBe(1);
  const body = state.burns[0];
  expect(body).toContain('name="audiogram"');
  expect(body).toContain('"format":"square"');
  expect(body).toContain('"background":"#1e3a8a"');
  expect(body).toContain('"imageFit":"cover"');
  expect(body).toContain('"waveColor":"#facc15"');
  expect(body).toMatch(/name="background"; filename="background"\r\nContent-Type: image\/png/);
  expect(body).toMatch(/name="videoWidth"\r\n\r\n1080\r\n/);

  await page.reload();
  await expect(page.getByTestId('audiogram-image')).toBeVisible();
  await expect(page.getByTestId('audiogram-backdrop')).toHaveCSS('background-color', 'rgb(30, 58, 138)');
  await expect.poll(() => ratio(page)).toBeCloseTo(1, 1);
});

test('phone: background settings live in the style drawer and the video download is offered', async ({ page }) => {
  await setup(page, true);
  await expect(page.getByTestId('audiogram-backdrop')).toBeVisible();
  await page.getByRole('button', { name: 'עיצוב', exact: true }).click();
  const drawer = page.getByRole('region', { name: 'עיצוב כתוביות' });
  await expect(drawer.getByTestId('audiogram-settings')).toBeVisible();
  await drawer.getByRole('button', { name: 'רוחבי 16:9' }).click();
  await expect.poll(() => ratio(page)).toBeCloseTo(9 / 16, 1);
  await page.screenshot({ path: 'test-results/audiogram-mobile.png' });
  await drawer.getByRole('button', { name: 'סגירת עיצוב' }).click();
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'שמירה והורדה' });
  await expect(dialog.getByRole('button', { name: 'וידאו מלא עם כתוביות' })).toBeEnabled();
  await expect(dialog.getByText('הורדת וידאו זמינה לקובץ וידאו בלבד.')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
