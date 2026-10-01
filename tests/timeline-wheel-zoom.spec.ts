import { test, expect, type Locator, type Page } from '@playwright/test';
import { prepareApp } from './app-fixtures';

async function open(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepareApp(page);
  const saves: unknown[] = [];
  await page.route('**/api/videos/update-subtitles', route => { saves.push(route.request().postDataJSON()); return route.fulfill({ json: { success: true } }); });
  await page.goto('/?screen=edit&video=review-token');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  return saves;
}

async function wheel(page: Page, track: Locator, delta: number, ctrl = true, fraction = .6) {
  const rect = (await track.boundingBox())!;
  await page.mouse.move(rect.x + rect.width * fraction, rect.y + 50);
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.wheel(0, delta);
  if (ctrl) await page.keyboard.up('Control');
}

async function timeAtPointer(track: Locator, fraction = .6) {
  return track.evaluate((el, fraction) => {
    const editor = el.querySelector('.timeline-editor')!;
    const grid = el.querySelector('.timeline-editor-edit-area .ReactVirtualized__Grid')!;
    const action = el.querySelector<HTMLElement>('.timeline-editor-action')!;
    const clip = action.querySelector<HTMLElement>('[data-testid="subtitle-clip"]')!;
    const scale = action.getBoundingClientRect().width / (Number(clip.dataset.end) - Number(clip.dataset.start));
    return (grid.scrollLeft + el.getBoundingClientRect().width * fraction + el.getBoundingClientRect().left - editor.getBoundingClientRect().left - 20) / scale;
  }, fraction);
}

test('Ctrl+wheel zooms the main track around the pointer without changing playback, captions or page zoom', async ({ page }) => {
  const saves = await open(page);
  const track = page.getByTestId('caption-track');
  const slider = page.getByRole('slider', { name: 'זום ציר ראשי' });
  const pointerTime = await timeAtPointer(track);
  const pageScale = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, viewport: visualViewport?.scale }));
  const clips = await page.getByTestId('subtitle-clip').evaluateAll(els => els.map(el => [el.getAttribute('data-start'), el.getAttribute('data-end')]));
  const time = await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime);
  await wheel(page, track, -120);
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(0);
  await expect.poll(() => timeAtPointer(track)).toBeCloseTo(pointerTime, 2);
  await wheel(page, track, -120);
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(15);
  await expect.poll(() => timeAtPointer(track)).toBeCloseTo(pointerTime, 2);
  await wheel(page, track, 120);
  await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(15);
  await expect.poll(() => timeAtPointer(track)).toBeCloseTo(pointerTime, 2);
  expect(await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, viewport: visualViewport?.scale }))).toEqual(pageScale);
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(time);
  expect(await page.getByTestId('subtitle-clip').evaluateAll(els => els.map(el => [el.getAttribute('data-start'), el.getAttribute('data-end')]))).toEqual(clips);
  expect(saves).toHaveLength(0);
  await page.screenshot({ path: 'tmp/review/timeline-wheel-zoom.png' });
});

test('word track zoom is independent, keeps word selection and works again after hiding the track', async ({ page }) => {
  const saves = await open(page);
  await page.getByTestId('subtitle-clip').first().click();
  const toggle = page.getByRole('button', { name: 'מילה אקטיבית', exact: true });
  await toggle.click();
  const words = page.getByTestId('word-clip');
  await expect(words).toHaveCount(2);
  await words.first().click(); await words.last().click({ modifiers: ['Control'] });
  const track = page.getByTestId('word-track');
  const slider = page.getByRole('slider', { name: 'זום מילים' });
  const main = await page.getByRole('slider', { name: 'זום ציר ראשי' }).inputValue();
  await wheel(page, track, -120);
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(160);
  const zoom = Number(await slider.inputValue());
  await wheel(page, track, 120);
  await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(zoom);
  await expect(page.locator('[data-testid="word-clip"][aria-pressed="true"]')).toHaveCount(2);
  await expect(page.getByTestId('subtitle-clip').first()).toHaveCSS('background-color', 'rgb(46, 125, 50)');
  await expect(page.getByRole('slider', { name: 'זום ציר ראשי' })).toHaveValue(main);
  await toggle.click(); await expect(track).toHaveCount(0); await toggle.click();
  await wheel(page, track, -120);
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(160);
  expect(saves).toHaveLength(0);
});

test('plain scrolling leaves zoom alone and Ctrl+wheel respects limits and cancels the browser default', async ({ page }) => {
  await open(page);
  const track = page.getByTestId('caption-track');
  const slider = page.getByRole('slider', { name: 'זום ציר ראשי' });
  await wheel(page, track, -120, false);
  await expect(slider).toHaveValue('0');
  const cancelled = await track.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return !el.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 100, deltaMode: 1, cancelable: true, bubbles: true, clientX: rect.x + 100 }));
  });
  expect(cancelled).toBe(true); await expect(slider).toHaveValue('0');
  await track.evaluate(el => {
    const rect = el.getBoundingClientRect();
    for (let i = 0; i < 20; i++) el.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, deltaMode: 1, cancelable: true, bubbles: true, clientX: rect.x + 100 }));
  });
  await expect(slider).toHaveValue(await slider.getAttribute('max') as string);
  await track.evaluate(el => {
    const rect = el.getBoundingClientRect();
    for (let i = 0; i < 20; i++) el.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 100, deltaMode: 2, cancelable: true, bubbles: true, clientX: rect.x + 100 }));
  });
  await expect(slider).toHaveValue('0');
});
