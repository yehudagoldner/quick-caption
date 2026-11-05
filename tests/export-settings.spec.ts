import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo } from './app-fixtures';

async function setup(page: Page, mobile: boolean) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await prepareApp(page);
  const burns: string[] = [];
  await page.route('**/api/burn-subtitles', route => { burns.push(route.request().postDataBuffer()!.toString()); return route.fulfill({ contentType: 'video/mp4', body: portraitVideo }); });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  return burns;
}
async function openSettings(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'עוד', exact: true }).click();
  await page.getByRole('button', { name: 'הגדרות כתוביות', exact: true }).click();
  await page.getByRole('button', { name: /^הגדרות ייצוא/ }).click();
  return page.getByRole('dialog', { name: 'הגדרות ייצוא', exact: true });
}

for (const mobile of [false, true]) test(`export dialog estimates, validates, persists and sends settings (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  const burns = await setup(page, mobile);
  const dialog = await openSettings(page, mobile);
  const estimate = dialog.getByRole('status');
  const initialSize = await estimate.textContent();
  await dialog.getByRole('combobox', { name: /איכות ייצוא/ }).click();
  await page.getByRole('option', { name: /חסכונית/ }).click();
  await expect(estimate).not.toHaveText(initialSize!);
  await dialog.getByRole('combobox', { name: 'שיטת ייצוא' }).click();
  await page.getByRole('option', { name: 'Bitrate ידני' }).click();
  const bitrate = dialog.getByRole('spinbutton', { name: 'Bitrate וידאו (Mbps)' });
  const save = dialog.getByRole('button', { name: 'שמירת הגדרות' });
  for (const invalid of ['', '0', '101']) { await bitrate.fill(invalid); await expect(save).toBeDisabled(); }
  await bitrate.fill('2');
  const smaller = await estimate.textContent();
  await bitrate.fill('8'); await expect(estimate).not.toHaveText(smaller!);
  await bitrate.fill('2.5');
  await expect(save).toBeInViewport();
  await expect(bitrate).toBeInViewport();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `test-results/export-settings-${mobile ? 'mobile' : 'desktop'}.png` });
  await save.click(); await expect(dialog).not.toBeVisible();
  await page.reload();
  await openSettings(page, mobile);
  await expect(bitrate).toHaveValue('2.5');
  await bitrate.fill('12');
  await dialog.getByRole('button', { name: 'ביטול', exact: true }).click();
  await page.getByRole('button', { name: /^הגדרות ייצוא/ }).click();
  await expect(bitrate).toHaveValue('2.5');
  await dialog.getByRole('button', { name: 'סגירת הגדרות ייצוא', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  if (mobile) await page.getByRole('dialog', { name: 'הגדרות כתוביות', exact: true }).getByRole('button', { name: 'סגור', exact: true }).click();
  else await page.getByRole('button', { name: 'סגירת הגדרות כתוביות', exact: true }).click();
  if (mobile) await page.getByRole('button', { name: 'עוד', exact: true }).click();
  else await page.getByRole('button', { name: 'הורדה', exact: true }).click();
  const download = page.waitForEvent('download');
  if (mobile) await page.getByText('הורד סרטון עם כתוביות', { exact: true }).click();
  else await page.getByRole('menuitem', { name: 'הורד סרטון עם כתוביות', exact: true }).click();
  await download;
  expect(burns).toHaveLength(1);
  expect(burns[0]).toContain('name="exportSettings"');
  expect(burns[0]).toContain('"mode":"bitrate","quality":"compact","bitrateMbps":2.5');
});
