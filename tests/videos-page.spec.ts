import { test, expect } from '@playwright/test';
import { prepareApp } from './app-fixtures';
import { readFileSync, mkdirSync } from 'node:fs';

const projects = [
  { id: 42, original_filename: 'ראיון סופי.mp4', status: 'completed', has_subtitles: true, media_type: 'video', duration_seconds: 28, size_bytes: 3_000_000, created_at: '2026-10-02T10:23:00' },
  { id: 43, original_filename: 'Podcast.M4A', status: 'processing', has_subtitles: false, media_type: 'audio', duration_seconds: 63, size_bytes: 2_000_000, created_at: '2026-10-01T10:23:00' },
  { id: 44, original_filename: 'failed.mp4', status: 'failed', has_subtitles: false, media_type: 'video', duration_seconds: 19, size_bytes: 1_000_000, created_at: '2026-09-27T10:23:00' },
];

mkdirSync('tmp/history-thumbnails', { recursive: true });
for (const width of [1920, 390]) {
  test(`Bunny thumbnails load on ${width}px with audio and failed-image fallbacks`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1080 });
    await prepareApp(page);
    const withThumbnails = projects.map(p => ({ ...p, thumbnail_url: `/api/videos/${p.id}/thumbnail?thumbnailToken=fixture` }));
    await page.route('**/api/videos?**', route => route.fulfill({ json: { videos: withThumbnails } }));
    let imageRequests = 0, audioRequests = 0;
    await page.route('**/api/videos/42/thumbnail?**', route => {
      imageRequests++;
      return route.fulfill({ contentType: 'image/webp', body: readFileSync('public/demo/creator.webp') });
    });
    await page.route('**/api/videos/43/thumbnail?**', route => { audioRequests++; return route.fulfill({ status: 404 }); });
    await page.route('**/api/videos/44/thumbnail?**', route => route.fulfill({ status: 404 }));
    await page.goto('/?screen=videos');
    const cards = page.getByRole('list', { name: 'רשימת הסרטונים' }).getByRole('listitem');
    await expect(cards).toHaveCount(3);
    const thumbnail = cards.first().getByRole('img', { name: 'תמונה מקדימה של ראיון סופי' });
    await expect(thumbnail).toHaveAttribute('loading', 'lazy');
    await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(thumbnail).toHaveCSS('opacity', '1');
    await expect(thumbnail).toHaveCSS('object-fit', 'cover');
    await expect(cards.first().getByText('0:28', { exact: true })).toBeVisible();
    await expect(cards.nth(1).locator('img')).toHaveCount(0);
    await expect(cards.nth(2).locator('img')).toHaveCount(0);
    expect(imageRequests).toBe(1); expect(audioRequests).toBe(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.screenshot({ path: `tmp/history-thumbnails/history-${width}.png`, fullPage: true });
    // Clicking the frame keeps the existing open-project action.
    const opened = page.waitForRequest('**/api/videos/42/token?**');
    await cards.first().getByRole('button', { name: 'פתיחת ראיון סופי.mp4' }).click();
    await opened;
  });
}

test('history search and status filters combine and clear correctly', async ({ page }) => {
  await prepareApp(page);
  await page.route('**/api/videos?**', route => route.fulfill({ json: { videos: projects } }));
  await page.goto('/?screen=videos');
  const cards = page.getByRole('list', { name: 'רשימת הסרטונים' }).getByRole('listitem');
  await expect(cards).toHaveCount(3);
  await page.getByRole('textbox', { name: 'חיפוש סרטונים' }).fill('podCAST');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Podcast');
  await page.getByRole('button', { name: /^מוכנים/ }).click();
  await expect(page.getByText('לא נמצאו סרטונים שתואמים לחיפוש')).toBeVisible();
  await page.getByRole('button', { name: 'ניקוי הסינון' }).click();
  await expect(cards).toHaveCount(3);
  await page.getByRole('button', { name: /^נכשלו/ }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('failed');
  await expect(cards.first().getByRole('button', { name: 'המשך עריכה' })).toHaveCount(0);
});

for (const width of [1920, 390]) {
  test(`history cards fit ${width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1080 });
    await prepareApp(page);
    await page.route('**/api/videos?**', route => route.fulfill({ json: { videos: projects } }));
    await page.goto('/?screen=videos');
    await expect(page.getByRole('heading', { name: 'הסרטונים שלי', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'רשימת הסרטונים' }).getByRole('listitem')).toHaveCount(3);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.screenshot({ path: `tmp/history-deploy/history-${width}.png`, fullPage: true });
  });
}

test('history load failure can be retried without reloading the app', async ({ page }) => {
  await prepareApp(page);
  let attempts = 0;
  await page.route('**/api/videos?**', route => ++attempts === 1
    ? route.fulfill({ status: 500, json: { error: 'fixture error' } })
    : route.fulfill({ json: { videos: projects } }));
  await page.goto('/?screen=videos');
  await expect(page.getByText('טעינת הפרויקטים נכשלה. בדקו את החיבור ונסו שוב.')).toBeVisible();
  await page.getByRole('button', { name: 'נסו שוב' }).click();
  await expect(page.getByRole('list', { name: 'רשימת הסרטונים' }).getByRole('listitem')).toHaveCount(3);
  expect(attempts).toBe(2);
});
