import { test, expect, type Page, type Locator } from '@playwright/test';
import { prepareApp, portraitVideo } from './app-fixtures';

async function setup(page: Page) {
  await prepareApp(page);
  const downloads: any[] = [], feedback: any[] = [];
  let burns = 0;
  await page.route('**/api/downloads', route => {
    const body = route.request().postDataJSON(); downloads.push(body);
    return route.fulfill({ json: { success: true, downloadId: body.id } });
  });
  await page.route('**/api/downloads/*/feedback', route => {
    feedback.push({ id: route.request().url().split('/').at(-2), ...route.request().postDataJSON() });
    return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/videos/42/file?**', route => route.fulfill({ contentType: 'video/webm', body: portraitVideo }));
  await page.route('**/api/burn-subtitles', route => {
    burns++;
    return route.fulfill({ contentType: 'video/mp4', headers: { 'Content-Disposition': 'attachment; filename="captions.mp4"', 'Access-Control-Expose-Headers': 'Content-Disposition' }, body: portraitVideo });
  });
  return { downloads, feedback, burns: () => burns };
}

async function selectDownload(page: Page, mobile: boolean, name: string, kind: 'subtitles' | 'video' | 'ready') {
  await page.getByRole('button', { name: mobile ? 'עוד' : 'הורדה', exact: true }).click();
  await page.getByRole(mobile ? kind === 'video' ? 'button' : 'link' : 'menuitem', { name, exact: true }).click();
}

async function rate(dialog: Locator, value: number) {
  const id = await dialog.getByRole('radio', { name: `${value} כוכבים`, exact: true }).getAttribute('id');
  await dialog.locator(`label[for="${id}"]`).click();
}

test('rating hover and clicks agree with every visible star', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/?screen=edit&video=review-token');
  const download = page.waitForEvent('download');
  await selectDownload(page, false, 'הורד סרטון עם כתוביות', 'video');
  await download;
  const dialog = page.getByRole('dialog', { name: 'איך הייתה החוויה?' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.MuiDialog-container')).toHaveCSS('opacity', '1');
  const rating = dialog.locator('.MuiRating-root');
  for (const value of [1, 5, 2, 4, 3]) {
    const name = `${value} ${value === 1 ? 'כוכב' : 'כוכבים'}`;
    const radio = dialog.getByRole('radio', { name, exact: true });
    const id = await radio.getAttribute('id');
    const star = dialog.locator(`label[for="${id}"]`);
    const box = (await star.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    if (value === 1) await page.screenshot({ path: 'tmp/review/rating-hover.png' });
    await expect(rating.locator('.MuiRating-iconFilled')).toHaveCount(value);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(0, 0);
    await expect(radio).toBeChecked();
    await expect(rating.locator('.MuiRating-iconFilled')).toHaveCount(value);
  }
  await dialog.getByRole('button', { name: 'שליחת דירוג' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.feedback[0].rating).toBe(3);
});

test.describe('touch rating', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('tapping every star selects and submits its displayed value', async ({ page }) => {
    const state = await setup(page);
    await page.goto('/?screen=edit&video=review-token');
    const download = page.waitForEvent('download');
    await selectDownload(page, true, 'הורד סרטון עם כתוביות', 'video');
    await download;
    const dialog = page.getByRole('dialog', { name: 'איך הייתה החוויה?' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('.MuiDialog-container')).toHaveCSS('opacity', '1');
    for (const value of [1, 2, 3, 4, 5]) {
      const radio = dialog.getByRole('radio', { name: `${value} ${value === 1 ? 'כוכב' : 'כוכבים'}`, exact: true });
      const id = await radio.getAttribute('id');
      await dialog.locator(`label[for="${id}"]`).tap();
      await expect(radio).toBeChecked();
      await expect(dialog.locator('.MuiRating-iconFilled')).toHaveCount(value);
    }
    await page.screenshot({ path: 'tmp/review/rating-touch.png' });
    await dialog.getByRole('button', { name: 'שליחת דירוג' }).tap();
    await expect(dialog).toHaveCount(0);
    expect(state.feedback[0].rating).toBe(5);
  });
});

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} subtitle download is recorded without requesting a rating`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 });
    const state = await setup(page);
    await page.goto('/?screen=edit&video=review-token');
    const download = page.waitForEvent('download');
    await selectDownload(page, mobile, 'הורד קובץ כתוביות', 'subtitles');
    expect((await download).suggestedFilename()).toMatch(/\.srt$/);
    expect(state.downloads).toHaveLength(1);
    expect(state.downloads[0]).toMatchObject({ videoId: 42, kind: 'subtitles', format: 'srt' });
    expect(state.downloads[0]).not.toHaveProperty('userUid');
    await expect(page.getByRole('dialog', { name: 'איך הייתה החוויה?' })).toHaveCount(0);
  });

  test(`${mobile ? 'mobile' : 'desktop'} video download asks for stars and feedback, and cached downloads count separately`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 });
    const state = await setup(page);
    await page.goto('/?screen=edit&video=review-token');
    const download = page.waitForEvent('download');
    await selectDownload(page, mobile, 'הורד סרטון עם כתוביות', 'video');
    expect((await download).suggestedFilename()).toBe('captions.mp4');
    expect(state.downloads).toHaveLength(1);
    expect(state.downloads[0]).toMatchObject({ videoId: 42, kind: 'video', format: 'mp4' });
    const dialog = page.getByRole('dialog', { name: 'איך הייתה החוויה?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'שליחת דירוג' })).toBeDisabled();
    await rate(dialog, 4);
    await expect(dialog.getByRole('button', { name: 'שליחת דירוג' })).toBeEnabled();
    await dialog.getByRole('textbox', { name: 'פידבק על החוויה (לא חובה)' }).fill('חוויה מצוינת\nתודה!');
    if (mobile) {
      await expect(page.locator('.MuiDialog-container')).toHaveCSS('opacity', '1');
      await page.screenshot({ path: 'tmp/review/download-feedback-mobile.png' });
    }
    await dialog.getByRole('button', { name: 'שליחת דירוג' }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.feedback).toEqual([{ id: state.downloads[0].id, rating: 4, feedback: 'חוויה מצוינת\nתודה!' }]);
    const cached = page.waitForEvent('download');
    await selectDownload(page, mobile, 'הורד סרטון צרוב מוכן', 'ready');
    await cached;
    expect(state.downloads).toHaveLength(2);
    expect(state.downloads[0].id).not.toBe(state.downloads[1].id);
    expect(state.burns()).toBe(1);
    await expect(dialog.getByRole('radio', { name: '4 כוכבים', exact: true })).not.toBeChecked();
    await dialog.getByRole('button', { name: 'אולי אחר כך' }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.feedback).toHaveLength(1);
  });
}

test('a lost download acknowledgment retries the same event before starting the file download', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const attempts: any[] = [], files: string[] = [];
  page.on('download', file => files.push(file.suggestedFilename()));
  await page.route('**/api/downloads', route => {
    const body = route.request().postDataJSON(); attempts.push(body);
    if (attempts.length === 1) return route.abort();
    return route.fulfill({ json: { success: true, downloadId: body.id } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await selectDownload(page, true, 'הורד קובץ כתוביות', 'subtitles');
  await expect(page.getByRole('alert')).toBeVisible();
  expect(files).toHaveLength(0);
  await selectDownload(page, true, 'הורד קובץ כתוביות', 'subtitles');
  await expect.poll(() => files.length).toBe(1);
  expect(attempts).toHaveLength(2); expect(attempts[0].id).toBe(attempts[1].id);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('failed video creation produces no download event or feedback request', async ({ page }) => {
  const state = await setup(page);
  await page.route('**/api/burn-subtitles', route => route.fulfill({ status: 500, json: { error: 'burn failed' } }));
  await page.goto('/?screen=edit&video=review-token');
  await selectDownload(page, false, 'הורד סרטון עם כתוביות', 'video');
  await expect(page.getByText('שגיאה בשריפת הכתוביות', { exact: true })).toBeVisible();
  expect(state.downloads).toHaveLength(0);
  await expect(page.getByRole('dialog', { name: 'איך הייתה החוויה?' })).toHaveCount(0);
});

test('feedback failure retains the chosen stars and written text for retry', async ({ page }) => {
  await setup(page);
  const sent: any[] = [];
  await page.route('**/api/downloads/*/feedback', route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: sent.length === 1 ? 503 : 200, json: sent.length === 1 ? { error: 'לא ניתן לשמור כרגע' } : { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token');
  const download = page.waitForEvent('download');
  await selectDownload(page, false, 'הורד סרטון עם כתוביות', 'video'); await download;
  const dialog = page.getByRole('dialog', { name: 'איך הייתה החוויה?' });
  await rate(dialog, 2);
  const text = dialog.getByRole('textbox', { name: 'פידבק על החוויה (לא חובה)' });
  await text.fill('אפשר לשפר את המהירות');
  await dialog.getByRole('button', { name: 'שליחת דירוג' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(text).toHaveValue('אפשר לשפר את המהירות');
  await expect(dialog.getByRole('radio', { name: '2 כוכבים', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'שליחת דירוג' }).click();
  await expect(dialog).toHaveCount(0); expect(sent[0]).toEqual(sent[1]);
});

test('sharing only records a download and asks for feedback when using the download fallback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined }));
  await page.goto('/?screen=edit&video=review-token');
  const share = page.getByTestId('app-header').getByRole('button', { name: 'שיתוף סרטון עם כתוביות' });
  await expect(share).toBeEnabled(); await share.click();
  const ready = page.getByRole('dialog', { name: 'הסרטון מוכן לשיתוף' });
  await expect(ready).toBeVisible(); expect(state.downloads).toHaveLength(0);
  const file = page.waitForEvent('download');
  await ready.getByRole('button', { name: 'שתף', exact: true }).click(); await file;
  await expect(ready).toHaveCount(0);
  expect(state.downloads).toHaveLength(1);
  await expect(page.getByRole('dialog', { name: 'איך הייתה החוויה?' })).toBeVisible();
});

test('native sharing does not count as a file download', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'share', { value: async () => { (window as any).shares = ((window as any).shares ?? 0) + 1; } });
  });
  await page.goto('/?screen=edit&video=review-token');
  const share = page.getByTestId('app-header').getByRole('button', { name: 'שיתוף סרטון עם כתוביות' });
  await expect(share).toBeEnabled(); await share.click();
  await expect.poll(() => page.evaluate(() => (window as any).shares)).toBe(1);
  expect(state.downloads).toHaveLength(0);
  await expect(page.getByRole('dialog', { name: 'איך הייתה החוויה?' })).toHaveCount(0);
});
