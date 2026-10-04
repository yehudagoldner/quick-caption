import { test, expect } from '@playwright/test';
import { prepareApp, portraitVideo } from './app-fixtures';

for (const width of [320, 390, 768, 1280]) {
  test(`unified header fits ${width}px and keeps account details in the menu`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await prepareApp(page);
    await page.goto('/?screen=edit&video=review-token');
    const header = page.getByTestId('app-header');
    const share = header.getByRole('button', { name: 'שיתוף סרטון עם כתוביות' });
    await expect(share).toBeEnabled();
    expect((await header.boundingBox())!.height).toBe(width < 500 ? 44 : 56);
    if (width < 500) await expect(header.locator('img')).toHaveCount(0);
    else await expect(header.locator('img')).toHaveAttribute('src', /quickcaption-favicon\.svg$/);
    await expect(header.locator('.MuiAvatar-root')).toHaveCount(0);
    await expect(header.getByText('Quick Caption', { exact: true })).toHaveCount(0);
    await expect(page.getByText('50 קרדיטים', { exact: true })).toBeHidden();
    const menu = header.getByRole('button', { name: 'תפריט', exact: true });
    const menuBox = (await menu.boundingBox())!;
    const shareBox = (await share.boundingBox())!;
    if (width < 500) expect(shareBox.height).toBe(menuBox.height);
    const backBox = (await header.getByRole('button', { name: 'לסרטונים שלי', exact: true }).boundingBox())!;
    if (width >= 500) expect((await header.locator('img').boundingBox())!.x).toBeGreaterThan(menuBox.x);
    expect(menuBox.x).toBeGreaterThan(shareBox.x);
    expect(shareBox.x).toBeGreaterThan(backBox.x + backBox.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 500) {
      expect((await page.getByTestId('mobile-caption-editor').boundingBox())!.y).toBe(44);
      // The player starts below the header; portrait media may center within its taller slot.
      expect((await page.getByTestId('media-stage').locator('..').boundingBox())!.y).toBeLessThan(80);
    }
    await menu.click();
    await expect(header.getByRole('button', { name: 'תפריט', exact: true, includeHidden: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menu').getByText('Review', { exact: true })).toBeVisible();
    await expect(page.getByRole('menu').getByText('50 קרדיטים', { exact: true })).toBeVisible();
    await expect(page.locator('#app-navigation-menu .MuiPaper-root')).toHaveCSS('opacity', '1');
    if (width === 390) await page.screenshot({ path: 'tmp/review/unified-header-menu.png' });
    await page.keyboard.press('Escape');
    await header.getByRole('button', { name: 'לסרטונים שלי', exact: true }).click();
    await expect(page).toHaveURL(/screen=videos/);
    await expect(header.getByRole('button', { name: 'שיתוף סרטון עם כתוביות' })).toHaveCount(0);
    await menu.click();
    await page.getByRole('menuitem', { name: 'סרטון חדש', exact: true }).click();
    await expect(page).toHaveURL(/screen=transcription/);
    await expect(header.getByRole('button', { name: 'שיתוף סרטון עם כתוביות' })).toHaveCount(0);
  });
}

test('menu navigation retains a failed mobile draft and saves it before leaving on retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);
  let fail = true;
  let saved = '';
  await page.route('**/api/videos/update-subtitles', route => {
    saved = JSON.parse(route.request().postDataJSON().subtitleJson)[0].text;
    return route.fulfill({ status: fail ? 500 : 200, json: fail ? { error: 'failed save' } : { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await page.getByRole('button', { name: 'עריכה', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'טקסט המקטע' });
  await field.fill('טיוטה לפני מעבר מהתפריט');
  await page.getByRole('button', { name: 'תפריט', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'דף הבית' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'דף הבית' }).click();
  await expect(page).toHaveURL(/screen=edit/);
  await expect(field).toHaveValue('טיוטה לפני מעבר מהתפריט');
  fail = false;
  await page.getByRole('button', { name: 'תפריט', exact: true }).click();
  await page.getByRole('menuitem', { name: 'דף הבית' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(saved).toBe('טיוטה לפני מעבר מהתפריט');
});

for (const width of [390, 1280]) {
  test(`header shares a burned video with download fallback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await prepareApp(page);
    let burns = 0;
    await page.route('**/api/burn-subtitles', async route => {
      burns++;
      await route.fulfill({ contentType: 'video/mp4', headers: { 'Content-Disposition': 'attachment; filename="captions.mp4"' }, body: portraitVideo });
    });
    await page.goto('/?screen=edit&video=review-token');
    const share = page.getByTestId('app-header').getByRole('button', { name: 'שיתוף סרטון עם כתוביות' });
    await expect(share).toBeEnabled();
    await share.click();
    const dialog = page.getByRole('dialog', { name: 'הסרטון מוכן לשיתוף' });
    await expect(dialog).toBeVisible();
    expect(burns).toBe(1);
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'שתף', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('captions.mp4');
  });
}
