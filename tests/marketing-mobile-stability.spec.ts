import { test, expect, type Page } from '@playwright/test';
import { prepareApp } from './app-fixtures';

test.use({ hasTouch: true });

async function guest(page: Page) {
  await prepareApp(page);
  await page.route('**/src/client/contexts/AuthContext.tsx*', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'export const useAuth=()=>({user:null,loading:false,signIn:async()=>{},signOut:async()=>{}});export const AuthProvider=({children})=>children;',
  }));
}

for (const width of [360, 390, 430]) {
  test(`mobile ${width}: carousel navigation preserves page position`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await guest(page);
    await page.goto('/');
    await expect(page.locator('.marketing h1')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const label of ['מעבר בין סגנונות', 'מעבר בין יכולות']) {
      const dots = page.getByRole('group', { name: label });
      for (const y of [180, 640]) {
        for (const index of [2, 0]) {
          await dots.evaluate((el, top) => scrollTo(0, el.getBoundingClientRect().top + scrollY - top), y);
          await page.waitForTimeout(200);
          const before = await page.evaluate(() => scrollY);
          const button = dots.getByRole('button').nth(index);
          const box = (await button.boundingBox())!;
          await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
          await expect(button).toHaveAttribute('aria-current', 'true');
          expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(3);
        }
      }
    }
  });

  test(`mobile ${width}: seek bar allows vertical swipes and horizontal seeking`, async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Native touch injection uses CDP; WebKit layout and scroll stability are covered separately.');
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await guest(page);
    await page.goto('/');
    const slider = page.locator('#caption-demo [role="slider"]');
    await expect(slider).toBeAttached();
    await slider.evaluate(el => scrollTo(0, el.getBoundingClientRect().top + scrollY + el.getBoundingClientRect().height / 2 - 440));
    await page.waitForTimeout(200);
    const box = (await slider.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(await slider.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), point)).toBe(true);
    const before = await page.evaluate(() => scrollY);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - step * 12 }] });
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => await page.evaluate(() => scrollY) - before).toBeGreaterThan(60);
    // After the browser cancels the pointer for a vertical pan, seeking still works.
    await slider.scrollIntoViewIfNeeded();
    const next = (await slider.boundingBox())!;
    const start = { x: next.x + next.width * .2, y: next.y + next.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let step = 1; step <= 5; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + next.width * .1 * step, y: start.y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(6.5);
    await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow'))).toBeLessThan(7.5);
    await cdp.detach();
  });
}

test('real authentication loading keeps the mobile page mounted and scrolled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/src/client/devAuth.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const isDevAuthBypass=false;export const createDevAuthUser=()=>null;' }));
  await page.route('**/src/client/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const auth={};' }));
  await page.route('**/firebase_auth.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export class GoogleAuthProvider { setCustomParameters() {} }
    export const onAuthStateChanged=(_,cb)=>{window.finishInitialAuth=()=>cb(null);return()=>{};};
    export const signOut=async()=>{};
    export const signInWithPopup=()=>new Promise(resolve=>{window.finishSignIn=()=>resolve({user:{getIdToken:async()=>"test",uid:"test",providerData:[],metadata:{}}});});
  ` }));
  await page.route('**/api/**', route => route.fulfill({ json: { credits: 50, videos: [], isAdmin: false } }));
  await page.routeWebSocket('**/socket.io/**', () => {});
  await page.goto('/');
  await expect(page.locator('.marketing h1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'טוענים...', exact: true })).toBeDisabled();
  await page.waitForFunction(() => typeof (window as any).finishInitialAuth === 'function');
  await page.evaluate(() => (window as any).finishInitialAuth());
  const button = page.getByRole('button', { name: 'לסרטון הבא שלכם' });
  await button.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => { (window as any).originalMarketing = document.querySelector('.marketing'); return scrollY; });
  await button.click();
  await page.waitForFunction(() => typeof (window as any).finishSignIn === 'function');
  const stable = () => page.evaluate(() => document.querySelector('.marketing') === (window as any).originalMarketing && (window as any).originalMarketing.isConnected);
  expect(await stable()).toBe(true);
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(3);
  await page.evaluate(() => (window as any).finishSignIn());
  await expect(page.getByRole('button', { name: 'טוענים...', exact: true })).toHaveCount(0);
  expect(await stable()).toBe(true);
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(3);
});

test('demo playback updates captions without rendering the whole marketing page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await guest(page);
  await page.route('**/src/client/components/PromotionalHome.tsx*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    expect(body).toContain('const reducedMotion =');
    await route.fulfill({ response, body: body.replace('const reducedMotion =', 'window.homeRenders=(window.homeRenders||0)+1;const reducedMotion =') });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'צפו בדוגמה' }).click();
  await expect(page.locator('#caption-demo .qc-native-controls')).toHaveClass(/is-playing/);
  await page.waitForTimeout(700);
  const word = page.getByTestId('demo-caption').locator('[data-active-word]');
  const first = await word.innerText();
  await page.evaluate(() => { (window as any).homeRenders = 0; });
  await expect.poll(() => word.innerText()).not.toBe(first);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as any).homeRenders)).toBeLessThanOrEqual(2);
  await expect(page.locator('.marketing-aurora i').first()).toBeHidden();
  await expect(page.locator('.marketing-dock')).toHaveCSS('backdrop-filter', 'none');
});

test('repeated vertical scrolling suspends playback, preserves layout and resumes only when playing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await guest(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'צפו בדוגמה' }).click();
  await page.evaluate(() => document.fonts.ready);
  const slider = page.locator('#caption-demo [role="slider"]');
  await expect(page.locator('.marketing')).not.toHaveClass(/is-motion-paused/);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const height of [844, 740, 844]) {
    // Changing only the viewport height approximates toolbar expansion/collapse.
    // It does not emulate Safari's native toolbar or its GPU compositor.
    await page.setViewportSize({ width: 390, height });
    const samples = await page.evaluate(async () => {
      const root = document.querySelector('.marketing')!;
      const demo = document.querySelector('#caption-demo')!;
      const slider = demo.querySelector('[role="slider"]')!;
      const start = scrollY;
      const samples: { time: string | null; y: number; expected: number; top: number; height: number; mounted: boolean }[] = [];
      for (let index = 0; index < 14; index++) {
        const expected = start + (index % 2 ? 0 : 24);
        scrollTo({ top: expected, behavior: 'instant' });
        await new Promise(resolve => setTimeout(resolve, 65));
        const rect = demo.getBoundingClientRect();
        samples.push({ time: slider.getAttribute('aria-valuenow'), y: scrollY, expected,
          top: rect.top + scrollY, height: rect.height, mounted: document.querySelector('.marketing') === root && root.isConnected });
      }
      return samples;
    });
    expect(samples.every(sample => sample.mounted && Math.abs(sample.y - sample.expected) < 2), JSON.stringify(samples)).toBe(true);
    expect(Math.max(...samples.map(s => s.top)) - Math.min(...samples.map(s => s.top))).toBeLessThan(2);
    expect(Math.max(...samples.map(s => s.height)) - Math.min(...samples.map(s => s.height))).toBeLessThan(2);
    expect(new Set(samples.slice(2).map(s => s.time)).size).toBe(1);
    await expect(page.locator('.marketing')).not.toHaveClass(/is-motion-paused/);
    await expect.poll(() => slider.getAttribute('aria-valuenow')).not.toBe(samples.at(-1)!.time);
  }
  await page.getByTestId('demo-stage').click();
  const paused = await slider.getAttribute('aria-valuenow');
  await page.evaluate(() => scrollBy(0, 20));
  await expect(page.locator('.marketing')).not.toHaveClass(/is-motion-paused/);
  await page.waitForTimeout(300);
  await expect(slider).toHaveAttribute('aria-valuenow', paused!);
  expect(errors).toEqual([]);
});

test('touch layout avoids moving blur layers in portrait and landscape', async ({ page }) => {
  await guest(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.marketing h1')).toBeVisible();
    await expect(page.locator('.marketing-aurora i').first()).toBeHidden();
    await expect(page.locator('.marketing-demo-glow')).toHaveCSS('filter', 'none');
    await expect(page.locator('.marketing-marquee-row')).toHaveCSS('animation-name', 'none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(page.locator('#caption-demo [role="slider"]')).toHaveCSS('touch-action', 'pan-y');
  }
});
