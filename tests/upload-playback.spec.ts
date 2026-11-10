import { test, expect } from '@playwright/test';
import { prepareApp, portraitVideo, segments } from './app-fixtures';

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  for (const recovered of [false, true]) {
    test(`video stays playable during upload and pending previews at ${viewport.width}, recovered=${recovered}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await prepareApp(page);
      await page.addInitScript(() => {
        const send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(body) {
          if (body instanceof FormData && body.has('jobId')) (window as any).__uploadRequest = this;
          return send.call(this, body);
        };
      });
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const result = { videoId: 42, mediaToken: 'original-token', text: 'שלום עולם', segments,
        subtitle: { content: '1\n00:00:00,000 --> 00:00:02,000\nשלום עולם\n', format: '.srt' } };
      let completed = false;
      let previewReady = false;
      await page.route('**/api/transcribe', async route => {
        await gate;
        await route.fulfill({ json: result }).catch(() => {});
      });
      await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: completed
        ? { status: 'completed', result } : { status: 'processing' } }));
      await page.route('**/api/videos/42/preview', route => route.fulfill({ json: {
        mode: previewReady ? 'rendition' : 'pending', qualities: previewReady ? ['720p'] : [],
        defaultQuality: previewReady ? '720p' : null, sourceDimensions: { width: 180, height: 320 }, mediaToken: 'preview-token',
      } }));
      await page.route('**/api/videos/42/media?**', route => {
        const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), portraitVideo.length - 1) : portraitVideo.length - 1;
        return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: {
          'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}),
        }, body: portraitVideo.subarray(start, end + 1) });
      });
      try {
        await page.goto('/?screen=transcription');
        await page.locator('input[type=file]').setInputFiles({ name: 'portrait.webm', mimeType: 'video/webm', buffer: portraitVideo });
        const video = page.locator('video');
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
        const localUrl = await video.getAttribute('src');
        await video.evaluate(async (v: HTMLVideoElement) => {
          (window as any).__uploadPreview = v;
          v.muted = true; v.playbackRate = .1; v.currentTime = 1; await v.play();
        });
        await page.getByRole('button', { name: 'שלחו לעיבוד' }).click();
        await expect(page.getByRole('button', { name: 'מעבד...', exact: true })).toBeDisabled();
        await expect(video).toBeVisible();
        await expect(video).toHaveAttribute('src', localUrl!);
        expect(await video.evaluate((v: HTMLVideoElement) => v === (window as any).__uploadPreview && !v.paused)).toBe(true);
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1);
        await page.screenshot({ path: `test-results/upload-playing-${viewport.width}-${recovered}.png` });
        if (recovered) {
          completed = true;
          await page.evaluate(() => (window as any).__uploadRequest.upload.dispatchEvent(new ProgressEvent('load')));
        } else release();
        await expect(page.getByRole('button', { name: 'מעבד...', exact: true })).toHaveCount(0);
        await expect(video).toHaveCount(1);
        await expect(video).toHaveAttribute('src', /^blob:/);
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
        await video.evaluate(async (v: HTMLVideoElement) => { v.muted = true; v.playbackRate = .1; v.currentTime = 1; await v.play(); });
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1);
        if (recovered) await video.evaluate((v: HTMLVideoElement) => { v.pause(); v.currentTime = 1; });
        previewReady = true;
        await expect(video).toHaveAttribute('src', /preview=720p/, { timeout: 10_000 });
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(1);
        expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(recovered);
      } finally { release(); }
    });
  }
}
