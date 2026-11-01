import { test, expect } from '@playwright/test';
import { prepareApp, portraitVideo, testUid } from './app-fixtures';

// A realistic project: many captions with word timings. Re-rendering the whole
// editor on every pointer move took over a second per move on a throttled CPU.
const segments = [{ id: 1, start: 0, end: 2, text: 'שלום עולם ומה שלומכם היום' },
  ...Array.from({ length: 199 }, (_, i) => ({ id: i + 2, start: 2 + i * .01, end: 2 + (i + 1) * .01, text: `כתובית מספר ${i + 2} לבדיקה` }))];
const words = segments.flatMap(s => s.text.split(' ').map((word, wordIndex, all) => ({ word, wordIndex, segmentId: s.id,
  start: s.start + (s.end - s.start) * wordIndex / all.length, end: s.start + (s.end - s.start) * (wordIndex + 1) / all.length })));

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
test('caption drag stays responsive on a phone-speed CPU with a long project', async ({ page }) => {
  test.setTimeout(90000);
  await prepareApp(page);
  await page.route('**/src/client/api.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `\nsetApiUser({ uid: '${testUid}', getIdToken: async () => 'perf-token' });` });
  });
  await page.route('**/api/videos/42/media?**', route => route.fulfill({ contentType: 'video/webm', body: portraitVideo }));
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: segments, words_json: words, format: '.srt', stored_path: 'p.mp4' } } }));
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  const caption = page.getByTestId('caption-position');
  const before = (await caption.boundingBox())!;
  const x = before.x + before.width / 2, y = before.y + before.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
  const durations: number[] = [];
  for (let i = 1; i <= 10; i++) {
    const started = Date.now();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x + i * 8, y: y - i * 8 }] });
    durations.push(Date.now() - started);
  }
  const moved = (await caption.boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(moved.x - before.x).toBeCloseTo(80, 0);
  durations.sort((a, b) => a - b);
  expect(durations[5], `touchmove durations: ${durations.join(',')}`).toBeLessThan(300);
  const panel = page.getByRole('region', { name: 'עיצוב כתובית נבחרת', exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: 'מיקום' }).tap();
  expect(Number(await panel.getByRole('slider', { name: 'מיקום אופקי', exact: true }).inputValue())).toBeGreaterThan(50);
});
