import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo } from './app-fixtures';

async function openLongRecording(page: Page, mobile = false) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 });
  await page.goto('/tests/editor-harness.html');
  await page.getByRole('button', { name: 'בדיקת ציר ארוך — 90 שניות', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
  const slider = page.getByRole('slider', { name: 'מיקום בהקלטה', exact: true });
  await slider.scrollIntoViewIfNeeded();
  return { slider, rail: slider };
}

test('seeking through the recording exits a selected-caption loop', async ({ page }) => {
  const { slider, rail } = await openLongRecording(page);
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByRole('button', { name: 'נגן מקטע בלולאה', exact: true }).click();
  const rect = (await rail.boundingBox())!;
  await page.mouse.click(rect.x + rect.width * .75, rect.y + rect.height / 2);
  await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(60);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(60);
  await expect(page.getByRole('button', { name: 'נגן מקטע בלולאה', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('mobile drag previews its position before release and captures movement outside the rail', async ({ page }) => {
  const { slider, rail } = await openLongRecording(page, true);
  const rect = (await rail.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * .1, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .7, rect.y + rect.height / 2, { steps: 10 });
  await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeCloseTo(63, 0);
  await page.mouse.move(rect.x + rect.width * .4, rect.y - 40);
  await page.mouse.up();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(36, 0);
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
});

test('dragging pauses playback until release, then resumes from the final position', async ({ page }) => {
  const { rail } = await openLongRecording(page);
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.play());
  const rect = (await rail.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * .2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .8, rect.y + rect.height / 2, { steps: 15 });
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await page.mouse.up();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(71);
  await expect(page.getByTestId('save-count')).toHaveText('שמירות בדיקה: 0');
});

test('mobile recording bar supports keyboard navigation to both ends', async ({ page }) => {
  const { slider } = await openLongRecording(page, true);
  await slider.focus();
  await page.keyboard.press('End');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(90);
  await page.keyboard.press('Home');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(1 / 24, 2);
});

test('rapid pointer updates coalesce preview seeks and release commits the latest position', async ({ page }) => {
  const { slider } = await openLongRecording(page);
  await page.locator('video').evaluate(video => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
    (window as any).seekWrites = [];
    Object.defineProperty(video, 'currentTime', {
      get() { return descriptor.get!.call(video); },
      set(time) { (window as any).seekWrites.push(time); descriptor.set!.call(video, time); },
    });
  });
  const rect = (await slider.boundingBox())!;
  await slider.evaluate(el => el.addEventListener('pointerdown', event => { (window as any).dragPointer = (event as PointerEvent).pointerId; }, { once: true }));
  await page.mouse.move(rect.x + rect.width * .1, rect.y + rect.height / 2);
  await page.mouse.down();
  await slider.evaluate(el => {
    const rect = el.getBoundingClientRect();
    for (let index = 0; index < 100; index++) {
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: (window as any).dragPointer,
        clientX: rect.left + rect.width * (.2 + index / 200), clientY: rect.top + rect.height / 2, buttons: 1, isPrimary: true }));
    }
    (window as any).burstSeekCount = (window as any).seekWrites.length;
  });
  expect(await page.evaluate(() => (window as any).burstSeekCount)).toBeLessThanOrEqual(2);
  await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeCloseTo(62.55, 1);
  await page.mouse.move(rect.x + rect.width * .9, rect.y + rect.height / 2);
  await page.mouse.up();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(81);
  // No old preview request may run after the final seek.
  await page.waitForTimeout(150);
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(81);
});

test('real touch cancellation releases the drag and the next touch works', async ({ page, context }) => {
  const { slider } = await openLongRecording(page, true);
  const rect = (await slider.boundingBox())!;
  const client = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', fraction = .1) => client.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: rect.x + rect.width * fraction, y: rect.y + rect.height / 2 }],
  });
  await touch('touchStart');
  await touch('touchMove', .6);
  await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeCloseTo(54, 0);
  await touch('touchCancel');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(54, 0);
  await touch('touchStart', .2);
  await touch('touchMove', .8);
  await touch('touchEnd');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(72, 0);
});

test('the latest seek made before media metadata loads is retained', async ({ page }) => {
  await prepareApp(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/videos/42/media?**', async route => {
    await pending;
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), portraitVideo.length - 1) : portraitVideo.length - 1;
    await route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm',
      headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}) },
      body: portraitVideo.subarray(start, end + 1) });
  });
  await page.goto('/?screen=edit&video=review-token');
  const slider = page.getByRole('slider', { name: 'מיקום בהקלטה', exact: true });
  await slider.click({ position: { x: (await slider.boundingBox())!.width * .75, y: 15 } });
  await expect(slider).toHaveAttribute('aria-valuenow', '3');
  await slider.click({ position: { x: (await slider.boundingBox())!.width * .25, y: 15 } });
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  release();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(1, 1);
});

test('a slow media seek leaves the thumb responsive and release wins over pending previews', async ({ page }) => {
  const { slider } = await openLongRecording(page);
  const rect = (await slider.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * .1, rect.y + rect.height / 2);
  await page.mouse.down();
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(9);
  // Hold the media's seeking flag to simulate decoding/network delay. The
  // actual currentTime setter and the rest of the media player remain native.
  await page.locator('video').evaluate(video => Object.defineProperty(video, 'seeking', { configurable: true, get: () => true }));
  await page.mouse.move(rect.x + rect.width * .6, rect.y + rect.height / 2, { steps: 10 });
  await expect(slider).toHaveAttribute('aria-valuenow', '54');
  await page.waitForTimeout(150);
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(9);
  await page.mouse.move(rect.x + rect.width * .8, rect.y + rect.height / 2);
  await page.mouse.up();
  await page.locator('video').evaluate(video => { delete (video as any).seeking; });
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(72);
  await page.waitForTimeout(150);
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(72);
});
