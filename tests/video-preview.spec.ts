import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo, segments } from './app-fixtures';
import type { Segment } from '../src/client/types';
import { readFileSync } from 'node:fs';
const landscapeVideo = Buffer.from(readFileSync('tests/fixtures/landscape-video.base64', 'utf8'), 'base64');

async function setup(page: Page, initialMode = 'rendition', landscape = false) {
  await page.setViewportSize({ width: 1440, height: 1000 }); await prepareApp(page);
  let mode = initialMode, originalReads = 0, infoRequests = 0;
  let saved: Segment[] = structuredClone(segments);
  const burns: string[] = [], mediaRequests: string[] = [];
  await page.route('**/api/videos/42/preview', route => {
    infoRequests++;
    return route.fulfill({ json: { mode, qualities: mode === 'rendition' ? ['720p', '1080p'] : [], defaultQuality: mode === 'rendition' ? '720p' : null,
      sourceDimensions: landscape ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 }, mediaToken: 'preview-token' } });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: saved, words_json: [], stored_path: 'bunny-fixture', format: '.srt' }, mediaToken: 'original-token' } }));
  await page.route('**/api/videos/42/media?**', route => {
    const quality = new URL(route.request().url()).searchParams.get('preview'); mediaRequests.push(quality || 'original');
    if (!quality) { originalReads++; return route.fulfill({ status: 409, json: { error: 'The heavy original must not be requested' } }); }
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const media = landscape ? landscapeVideo : portraitVideo;
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
  });
  await page.route(/\/api\/videos\/(?:42\/subtitles|update-subtitles)$/, route => {
    saved = JSON.parse(route.request().postDataJSON().subtitleJson); return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/burn-subtitles', route => { burns.push(route.request().postDataBuffer()!.toString()); return route.fulfill({ contentType: 'video/mp4', body: portraitVideo }); });
  await page.goto('/?screen=edit&video=review-token');
  return { originalReads: () => originalReads, saved: () => saved, burns, mediaRequests, infoRequests: () => infoRequests, mode: (value: string) => { mode = value; } };
}

test('720p default, 1080p selection retains playhead, caption edits and history; exports retain original dimensions', async ({ page }) => {
  const state = await setup(page);
  const quality = page.getByRole('combobox', { name: 'איכות תצוגה מקדימה' });
  await expect(quality).toContainText('720p');
  await expect(page.locator('video')).toHaveAttribute('src', /preview=720p/);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  await page.getByTestId('subtitle-clip').first().click();
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 1; });
  await expect(page.getByRole('button', { name: 'פיצול כתובית בנקודת הקו', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'פיצול כתובית בנקודת הקו', exact: true }).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  const before = structuredClone(state.saved());
  await quality.click(); await page.getByRole('option', { name: /1080p/ }).click();
  await expect(page.locator('video')).toHaveAttribute('src', /preview=1080p/);
  await expect(quality).toBeEnabled();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 1);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3); expect(state.saved()).toEqual(before);
  await expect(page.getByRole('button', { name: 'ביטול פעולה', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/video-preview-quality.png' });
  await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click(); await download;
  expect(state.burns).toHaveLength(1); expect(state.burns[0]).toMatch(/name="videoId"\r\n\r\n42/);
  expect(state.burns[0]).toMatch(/name="videoWidth"\r\n\r\n1080/); expect(state.burns[0]).toMatch(/name="videoHeight"\r\n\r\n1920/);
  expect(state.burns[0]).not.toContain('name="preview"');
  expect(state.originalReads()).toBe(0);
  await page.reload(); await expect(quality).toContainText('720p'); expect(state.saved()).toEqual(before);
});

test('changing quality while playing resumes at the same position', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  await page.locator('video').evaluate(async (v: HTMLVideoElement) => { v.muted = true; v.playbackRate = .1; v.currentTime = 1; await v.play(); });
  await page.getByRole('combobox', { name: 'איכות תצוגה מקדימה' }).click(); await page.getByRole('option', { name: /1080p/ }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  const position = await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(position).toBeGreaterThanOrEqual(1); expect(position).toBeLessThan(2); expect(state.originalReads()).toBe(0);
});

test('cropped versions export with source-sized geometry while editing the lightweight preview', async ({ page }) => {
  const state = await setup(page, 'rendition', true);
  await page.getByRole('button', { name: 'כן, צור גרסאות', exact: true }).click();
  await page.getByRole('tab', { name: /9:16/ }).click();
  await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click(); await download;
  expect(state.burns[0]).toContain('"format":"vertical"');
  expect(state.burns[0]).toMatch(/name="videoWidth"\r\n\r\n606/); expect(state.burns[0]).toMatch(/name="videoHeight"\r\n\r\n1080/);
  expect(state.originalReads()).toBe(0);
});

test('pending previews do not start downloading the source, and retry loads the ready rendition', async ({ page }) => {
  const state = await setup(page, 'pending');
  await expect(page.getByText('גרסת העריכה עדיין בהכנה.', { exact: false }).first()).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0); expect(state.originalReads()).toBe(0);
  state.mode('rendition'); await page.getByRole('button', { name: 'נסה שוב', exact: true }).click();
  await expect(page.locator('video')).toHaveAttribute('src', /preview=720p/); expect(state.infoRequests()).toBeGreaterThan(1);
  expect(state.originalReads()).toBe(0);
});

test('mobile settings can increase preview quality without changing the source', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'עוד', exact: true }).click();
  await page.getByRole('button', { name: 'הגדרות כתוביות', exact: true }).click();
  const quality = page.getByRole('dialog').getByRole('combobox', { name: 'איכות תצוגה מקדימה' });
  await expect(quality).toContainText('720p'); await quality.click(); await page.getByRole('option', { name: /1080p/ }).click();
  await expect(page.locator('video')).toHaveAttribute('src', /preview=1080p/); await expect(quality).toBeEnabled();
  expect(state.originalReads()).toBe(0);
});

test('an oversized waveform response is cancelled instead of competing with playback', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    (window as any).__waveformCancelled = 0;
    window.fetch = (input, init) => {
      if (String(input).includes('/api/videos/42/media?') && String(input).includes('preview=')) {
        return Promise.resolve(new Response(new ReadableStream({ cancel() { (window as any).__waveformCancelled++; } }), { headers: { 'Content-Length': String(200 * 1024 * 1024) } }));
      }
      return originalFetch(input, init);
    };
  });
  const state = await setup(page);
  await expect.poll(() => page.evaluate(() => (window as any).__waveformCancelled)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  expect(state.originalReads()).toBe(0);
});
