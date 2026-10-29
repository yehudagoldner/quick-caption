import { test, expect, type Page } from '@playwright/test';
import { prepareApp } from './app-fixtures';

// Real decoded stereo audio: silence on the left, two known bursts on the right.
function recording() {
  const rate = 8000, seconds = 8, channels = 2, size = rate * seconds * channels * 2;
  const wav = Buffer.alloc(44 + size);
  wav.write('RIFF'); wav.writeUInt32LE(36 + size, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(size, 40);
  for (let i = 0; i < rate * seconds; i++) {
    const time = i / rate;
    if (time >= 1 && time < 1.2 || time >= 3 && time < 3.2) wav.writeInt16LE(Math.round(Math.sin(i * .2) * 26000), 44 + i * 4 + 2);
  }
  return wav;
}

async function open(page: Page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepareApp(page);
  const audio = recording(), saves: unknown[] = [];
  let downloads = 0;
  await page.route('**/api/videos/42/media?**', route => {
    downloads++;
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav',
      headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}) }, body: audio.subarray(start, end + 1) });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: {
    id: 42, subtitle_json: [{ id: 1, start: 1, end: 1.4, text: 'אחת' }, { id: 2, start: 3, end: 3.4, text: 'שתיים' }],
    words_json: [], format: '.srt', stored_path: 'recording.mp4',
  } } }));
  await page.route(/\/api\/videos\/(?:42\/subtitles|update-subtitles)$/, route => { saves.push(route.request().postDataJSON()); return route.fulfill({ json: { success: true } }); });
  await page.goto('/?screen=edit&video=review-token');
  await expect(page.getByTestId('audio-waveform')).toBeVisible();
  return { saves, downloads: () => downloads };
}

test('decoded waveform shares caption geometry through zoom, scrolling, seeking, resizing and hiding', async ({ page }) => {
  const state = await open(page);
  const track = page.getByTestId('caption-track');
  const wave = page.getByTestId('audio-waveform');
  const caption = page.getByTestId('subtitle-clip').first();
  const alignment = () => page.evaluate(() => {
    const wave = document.querySelector<SVGSVGElement>('[data-testid="audio-waveform"]')!;
    const caption = document.querySelector<HTMLElement>('[data-testid="subtitle-clip"]')!;
    const firstPeak = Number(wave.querySelector('path')!.getAttribute('d')!.match(/^M([\d.]+)/)![1]);
    const a = wave.getBoundingClientRect(), b = caption.getBoundingClientRect();
    const pixelsPerSecond = b.width / (Number(caption.dataset.end) - Number(caption.dataset.start));
    // Decoding resamples the PCM and peak bins cover 5 ms, plus one drawn pixel.
    return { excess: Math.abs(a.x + firstPeak - b.x) - (.005 * pixelsPerSecond + 1), below: a.y >= b.bottom, height: a.height };
  });
  expect(await track.locator('.timeline-editor-edit-area [data-testid="audio-waveform"]').count()).toBe(1);
  expect((await alignment()).below).toBe(true);
  expect((await alignment()).height).toBe(32);
  expect((await alignment()).excess).toBeLessThan(0);
  await page.getByRole('slider', { name: 'זום ציר ראשי', exact: true }).fill('50');
  await expect.poll(async () => (await alignment()).excess).toBeLessThan(0);
  const grid = track.locator('.timeline-editor-edit-area .ReactVirtualized__Grid');
  await grid.evaluate(el => { el.scrollLeft = 80; el.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => grid.evaluate(el => el.scrollLeft)).toBe(80);
  await expect.poll(async () => (await alignment()).excess).toBeLessThan(0);
  const clipBox = (await caption.boundingBox())!, waveBox = (await wave.boundingBox())!;
  const scale = clipBox.width / .4;
  await page.mouse.click(clipBox.x + .1 * scale, waveBox.y + 16);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1.1, 1);
  expect(state.saves).toHaveLength(0);
  // Drag the caption end onto the end of the known speech burst.
  await caption.click();
  const handle = caption.locator('..').locator('.timeline-editor-action-right-stretch');
  await handle.hover();
  // Virtualized rows temporarily ignore pointer events while scroll settles.
  await expect.poll(() => handle.evaluate(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
  const rect = (await handle.boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 - .2 * scale, rect.y + rect.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => state.saves.length).toBeGreaterThan(0);
  await expect.poll(async () => Number(await caption.getAttribute('data-end'))).toBeCloseTo(1.2, 1);
  await expect.poll(async () => (await alignment()).excess).toBeLessThan(0);
  const requests = state.downloads();
  await page.getByRole('button', { name: 'סגור גל קול', exact: true }).click();
  await expect(wave).toHaveCount(0);
  await page.getByRole('button', { name: 'הצג גל קול', exact: true }).click();
  await expect(wave).toBeVisible();
  expect(state.downloads()).toBe(requests);
  await expect.poll(async () => (await alignment()).excess).toBeLessThan(0);
  await page.screenshot({ path: 'test-results/timeline-waveform.png' });
});
