import { test, expect } from '@playwright/test';
import { prepareApp } from './app-fixtures';

test('admin shows lifetime upload/download counts per user and paginated customer feedback', async ({ page }) => {
  await prepareApp(page);
  await page.route('**/src/client/contexts/AuthContext.tsx*', route => route.fulfill({ contentType: 'application/javascript',
    body: `const user = { uid: 'admin', email: 'goldnery@gmail.com', displayName: 'Admin', getIdToken: async () => 'admin-token' };
      export const useAuth = () => ({ user, loading: false, signIn: async () => {}, signOut: async () => {} }); export const AuthProvider = ({children}) => children;` }));
  const pages: number[] = [];
  await page.route('**/api/admin/**', route => {
    expect(route.request().headers().authorization).toBe('Bearer admin-token');
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/session')) return route.fulfill({ json: { isAdmin: true } });
    if (url.pathname.endsWith('/overview')) return route.fulfill({ json: {
      revenue: { revenueUSD: 0, payments: 0 }, users: { total: 1, free: 1, paying: 0 },
      media: { processed: 5, videos: 4, edited: 2, durationSeconds: 60 },
      usage: { costUSD: 0, calls: 0, inputTokens: 0, outputTokens: 0, unpriced: 0, trackingSince: null }, models: [], admins: [], audit: [],
      uploads: { total: 9, videos: 7, audio: 2 }, downloads: { total: 34, videos: 12, subtitles: 22, uniqueVideos: 6, trackingSince: '2026-10-04' },
      feedback: { count: 3, averageRating: 4.7 },
    } });
    if (url.pathname.endsWith('/users')) return route.fulfill({ json: { users: [{
      uid: 'customer', email: 'customer@example.com', displayName: 'Customer', credits: 50, createdAt: '2026-10-01', paying: false, admin: false,
      uploadedVideos: 2, downloadedVideos: 2, videoDownloads: 5, subtitleDownloads: 11, averageRating: 4.5,
    }], total: 1, page: 0 } });
    if (url.pathname.endsWith('/feedback')) {
      const page = Number(url.searchParams.get('page')); pages.push(page);
      return route.fulfill({ json: { feedback: Array.from({ length: page === 0 ? 25 : 1 }, (_, index) => ({
        id: `download-${page * 25 + index}`, rating: 4, feedback: `חוויה טובה ${page * 25 + index}\nתודה!`, createdAt: '2026-10-04T10:00:00Z',
        videoId: 42, email: 'customer@example.com', displayName: 'Customer', filename: 'ראיון.mp4',
      })), total: 26, page, pageSize: 25 } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/admin');
  await expect(page.locator('.MuiCard-root').filter({ has: page.getByText('הורדות סרטון', { exact: true }) }).getByText('12', { exact: true })).toBeVisible();
  await expect(page.locator('.MuiCard-root').filter({ has: page.getByText('הורדות כתוביות', { exact: true }) }).getByText('22', { exact: true })).toBeVisible();
  await expect(page.getByText('4.7/5', { exact: true })).toBeVisible();
  const user = page.getByRole('row').filter({ hasText: 'customer@example.com' });
  for (const [index, value] of [[4, '2'], [5, '52 סרטונים שונים'], [6, '11'], [7, '4.5/5']] as const) await expect(user.getByRole('cell').nth(index)).toHaveText(value);
  expect(pages).toEqual([]);
  await page.getByRole('tab', { name: 'דירוגים ופידבק' }).click();
  const panel = page.locator('#admin-feedback-panel');
  await expect(panel.getByRole('row')).toHaveCount(26);
  await expect(panel.getByText('חוויה טובה 0\nתודה!', { exact: true })).toHaveCSS('white-space', 'pre-wrap');
  await panel.getByRole('button', { name: 'הבא', exact: true }).click();
  await expect(panel.getByRole('row')).toHaveCount(2);
  await expect(panel.getByText('חוויה טובה 25\nתודה!', { exact: true })).toBeVisible();
  expect(pages).toEqual([0, 1]);
  await page.getByRole('button', { name: 'רענון', exact: true }).click();
  await expect(panel.getByRole('row')).toHaveCount(26); expect(pages).toEqual([0, 1, 0]);
  await page.screenshot({ path: 'tmp/review/admin-download-feedback.png', fullPage: true });
});
