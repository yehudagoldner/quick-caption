import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { prepareApp, portraitVideo, segments } from './app-fixtures';
import type { Segment, Word } from '../src/client/types';

const landscape = Buffer.from(readFileSync('tests/fixtures/landscape-video.base64', 'utf8'), 'base64');
const replacementFile = { name: 'replacement.webm', mimeType: 'video/webm', buffer: landscape };

async function setup(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 }); await prepareApp(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('/video-versions:review-user:42')) localStorage.setItem('/video-versions:review-user:42', JSON.stringify({ dismissed: true }));
    if (!localStorage.getItem('caption-style:review-user:42')) localStorage.setItem('caption-style:review-user:42', JSON.stringify({ fontSize: 60, fontColor: '#00ff00', offsetYPercent: 30 }));
  });
  let saved: Segment[] = structuredClone(segments);
  saved[0].style = { fontColor: '#ff0000' };
  let savedWords: Word[] = [{ word: 'שלום', start: 0, end: 1 }, { word: 'עולם', start: 1, end: 2 }];
  let replaced = false, fail = false, count = 0;
  let gate: Promise<void> = Promise.resolve();
  const burns: string[] = [];
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, original_filename: replaced ? replacementFile.name : 'original.webm',
    subtitle_json: saved, words_json: savedWords, format: '.srt', stored_path: replaced ? 'replacement.webm' : 'original.webm' }, mediaToken: replaced ? 'replacement-token' : 'original-token' } }));
  await page.route('**/api/videos/42/media?**', route => {
    const media = replaced ? landscape : portraitVideo;
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
  });
  await page.route('**/api/videos/42/media', async route => {
    expect(route.request().method()).toBe('PUT'); expect(route.request().headers().authorization).toBe('Bearer fixture-id-token');
    expect(route.request().postDataBuffer()!.toString()).toContain('filename="replacement.webm"');
    count++; await gate;
    if (fail) return route.fulfill({ status: 500, json: { error: 'העלאת הסרטון נכשלה לבדיקה' } });
    replaced = true;
    return route.fulfill({ json: { success: true, mediaToken: 'replacement-token', originalFilename: replacementFile.name, durationSeconds: 4 } });
  });
  await page.route(/\/api\/videos\/(?:42\/subtitles|update-subtitles)$/, route => {
    const body = route.request().postDataJSON(); saved = JSON.parse(body.subtitleJson); savedWords = JSON.parse(body.wordsJson ?? '[]');
    return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/burn-subtitles', route => { burns.push(route.request().postDataBuffer()!.toString()); return route.fulfill({ contentType: 'video/mp4', body: landscape }); });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(180);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  return { data: () => ({ segments: saved, words: savedWords }), count: () => count, fail: (value: boolean) => { fail = value; }, hold: (value: Promise<void>) => { gate = value; }, burns };
}

async function settings(page: Page) {
  await page.getByRole('button', { name: 'הגדרות כתוביות', exact: true }).click();
  return page.getByRole('dialog', { name: 'הגדרות כתוביות', exact: true });
}

test('desktop replacement keeps edits, timings, styles and undo; preview, export and reload use the new video', async ({ page }) => {
  const state = await setup(page);
  await page.getByTestId('subtitle-clip').first().click();
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 1; });
  const split = page.getByRole('button', { name: 'פיצול כתובית בנקודת הקו', exact: true });
  await expect(split).toBeEnabled(); await split.click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  const before = structuredClone(state.data());
  const projectStyle = await page.evaluate(() => localStorage.getItem('caption-style:review-user:42'));
  const dialog = await settings(page);
  await dialog.getByLabel('בחירת סרטון חלופי').setInputFiles(replacementFile);
  await expect(dialog.getByRole('alert').filter({ hasText: 'הסרטון הוחלף' })).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(640);
  await expect(page.locator('video')).toHaveAttribute('src', /replacement-token/);
  expect(state.data()).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem('caption-style:review-user:42'))).toBe(projectStyle);
  await page.screenshot({ path: 'test-results/replace-video-settings.png' });
  await dialog.getByRole('button', { name: 'סגירת הגדרות כתוביות' }).click();
  await expect(page.getByRole('button', { name: 'ביטול פעולה', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click(); await download;
  expect(state.burns).toHaveLength(1);
  expect(state.burns[0]).toMatch(/name="videoId"\r\n\r\n42/);
  expect(state.burns[0]).toMatch(/name="videoWidth"\r\n\r\n640/);
  expect(state.burns[0]).toContain('#ff0000');
  expect(state.burns[0]).toContain('שלום');
  await page.reload();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(640);
  await expect(page.locator('video')).toHaveAttribute('src', /replacement-token/);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3); expect(state.data()).toEqual(before);
});

test('failed upload retains the current source and captions; selecting the same file retries successfully', async ({ page }) => {
  const state = await setup(page); state.fail(true);
  const before = structuredClone(state.data()); const source = await page.locator('video').getAttribute('src');
  const dialog = await settings(page);
  await dialog.getByLabel('בחירת סרטון חלופי').setInputFiles(replacementFile);
  await expect(dialog.getByRole('alert')).toHaveText('העלאת הסרטון נכשלה לבדיקה');
  await expect(page.locator('video')).toHaveAttribute('src', source!); expect(state.data()).toEqual(before);
  state.fail(false); await dialog.getByLabel('בחירת סרטון חלופי').setInputFiles(replacementFile);
  await expect(dialog.getByRole('alert').filter({ hasText: 'הסרטון הוחלף' })).toBeVisible(); expect(state.count()).toBe(2); expect(state.data()).toEqual(before);
});

test('upload blocks another replacement and export until acknowledged; audio selection never uploads', async ({ page }) => {
  const state = await setup(page); const dialog = await settings(page);
  await dialog.getByLabel('בחירת סרטון חלופי').setInputFiles({ name: 'audio.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('audio') });
  await expect(dialog.getByRole('alert')).toHaveText('בחרו קובץ וידאו נתמך.'); expect(state.count()).toBe(0);
  let release!: () => void; state.hold(new Promise<void>(resolve => { release = resolve; }));
  await dialog.getByLabel('בחירת סרטון חלופי').setInputFiles(replacementFile);
  await expect(dialog.getByRole('button', { name: 'מחליף סרטון...' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'הורדה', exact: true, includeHidden: true })).toBeDisabled();
  await expect(page.locator('video')).toHaveAttribute('src', /original-token/);
  release(); await expect(dialog.getByRole('alert').filter({ hasText: 'הסרטון הוחלף' })).toBeVisible();
});
