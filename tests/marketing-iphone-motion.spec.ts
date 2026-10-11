import { test, expect } from '@playwright/test';
import { prepareApp } from './app-fixtures';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
for (const [name, agent] of [
  ['Safari', `${iphone} Version/18.0 Mobile/15E148 Safari/604.1`],
  ['Chrome', `${iphone} CriOS/130.0.0.0 Mobile/15E148 Safari/604.1`],
]) {
  test.describe(`iPhone ${name}`, () => {
    test.use({ userAgent: agent, hasTouch: true, viewport: { width: 384, height: 848 } });

    test('keeps the signed-in home static until explicit playback, including after scroll and rotation', async ({ page, context, browserName }) => {
      await prepareApp(page);
      await page.goto('/');
      const home = page.locator('.marketing');
      const slider = page.locator('#caption-demo [role="slider"]');
      await expect(home).toHaveClass(/is-static-motion/);
      await page.evaluate(() => document.fonts.ready);
      const initialTime = await slider.getAttribute('aria-valuenow');

      for (const viewport of [{ width: 384, height: 848 }, { width: 848, height: 384 }]) {
        await page.setViewportSize(viewport);
        await page.locator('#caption-demo').scrollIntoViewIfNeeded();
        await page.waitForTimeout(650);
        await expect(slider).toHaveAttribute('aria-valuenow', initialTime!);
        await expect(slider).toHaveAttribute('aria-disabled', 'true');
        expect(await slider.getAttribute('tabindex')).toBeNull();
        await slider.scrollIntoViewIfNeeded();
        const box = (await slider.boundingBox())!;
        const y = box.y + box.height / 2;
        await page.touchscreen.tap(box.x + box.width * .7, y);
        await page.mouse.move(box.x + box.width * .2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * .8, y, { steps: 8 });
        await page.mouse.up();
        await expect(slider).not.toBeFocused();
        // The keyboard handler must also ignore synthetic accessibility input.
        await slider.dispatchEvent('keydown', { key: 'End' });
        await expect(slider).toHaveAttribute('aria-valuenow', initialTime!);
        if (browserName === 'chromium' && viewport.width === 384) {
          await slider.evaluate(el => scrollTo({ top: el.getBoundingClientRect().top + scrollY - 440, behavior: 'instant' }));
          await page.waitForTimeout(200);
          const touchBox = (await slider.boundingBox())!;
          const point = { x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 };
          const before = await page.evaluate(() => scrollY);
          const cdp = await context.newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
          for (let step = 1; step <= 10; step++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - step * 12 }] });
            await page.waitForTimeout(20);
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await expect.poll(async () => await page.evaluate(() => scrollY) - before).toBeGreaterThan(60);
          await expect(slider).toHaveAttribute('aria-valuenow', initialTime!);
          await cdp.detach();
        }
        expect(await home.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
        await expect(page.locator('.marketing-primary').first()).toHaveCSS('transition-duration', '0s');
        await page.locator('#styles').scrollIntoViewIfNeeded();
        const styles = await page.locator('.marketing-look-frame').allTextContents();
        await page.waitForTimeout(700);
        expect(await page.locator('.marketing-look-frame').allTextContents()).toEqual(styles);
      }

      await page.setViewportSize({ width: 384, height: 848 });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForTimeout(250);
      // The supplied recording shows this benefits row alternating between one
      // and two lines and shifting the phone mockup. Sample actual geometry.
      const samples = await page.evaluate(async () => {
        const samples: number[][] = [];
        for (let i = 0; i < 12; i++) {
          samples.push(['.marketing-benefits', '#caption-demo'].flatMap(selector => {
            const box = document.querySelector(selector)!.getBoundingClientRect();
            return [box.top + scrollY, box.height];
          }));
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return samples;
      });
      for (const sample of samples) expect(sample).toEqual(samples[0]);

      // Applying a style should not silently start the stopped clock.
      await page.getByRole('button', { name: 'צהוב בולט: נסו בעורך' }).click();
      await page.waitForTimeout(600);
      await expect(slider).toHaveAttribute('aria-valuenow', initialTime!);
      await expect(page.getByTestId('demo-caption')).toHaveCSS('color', 'rgb(255, 225, 77)');
      await page.getByRole('button', { name: 'צפו בדוגמה' }).click();
      await expect.poll(() => slider.getAttribute('aria-valuenow')).not.toBe(initialTime);
      await page.getByTestId('demo-stage').click();
      const paused = await slider.getAttribute('aria-valuenow');
      await page.locator('#styles').scrollIntoViewIfNeeded();
      await page.locator('#caption-demo').scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await expect(slider).toHaveAttribute('aria-valuenow', paused!);
    });
  });
}

test.describe('Android control', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', hasTouch: true, viewport: { width: 390, height: 844 } });
  test('retains automatic demo playback', async ({ page }) => {
    await prepareApp(page);
    await page.goto('/');
    await expect(page.locator('.marketing')).not.toHaveClass(/is-static-motion/);
    await page.locator('#caption-demo').scrollIntoViewIfNeeded();
    const slider = page.locator('#caption-demo [role="slider"]');
    const before = await slider.getAttribute('aria-valuenow');
    await expect.poll(() => slider.getAttribute('aria-valuenow')).not.toBe(before);
  });
});
