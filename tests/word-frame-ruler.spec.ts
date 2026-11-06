import { test, expect } from '@playwright/test';
import { prepareApp } from './app-fixtures';

for (const mobile of [false, true]) for (const fps of [24, 25, 60, 120]) {
  test(`word ruler shows absolute frames at ${fps} FPS (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 });
    await prepareApp(page);
    await page.addInitScript(fps => localStorage.setItem('caption-editor-preferences', JSON.stringify({ fps })), fps);
    const segment = { id: 1, start: 1.013, end: 3.413, text: 'שלום עולם' };
    const words = [{ word: 'שלום', start: segment.start, end: 2.2, segmentId: 1 }, { word: 'עולם', start: 2.2, end: segment.end, segmentId: 1 }];
    let saves = 0;
    await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: { id: 42, subtitle_json: [segment], words_json: words, format: '.srt', stored_path: 'portrait.mp4' } } }));
    await page.route('**/api/videos/update-subtitles', route => { saves++; return route.fulfill({ json: { success: true } }); });
    await page.goto('/?screen=edit&video=review-token');
    await expect.poll(() => page.locator('video').evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThan(0);
    if (mobile) {
      await page.getByRole('button', { name: 'עריכת כתובית: שלום עולם', exact: true }).click();
      await expect(page.locator('.MuiDialog-container')).toHaveCSS('opacity', '1');
    }
    else {
      await page.getByTestId('subtitle-clip').first().click();
      await page.getByRole('button', { name: 'מילה אקטיבית', exact: true }).click();
    }
    const track = page.getByTestId(mobile ? 'mobile-word-scroll' : 'word-track');
    await expect(track.getByTestId('word-frame-number').first()).toBeVisible();
    const zoom = page.getByRole('slider', { name: mobile ? 'זום ציר המילים' : 'זום מילים', exact: true });
    await zoom.focus(); await page.keyboard.press('End');
    const points = () => track.getByTestId('word-frame-tick').evaluateAll(nodes => nodes.map(node => ({
      frame: Number(node.getAttribute('data-frame')), time: Number(node.getAttribute('data-time')), x: node.getBoundingClientRect().x,
    })).sort((a, b) => a.frame - b.frame));
    let ticks: Awaited<ReturnType<typeof points>> = [];
    await expect.poll(async () => {
      ticks = await points(); const gap = ticks[1]?.x - ticks[0]?.x;
      return ticks.length > 2 && gap > 6 && ticks.every((tick, i) => i === 0 || tick.frame - ticks[i - 1].frame === 1 && Math.abs(tick.x - ticks[i - 1].x - gap) < .05);
    }).toBe(true);
    for (const tick of ticks) {
      expect(tick.time).toBeGreaterThanOrEqual(segment.start);
      expect(tick.time * fps).toBeCloseTo(tick.frame, 8);
    }
    const spacing = ticks[1].x - ticks[0].x;
    expect(spacing).toBeGreaterThan(6);
    for (let i = 2; i < ticks.length; i++) expect(ticks[i].x - ticks[i - 1].x).toBeCloseTo(spacing, 1);
    const scroller = mobile ? track : track.locator('.timeline-editor-edit-area .ReactVirtualized__Grid');
    await scroller.evaluate(el => { el.scrollLeft = 350; });
    await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(300);
    const visiblePoints = () => track.getByTestId('word-frame-tick').evaluateAll(nodes => nodes.map(node => ({
      time: Number(node.getAttribute('data-time')), x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y,
    })).filter(tick => tick.x > 160 && tick.x < 300));
    await expect.poll(async () => (await visiblePoints()).length).toBeGreaterThan(0);
    await expect.poll(async () => {
      const visible = await visiblePoints();
      const word = await track.getByTestId(mobile ? 'mobile-word-clip' : 'word-clip').first().boundingBox();
      const pixelsPerSecond = word!.width / (words[0].end - words[0].start);
      return Math.max(...visible.map(tick => Math.abs(tick.x - (word!.x + (tick.time - words[0].start) * pixelsPerSecond))));
    }).toBeLessThan(2);
    expect(saves).toBe(0);
    if (fps === 25) await page.screenshot({ path: `tmp/review/word-frame-ruler-${mobile ? 'mobile' : 'desktop'}.png` });
  });
}
