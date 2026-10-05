import { test, expect } from '@playwright/test';
import { prepareApp, portraitVideo } from './app-fixtures';

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 600 }, { width: 1366, height: 600 }, { width: 1366, height: 768 }]) {
  test(`all upload settings fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await prepareApp(page);
    await page.goto('/?screen=transcription');
    const fits = async () => {
      await expect.poll(() => page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }))).toEqual({ x: 0, y: 0 });
    };
    await fits();
    await page.locator('input[type=file]').setInputFiles({ name: 'סרטון עם שם ארוך במיוחד לבדיקת התצוגה המלאה.webm', mimeType: 'video/webm', buffer: portraitVideo });
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
    for (const mode of ['לפי תווים', 'לפי מילים', 'ללא הגבלה']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await fits();
      await expect(page.getByRole('button', { name: 'שלחו לעיבוד' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('combobox', { name: 'שפת התמלול', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('combobox', { name: 'שפות נוספות בסרטון' })).toBeInViewport({ ratio: 1 });
    }
    for (const label of ['מקור', 'תרגום לעברית', 'תעתיק עברי']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await fits();
      await expect(page.getByRole('button', { name: label, exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'שלחו לעיבוד' })).toBeInViewport({ ratio: 1 });
    }
    await page.getByRole('button', { name: 'לפי תווים', exact: true }).click();
    await page.screenshot({ path: `tmp/review/upload-settings-${viewport.width}x${viewport.height}.png` });
  });
}

for (const mode of ['characters', 'words', 'none']) {
  test(`upload sends ${mode} and restores languages and limits with a fresh mobile default`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepareApp(page);
    await page.goto('/?screen=transcription');
    const selectFile = () => page.locator('input[type=file]').setInputFiles({ name: 'portrait.webm', mimeType: 'video/webm', buffer: portraitVideo });
    await selectFile();
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
    const labels = { characters: 'לפי תווים', words: 'לפי מילים', none: 'ללא הגבלה' };
    await page.getByRole('button', { name: labels[mode as keyof typeof labels], exact: true }).click();
    if (mode === 'characters') {
      const limit = page.getByRole('spinbutton', { name: 'מספר תווים' });
      await limit.fill('');
      await limit.pressSequentially('12');
      await expect(limit).toHaveValue('12');
    }
    if (mode === 'words') await page.getByRole('spinbutton', { name: 'מספר מילים' }).fill('3');
    await expect(page.getByRole('combobox', { name: 'שפת התמלול', exact: true })).toHaveValue('עברית · Hebrew');
    const languages = page.getByRole('combobox', { name: 'שפות נוספות בסרטון' });
    await languages.click();
    await languages.fill('English');
    await page.getByRole('option', { name: /English/ }).click();
    await languages.press('Escape');
    await page.reload();
    await selectFile();
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'לפי תווים', exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (mode === 'characters') await expect(page.getByRole('spinbutton', { name: 'מספר תווים' })).toHaveValue('12');
    await page.getByRole('button', { name: labels[mode as keyof typeof labels], exact: true }).click();
    await expect(page.getByRole('button', { name: labels[mode as keyof typeof labels], exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('אנגלית', { exact: true })).toBeVisible();
    let posted: string | null = null;
    await page.route('**/api/transcribe', async route => { posted = route.request().postData(); await route.fulfill({ json: { text: 'שלום', segments: [], subtitle: { content: '', format: '.srt' } } }); });
    await page.getByRole('button', { name: 'שלחו לעיבוד' }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted).toContain('name="languages"\r\n\r\n["he","en"]');
    expect(posted).toContain('name="secondaryLanguageMode"\r\n\r\ntranslate');
    expect(posted).toContain(`name="maxWordsPerSubtitle"\r\n\r\n${mode === 'words' ? 3 : 0}`);
    if (mode === 'characters') expect(posted).toContain('name="maxCharactersPerSubtitle"\r\n\r\n12');
    else expect(posted).not.toContain('name="maxCharactersPerSubtitle"');
  });
}

for (const [mode, label] of [['original', 'מקור'], ['translate', 'תרגום לעברית'], ['transliterate', 'תעתיק עברי']]) {
  test(`${mode} secondary language preference survives reload and is submitted`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepareApp(page);
    await page.goto('/?screen=transcription');
    const selectFile = () => page.locator('input[type=file]').setInputFiles({ name: 'portrait.webm', mimeType: 'video/webm', buffer: portraitVideo });
    await selectFile();
    const button = page.getByRole('button', { name: label, exact: true });
    await button.click();
    await button.click(); // An exclusive selector cannot clear its current value.
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quickcaption:initial-transcription-settings')!).secondaryLanguageMode)).toBe(mode);
    await page.reload();
    await selectFile();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    let posted: string | null = null;
    await page.route('**/api/transcribe', async route => { posted = route.request().postData(); await route.fulfill({ json: { text: 'שלום', segments: [], subtitle: { content: '', format: '.srt' } } }); });
    await page.getByRole('button', { name: 'שלחו לעיבוד' }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted).toContain(`name="secondaryLanguageMode"\r\n\r\n${mode}`);
  });
}

for (const scenario of [
  { name: 'desktop portrait', width: 1280, portrait: true, touch: false, expected: 'לפי תווים' },
  { name: 'mobile landscape', width: 390, portrait: false, touch: false, expected: 'לפי תווים' },
  { name: 'rotated mobile landscape', width: 844, portrait: false, touch: true, expected: 'לפי תווים' },
  { name: 'desktop landscape', width: 1280, portrait: false, touch: false, expected: 'ללא הגבלה' },
]) {
  test(`each ${scenario.name} upload selects its default over saved preferences`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 844 }, hasTouch: scenario.touch });
    const page = await context.newPage();
    await prepareApp(page);
    await page.addInitScript(({ portrait }) => {
      localStorage.setItem('quickcaption:initial-transcription-settings', JSON.stringify({ mode: 'none', words: 5, languages: ['he'] }));
      if (!portrait) {
        Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { get: () => 1920 });
        Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { get: () => 1080 });
      }
    }, { portrait: scenario.portrait });
    await page.goto('/?screen=transcription');
    for (const name of ['first.webm', 'replacement.webm']) {
      await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'video/webm', buffer: portraitVideo });
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
      await expect(page.getByRole('button', { name: scenario.expected, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'ללא הגבלה', exact: true }).click();
    }
    await context.close();
  });
}

test('upload and subtitle preview keep playback inline without a fullscreen control', async ({ page }) => {
  await prepareApp(page);
  await page.goto('/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: 'portrait.webm', mimeType: 'video/webm', buffer: portraitVideo });
  const check = async () => {
    const video = page.locator('video');
    await expect(video).toHaveAttribute('controlslist', 'nofullscreen');
    await expect(video).toHaveAttribute('playsinline', '');
    await expect(video).toHaveAttribute('controls', '');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const controls: any[] = [];
    const visit = (node: any) => {
      if (node.attributes?.includes('-webkit-media-controls-fullscreen-button')) controls.push(node);
      [...(node.children || []), ...(node.shadowRoots || [])].forEach(visit);
    };
    visit(root);
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId: control.nodeId });
      expect(computedStyle.find(style => style.name === 'display')?.value).toBe('none');
    }
    await cdp.detach();
  };
  await check();
  await page.goto('/?screen=edit&video=review-token');
  await expect(page.getByTestId('desktop-caption-editor')).toBeVisible();
  await check();
});

test('many selected languages remain compact and can be searched and deselected', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await prepareApp(page);
  await page.addInitScript(() => localStorage.setItem('quickcaption:initial-transcription-settings', JSON.stringify({ mode: 'characters', words: 5, languages: ['he', 'en', 'ar', 'ru', 'zh', 'de', 'es', 'ko', 'fr', 'ja', 'pt', 'tr', 'pl', 'ca', 'nl', 'sv', 'it', 'id', 'hi', 'fi'] })));
  await page.goto('/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: 'portrait.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await expect(page.getByText('19 שפות נוספות', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0);
  const languages = page.getByRole('combobox', { name: 'שפות נוספות בסרטון' });
  await languages.fill('English');
  await page.getByRole('option', { name: /English/ }).click();
  await languages.press('Escape');
  await expect(page.getByText('18 שפות נוספות', { exact: true })).toBeVisible();
});

test('changing the output language places it first and clearing source hints keeps that target', async ({ page }) => {
  await prepareApp(page);
  await page.goto('/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: 'portrait.webm', mimeType: 'video/webm', buffer: portraitVideo });
  const target = page.getByRole('combobox', { name: 'שפת התמלול', exact: true });
  const sources = page.getByRole('combobox', { name: 'שפות נוספות בסרטון' });
  await sources.fill('English');
  await page.getByRole('option', { name: /English/ }).click();
  await sources.press('Escape');
  await target.fill('English');
  await page.getByRole('option', { name: /English/ }).click();
  await expect(target).toHaveValue('אנגלית · English');
  await sources.fill('Arabic');
  await page.getByRole('option', { name: /Arabic/ }).click();
  await sources.press('Escape');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quickcaption:initial-transcription-settings')!).languages)).toEqual(['en', 'ar']);
  await page.getByRole('button', { name: 'ניקוי השפות הנוספות', exact: true }).click();
  await expect(target).toHaveValue('אנגלית · English');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quickcaption:initial-transcription-settings')!).languages)).toEqual(['en']);
  await page.reload();
  await page.locator('input[type=file]').setInputFiles({ name: 'portrait.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await expect(target).toHaveValue('אנגלית · English');
});

test('empty saved selections migrate to the required Hebrew output language', async ({ page }) => {
  await prepareApp(page);
  await page.addInitScript(() => localStorage.setItem('quickcaption:initial-transcription-settings', JSON.stringify({ languages: [] })));
  await page.goto('/?screen=transcription');
  await page.locator('input[type=file]').setInputFiles({ name: 'portrait.webm', mimeType: 'video/webm', buffer: portraitVideo });
  await expect(page.getByRole('combobox', { name: 'שפת התמלול', exact: true })).toHaveValue('עברית · Hebrew');
});
