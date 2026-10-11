import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit, devices } from 'playwright';

// Read-only guest checks against the existing QA environment; no account/API fixtures.
const url = 'https://quick-caption.com/qa/';
const output = 'tmp/marketing-scroll-qa';
await mkdir(output, { recursive: true });
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.locator('.marketing h1').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.marketing-aurora i').first().evaluate(el => getComputedStyle(el).display), 'none');
    assert.equal(await page.locator('.marketing-dock').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
    await page.screenshot({ path: `${output}/${name}-hero.png` });
    await page.getByRole('button', { name: 'צפו בדוגמה' }).click();
    await page.waitForFunction(() => !document.querySelector('.marketing').classList.contains('is-motion-paused'));
    const slider = page.locator('#caption-demo [role="slider"]');
    const initialTime = await slider.getAttribute('aria-valuenow');
    await page.waitForFunction(initial => document.querySelector('#caption-demo [role="slider"]').getAttribute('aria-valuenow') !== initial, initialTime);
    const samples = await page.evaluate(async () => {
      const main = document.querySelector('.marketing');
      const slider = document.querySelector('#caption-demo [role="slider"]');
      const base = scrollY;
      const samples = [];
      for (let i = 0; i < 20; i++) {
        const expected = base + (i % 2 ? 0 : 30);
        scrollTo({ top: expected, behavior: 'instant' });
        await new Promise(resolve => setTimeout(resolve, 65));
        samples.push({ expected, y: scrollY, time: slider.getAttribute('aria-valuenow'), mounted: main === document.querySelector('.marketing') });
      }
      return samples;
    });
    assert(samples.every(s => s.mounted && Math.abs(s.expected - s.y) < 2));
    assert.equal(new Set(samples.slice(2).map(s => s.time)).size, 1);
    await page.waitForFunction(previous => document.querySelector('#caption-demo [role="slider"]').getAttribute('aria-valuenow') !== previous, samples.at(-1).time);
    for (const selector of ['#styles', '#features', '#marketing-faq', '#marketing-title']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.marketing-aurora i').first().evaluate(el => getComputedStyle(el).display), 'none');
    await page.screenshot({ path: `${output}/${name}-landscape.png` });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: name, url, scrollSamples: samples.length, pageErrors: errors.length, passed: true }));
  } finally {
    await browser.close();
  }
}
