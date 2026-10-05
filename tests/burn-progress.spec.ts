import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { prepareApp, portraitVideo, testUid } from './app-fixtures';

mkdirSync('tmp/burn-progress', { recursive: true });
for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} burn popup shows actual progress, prevents closing and disappears after success or failure`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 });
    await prepareApp(page);
    await page.route('**/src/client/api.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `\nsetApiUser({ uid: '${testUid}', getIdToken: async () => 'burn-fixture-token' });` });
    });
    let release = () => {}, fail = false, jobId = '', progress = { stage: 'preparing', percent: null as number | null };
    const posts: string[] = [];
    let fileDownloads = 0;
    await page.route('**/api/videos/42/file?**', route => { fileDownloads++; return route.fulfill({ body: portraitVideo }); });
    await page.route('**/api/burn-subtitles/progress/*', route => {
      expect(route.request().url().split('/').pop()).toBe(jobId);
      expect(route.request().headers().authorization).toBe('Bearer burn-fixture-token');
      return route.fulfill({ json: progress });
    });
    await page.route('**/api/burn-subtitles', async route => {
      jobId = route.request().headers()['x-burn-job-id'];
      posts.push(route.request().postDataBuffer()!.toString());
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill(fail ? { status: 500, json: { error: 'כשל צריבה יזום לבדיקה' } }
        : { contentType: 'video/mp4', headers: { 'Access-Control-Expose-Headers': 'Content-Disposition', 'Content-Disposition': "attachment; filename*=UTF-8''%D7%91%D7%93%D7%99%D7%A7%D7%94.mp4" }, body: portraitVideo });
    });
    await page.goto('/?screen=edit&video=burn-test');
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
    const start = async () => {
      await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
      await page.getByRole(mobile ? 'button' : 'menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click();
    };
    const dialog = page.getByRole('dialog', { name: 'מכין את הסרטון עם הכתוביות' });
    try {
      await start();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('מכין את הסרטון לצריבה');
      await expect(dialog.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      progress = { stage: 'burning', percent: 57 };
      await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '57');
      await expect(dialog).toContainText('57%');
      await page.screenshot({ path: `tmp/burn-progress/${mobile ? 'mobile' : 'desktop'}.png` });
      progress = { stage: 'downloading', percent: 100 };
      await expect(dialog).toContainText('הצריבה הסתיימה');
      await expect(dialog.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
      const download = page.waitForEvent('download');
      release();
      expect((await download).suggestedFilename()).toBe('בדיקה.mp4');
      await expect(dialog).not.toBeVisible();
      expect(posts[0]).toMatch(/name="videoId"\r\n\r\n42\r\n/);
      expect(posts[0]).not.toMatch(/name="media"/);
      expect(fileDownloads).toBe(0);
      await page.getByRole('button', { name: 'אולי אחר כך' }).click();
      // A second burn tests failure cleanup and a fresh progress ID.
      const firstId = jobId;
      progress = { stage: 'preparing', percent: null }; fail = true;
      await page.reload();
      await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
      await start();
      await expect(dialog).toBeVisible();
      await expect.poll(() => posts.length).toBe(2);
      expect(jobId).not.toBe(firstId);
      release();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText('כשל צריבה יזום לבדיקה').first()).toBeVisible();
    } finally { release(); }
  });
}
