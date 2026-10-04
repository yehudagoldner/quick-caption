import { test, expect, type Page } from '@playwright/test';
import { portraitVideo, segments } from './app-fixtures';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.config.metadata.environment !== 'qa', 'Run with playwright.qa.config.ts to test the QA base path.');
});

async function prepareQa(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  // Exercise the real AuthProvider and API gate; only the Firebase SDK and
  // remote APIs are mocked, so an incorrect sync URL cannot pass unnoticed.
  await page.route('**/src/client/firebase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const auth = {};' }));
  await page.route('**/firebase_auth.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const user = { uid: 'qa-upload-user', email: 'qa@example.com', displayName: 'QA upload', providerData: [], metadata: {}, getIdToken: async () => 'qa-test-token' };
    export class GoogleAuthProvider { setCustomParameters() {} }
    export function onAuthStateChanged(auth, callback) { queueMicrotask(() => callback(user)); return () => {}; }
    export const signInWithPopup = async () => ({user});
    export const signOut = async () => {};
  ` }));
  await page.routeWebSocket('**/socket.io/**', () => {});
  await page.route('**/api/**', route => route.fulfill({ json: { credits: 50, videos: [], isAdmin: false } }));
}

test('QA creates the account before sending its selected file and credit request', async ({ page }) => {
  await prepareQa(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const syncPaths: string[] = [];
  let synced = false;
  let uploads = 0;
  let credits = 0;
  await page.route('**/api/users/sync', async route => {
    syncPaths.push(new URL(route.request().url()).pathname);
    expect(route.request().headers().authorization).toBe('Bearer qa-test-token');
    await pending;
    synced = true;
    await route.fulfill({ json: { status: 'ok' } });
  });
  await page.route('**/api/users/credits?**', route => {
    expect(synced).toBe(true);
    expect(new URL(route.request().url()).pathname).toBe('/qa/api/users/credits');
    credits++;
    return route.fulfill({ json: { credits: 50 } });
  });
  await page.route('**/api/transcribe', route => {
    expect(synced).toBe(true);
    expect(new URL(route.request().url()).pathname).toBe('/qa/api/transcribe');
    expect(route.request().headers().authorization).toBe('Bearer qa-test-token');
    expect(route.request().postDataBuffer()!.length).toBeGreaterThan(portraitVideo.length);
    uploads++;
    return route.fulfill({ json: { videoId: 42, segments, words: [], subtitle: { format: '.srt', content: 'captions' } } });
  });
  await page.goto('/qa/?screen=transcription');
  await expect.poll(() => syncPaths.length).toBe(1);
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('בחירת קובץ', { exact: true }).click();
  await (await chooser).setFiles({ name: 'qa-upload.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await page.getByRole('button', { name: 'שלחו לעיבוד' }).click();
  expect(uploads).toBe(0);
  expect(credits).toBe(0);
  expect(syncPaths).toEqual(['/qa/api/users/sync']);
  release();
  await expect.poll(() => uploads).toBe(1);
  await expect.poll(() => credits).toBeGreaterThan(0);
  await expect(page.getByTestId('mobile-caption-editor')).toBeVisible();
});

test('failed QA account synchronization preserves the file and blocks upload', async ({ page }) => {
  await prepareQa(page);
  let uploads = 0;
  await page.route('**/api/users/sync', route => route.fulfill({ status: 500, json: { error: 'sync unavailable' } }));
  await page.route('**/api/transcribe', route => { uploads++; return route.abort(); });
  await page.goto('/qa/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: 'qa-upload.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await page.getByRole('button', { name: 'שלחו לעיבוד' }).click();
  await expect(page.getByRole('alert')).toContainText('לא ניתן לאמת את החשבון');
  await expect(page.getByRole('button', { name: 'שלחו לעיבוד' })).toBeEnabled();
  await expect(page.locator('video')).toBeVisible();
  expect(uploads).toBe(0);
});
