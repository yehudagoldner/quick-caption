import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo, segments, testUid } from './app-fixtures';

const originalFilename = 'ראיון סופי.גרסה 2.webm';
const expectedFilename = 'ראיון סופי.גרסה 2_subtitle.srt';
const result = {
  text: 'שלום עולם', originalFilename, videoId: 42, segments, words: [],
  subtitle: { format: '.srt', content: '1\n00:00:00,000 --> 00:00:02,000\nשלום עולם\n' },
};

async function downloadFromEditor(page: Page, mobile = false) {
  await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole(mobile ? 'link' : 'menuitem', { name: 'הורד קובץ כתוביות', exact: true }).click();
  return downloaded;
}

for (const mobile of [false, true]) {
  test(`reopened ${mobile ? 'mobile' : 'desktop'} editor downloads subtitles with the original name`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 });
    await prepareApp(page);
    await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: {
      id: 42, original_filename: originalFilename, subtitle_json: segments,
      words_json: [], format: '.srt', stored_path: 'portrait.mp4',
    } } }));
    await page.goto('/?screen=edit&video=review-token');
    expect((await downloadFromEditor(page, mobile)).suggestedFilename()).toBe(expectedFilename);
  });
}

test('recovered transcription uses the server original name when no uploaded File exists', async ({ page }) => {
  await prepareApp(page);
  await page.addInitScript(uid => localStorage.setItem(`quickcaption:transcription-job:${uid}`, '11111111-1111-4111-8111-111111111111'), testUid);
  await page.route('**/api/transcribe/jobs/**', route => route.fulfill({ json: { status: 'completed', result } }));
  await page.goto('/?screen=transcription');
  expect((await downloadFromEditor(page)).suggestedFilename()).toBe(expectedFilename);
});

test('fresh transcription uses the uploaded filename', async ({ page }) => {
  await prepareApp(page);
  // Keep paid services and Firebase out of the upload regression.
  await page.route('**/src/client/api.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `\nsetApiUser({ uid: '${testUid}', getIdToken: async () => 'download-fixture-token' });` });
  });
  await page.route('**/api/transcribe', route => route.fulfill({ json: { ...result, originalFilename: undefined } }));
  await page.goto('/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: originalFilename, mimeType: 'video/webm', buffer: portraitVideo });
  await page.getByRole('button', { name: 'שלחו לעיבוד', exact: true }).click();
  expect((await downloadFromEditor(page)).suggestedFilename()).toBe(expectedFilename);
});

test('history export uses the original name and selected subtitle format', async ({ page }) => {
  await prepareApp(page);
  await page.route('**/api/videos?**', route => route.fulfill({ json: { videos: [{
    id: 42, original_filename: originalFilename, status: 'completed', media_type: 'video',
    has_subtitles: true, duration_seconds: 4, created_at: '2026-10-02',
  }] } }));
  await page.route('**/api/videos/42?**', route => route.fulfill({ json: { video: { subtitle_json: segments } } }));
  await page.goto('/?screen=videos');
  for (const format of ['SRT', 'VTT']) {
    await page.getByRole('button', { name: 'ייצוא', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: `ייצוא ${format}`, exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe(`ראיון סופי.גרסה 2_subtitle.${format.toLowerCase()}`);
  }
});
