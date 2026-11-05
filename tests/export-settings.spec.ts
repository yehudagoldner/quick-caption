import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo } from './app-fixtures';

async function setup(page: Page, mobile: boolean, sourceDimensions?: { width: number; height: number }) {
  await page.setViewportSize(mobile ? { width: 390, height: 667 } : { width: 1366, height: 768 });
  await prepareApp(page);
  if (sourceDimensions) await page.route('**/api/videos/42/preview', route => route.fulfill({ json: { mode: 'rendition', qualities: ['720p', '1080p'], defaultQuality: '720p', sourceDimensions, mediaToken: 'fixture-token' } }));
  const burns: string[] = [];
  await page.route('**/api/burn-subtitles', route => { burns.push(route.request().postDataBuffer()!.toString()); return route.fulfill({ contentType: 'video/mp4', body: portraitVideo }); });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
  return burns;
}
async function openSettings(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole('button', { name: 'עוד', exact: true }).click();
    await page.getByRole('button', { name: 'הגדרות כתוביות', exact: true }).click();
  }
  await page.getByRole('button', { name: /^איכות וידאו/ }).click();
  return page.getByRole('dialog', { name: 'איכות וידאו', exact: true });
}

for (const mobile of [false, true]) test(`export dialog estimates, validates, persists and sends settings (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  const burns = await setup(page, mobile);
  const dialog = await openSettings(page, mobile);
  const estimate = dialog.getByRole('status');
  await expect(dialog.getByRole('spinbutton', { name: 'Bitrate וידאו (Mbps)' })).toHaveValue('50');
  expect(await dialog.locator('.MuiDialogContent-root').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  const initialSize = await estimate.textContent();
  await dialog.getByRole('combobox', { name: /^איכות תמונה/ }).click();
  await page.getByRole('option', { name: /נמוכה/ }).click();
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
  expect(await dialog.locator('.MuiDialogContent-root').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
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
  await page.getByRole('button', { name: /^איכות וידאו/ }).click();
  await expect(bitrate).toHaveValue('2.5');
  await dialog.getByRole('button', { name: 'סגירת איכות וידאו', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  if (mobile) await page.getByRole('dialog', { name: 'הגדרות כתוביות', exact: true }).getByRole('button', { name: 'סגור', exact: true }).click();
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

for (const height of [1080, 2160]) test(`resolution choices and compact layout for ${height}p source`, async ({page}) => {
  await setup(page, false, {width: height * 16 / 9, height});
  await page.getByRole('button',{name:'המשך עם המקור',exact:true}).click();
  const dialog=await openSettings(page,false);
  const content=dialog.locator('.MuiDialogContent-root');
  expect(await content.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  await dialog.getByRole('combobox',{name:/רזולוציית ייצוא/}).click();
  if(height===1080) await expect(page.getByRole('option',{name:'4K · 2160p',exact:true})).toHaveCount(0);
  else await expect(page.getByRole('option',{name:'4K · 2160p',exact:true})).toBeVisible();
  await page.getByRole('option',{name:'720p',exact:true}).click();
  await expect(dialog.getByText('1280×720',{exact:false})).toBeVisible();
  await expect(dialog.getByRole('combobox',{name:'איכות תצוגה מקדימה'})).toContainText('720p');
  await dialog.getByRole('button',{name:'שמירת הגדרות'}).click();
  await page.getByRole('button',{name:'איכות וידאו',exact:true}).click();
  await expect(dialog.getByRole('combobox',{name:/רזולוציית ייצוא/})).toContainText('720p');
});
