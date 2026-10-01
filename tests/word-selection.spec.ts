import { test, expect, type Page } from '@playwright/test';
import { prepareApp, portraitVideo } from './app-fixtures';

const segments = [
  { id: 1, start: .2, end: 2.8, text: 'אחת שתיים אחת ארבע חמש שש' },
  { id: 2, start: 3, end: 3.8, text: 'כתובית אחרת' },
];
const words = segments.flatMap(segment => segment.text.split(' ').map((word, wordIndex) => ({
  word, wordIndex, segmentId: segment.id, timingSource: 'aligned',
  start: segment.start + wordIndex * .4, end: segment.start + wordIndex * .4 + .32,
})));
type Save = { segments: typeof segments; words: typeof words };
const selected = (page: Page) => page.locator('[data-testid="word-clip"][aria-pressed="true"]');
const clips = (page: Page) => page.getByTestId('word-clip');
const undo = (page: Page) => page.getByRole('button', { name: 'ביטול פעולה', exact: true });

async function open(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepareApp(page);
  await page.addInitScript(() => localStorage.setItem('caption-editor-preferences', JSON.stringify({ fps: 25 })));
  await page.route('**/api/videos/42/media?**', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), portraitVideo.length - 1) : portraitVideo.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm',
      headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${portraitVideo.length}` } : {}) },
      body: portraitVideo.subarray(start, end + 1) });
  });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: {
    video: { id: 42, subtitle_json: segments, words_json: words, format: '.srt', stored_path: 'portrait.mp4' },
  } }));
  const saves: Save[] = [];
  await page.route('**/api/videos/update-subtitles', async route => {
    const body = route.request().postDataJSON();
    saves.push({ segments: JSON.parse(body.subtitleJson), words: JSON.parse(body.wordsJson) });
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await page.getByTestId('subtitle-clip').first().click();
  await page.getByRole('button', { name: 'מילה אקטיבית', exact: true }).click();
  await expect(clips(page)).toHaveCount(6);
  return saves;
}

test('Ctrl/Cmd toggles words and Shift selects anchored ranges without changing timings', async ({ page }) => {
  const saves = await open(page);
  await clips(page).first().click();
  await clips(page).nth(2).click({ modifiers: ['Control'] });
  await expect(selected(page)).toHaveCount(2);
  await expect(page.getByTestId('word-selection-count')).toHaveText('2 מילים נבחרו');
  await clips(page).first().click({ modifiers: ['Meta'] });
  await expect(selected(page)).toHaveCount(1);
  await expect(clips(page).nth(2)).toHaveAttribute('aria-pressed', 'true');
  await clips(page).nth(3).click({ modifiers: ['Shift'] });
  await expect(selected(page)).toHaveCount(4);
  await clips(page).nth(5).click({ modifiers: ['Control', 'Shift'] });
  await expect(selected(page)).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(selected(page)).toHaveCount(0);
  await expect(page.getByTestId('subtitle-clip').first()).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+a');
  await expect(selected(page)).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'ערוך מילה ותזמון', exact: true })).toBeDisabled();
  await clips(page).nth(4).click();
  await expect(selected(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'ערוך מילה ותזמון', exact: true })).toBeEnabled();
  expect(saves).toHaveLength(0);
});

test('Delete removes nonadjacent duplicate words, saves intact timings and supports Undo/Redo', async ({ page }) => {
  const saves = await open(page);
  await clips(page).first().click();
  await clips(page).nth(2).click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  await expect(clips(page)).toHaveCount(4);
  await expect(page.getByRole('textbox', { name: 'טקסט המקטע' })).toHaveValue('שתיים ארבע חמש שש');
  await expect(undo(page)).toBeEnabled();
  expect(saves).toHaveLength(1);
  expect(saves[0].segments).toEqual([{ ...segments[0], text: 'שתיים ארבע חמש שש' }, segments[1]]);
  expect(saves[0].words).toEqual(words.filter((_, i) => i !== 0 && i !== 2).map((word, i) => ({
    ...word, wordIndex: word.segmentId === 1 ? i : word.wordIndex,
  })));
  await undo(page).click();
  await expect(clips(page)).toHaveCount(6);
  expect(saves.at(-1)?.segments).toEqual(segments);
  expect(saves.at(-1)?.words).toEqual(words);
  await page.getByRole('button', { name: 'ביצוע חוזר', exact: true }).click();
  await expect(clips(page)).toHaveCount(4);
  expect(saves.at(-1)?.words).toEqual(saves[0].words);
  await page.screenshot({ path: 'tmp/review/word-multiselect-delete.png' });
});

test('deleting every selected word keeps its empty caption and boundaries and Undo restores its words', async ({ page }) => {
  const saves = await open(page);
  await clips(page).first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await expect(page.getByTestId('word-editor')).toBeVisible();
  await expect(clips(page)).toHaveCount(0);
  await expect(page.getByTestId('subtitle-clip').first()).toHaveAttribute('data-start', String(segments[0].start));
  await expect(page.getByTestId('subtitle-clip').first()).toHaveAttribute('data-end', String(segments[0].end));
  await expect(undo(page)).toBeEnabled();
  expect(saves[0].segments).toEqual([{ ...segments[0], text: '' }, segments[1]]);
  expect(saves[0].words).toEqual(words.filter(word => word.segmentId === 2));
  await undo(page).click();
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await page.getByTestId('subtitle-clip').first().click();
  await expect(clips(page)).toHaveCount(6);
  expect(saves.at(-1)?.words).toEqual(words);
});

test('selected words make the caption green and own Delete after focus moves to the main track or header', async ({ page }) => {
  const saves = await open(page);
  const caption = page.getByTestId('subtitle-clip').first();
  const blue = await caption.evaluate(el => getComputedStyle(el).backgroundColor);
  await clips(page).first().click();
  await clips(page).nth(2).click({ modifiers: ['Control'] });
  await expect(caption).toHaveCSS('background-color', 'rgb(46, 125, 50)');
  const track = (await page.getByTestId('caption-track').boundingBox())!;
  await page.mouse.click(track.x + 30, track.y + track.height - 3);
  await expect(selected(page)).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(clips(page)).toHaveCount(4);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await expect(undo(page)).toBeEnabled();
  expect(saves[0].segments).toEqual([{ ...segments[0], text: 'שתיים ארבע חמש שש' }, segments[1]]);
  await expect(caption).toHaveCSS('background-color', blue);
  await clips(page).first().click();
  await expect(caption).toHaveCSS('background-color', 'rgb(46, 125, 50)');
  await page.getByRole('button', { name: 'סרטון חדש', exact: true }).focus();
  await page.keyboard.press('Delete');
  await expect(clips(page)).toHaveCount(3);
  await expect(undo(page)).toBeEnabled();
  expect(saves[1].segments).toEqual([{ ...segments[0], text: 'ארבע חמש שש' }, segments[1]]);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await clips(page).first().click();
  await page.keyboard.press('Escape');
  await expect(selected(page)).toHaveCount(0);
  await expect(caption).toHaveCSS('background-color', blue);
  await expect(caption).toHaveAttribute('aria-pressed', 'true');
});

test('holding Delete after a word deletion cannot cascade into deleting its caption', async ({ page }) => {
  const saves = await open(page);
  await clips(page).first().click();
  await clips(page).nth(2).click({ modifiers: ['Control'] });
  const track = (await page.getByTestId('caption-track').boundingBox())!;
  await page.mouse.click(track.x + 30, track.y + track.height - 3);
  await page.keyboard.down('Delete');
  await expect(undo(page)).toBeEnabled();
  await page.keyboard.down('Delete');
  await page.keyboard.down('Delete');
  await page.keyboard.up('Delete');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await expect(clips(page)).toHaveCount(4);
  expect(saves).toHaveLength(1);
});

test('failed removal of all words retries the empty draft and new caption text repopulates the word track', async ({ page }) => {
  await open(page);
  const saves: Save[] = [];
  await page.route('**/api/videos/update-subtitles', async route => {
    const body = route.request().postDataJSON();
    saves.push({ segments: JSON.parse(body.subtitleJson), words: JSON.parse(body.wordsJson) });
    await route.fulfill(saves.length === 1 ? { status: 500, json: { error: 'Failed' } } : { json: { success: true } });
  });
  await clips(page).first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('textbox', { name: 'טקסט המקטע' })).toHaveValue('');
  await expect(clips(page)).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Failed to save segments' }).first()).toBeVisible();
  await expect.poll(() => saves.length).toBe(2);
  await expect(undo(page)).toBeEnabled();
  expect(saves[1]).toEqual(saves[0]);
  expect(saves[1].segments).toEqual([{ ...segments[0], text: '' }, segments[1]]);
  const caption = page.getByRole('textbox', { name: 'טקסט המקטע' });
  await caption.fill('טקסט חדש');
  await expect(clips(page)).toHaveCount(2);
  await caption.blur();
  await expect(undo(page)).toBeEnabled();
  expect(saves.at(-1)?.segments).toEqual([{ ...segments[0], text: 'טקסט חדש' }, segments[1]]);
  expect(saves.at(-1)?.words.filter(word => word.segmentId === 1).map(word => word.word)).toEqual(['טקסט', 'חדש']);
  await undo(page).click();
  await expect(clips(page)).toHaveCount(0);
  await undo(page).click();
  await expect(clips(page)).toHaveCount(6);
  expect(saves.at(-1)?.words).toEqual(words);
});

test('Delete without word selection and Delete inside text fields never remove the caption', async ({ page }) => {
  const saves = await open(page);
  await page.getByTestId('word-editor').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await expect(clips(page)).toHaveCount(6);
  expect(saves).toHaveLength(0);
  await clips(page).first().click();
  await clips(page).nth(2).click({ modifiers: ['Control'] });
  const caption = page.getByRole('textbox', { name: 'טקסט המקטע' });
  await caption.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await expect(selected(page)).toHaveCount(2);
  await expect(caption).toHaveValue(segments[0].text);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
  await clips(page).first().click();
  await page.getByRole('button', { name: 'ערוך מילה ותזמון', exact: true }).click();
  await page.getByRole('textbox', { name: 'טקסט המילה' }).fill('אחת בדיקה');
  await page.keyboard.press('Home');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('textbox', { name: 'טקסט המילה' })).toHaveValue('חת בדיקה');
  await page.getByRole('button', { name: 'ביטול', exact: true }).click();
  await expect(clips(page)).toHaveCount(6);
  expect(saves).toHaveLength(0);
});

test('switching captions clears selected indexes and the delete button matches keyboard deletion', async ({ page }) => {
  const saves = await open(page);
  await clips(page).nth(4).click();
  await clips(page).nth(5).click({ modifiers: ['Control'] });
  await page.getByTestId('subtitle-clip').nth(1).click();
  await expect(clips(page)).toHaveCount(2);
  await expect(selected(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'מחק מילים מסומנות', exact: true })).toBeDisabled();
  await clips(page).last().click();
  await page.getByRole('button', { name: 'מחק מילים מסומנות', exact: true }).click();
  await expect(clips(page)).toHaveCount(1);
  await expect(undo(page)).toBeEnabled();
  expect(saves[0].segments).toEqual([segments[0], { ...segments[1], text: 'כתובית' }]);
  expect(saves[0].words).toEqual(words.slice(0, -1));
  await page.getByTestId('word-editor').focus();
  await page.keyboard.press('Delete');
  expect(saves).toHaveLength(1);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
});

test('holding Delete during a pending save sends one mutation and never deletes unselected words', async ({ page }) => {
  await open(page);
  const saves: Save[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/videos/update-subtitles', async route => {
    const body = route.request().postDataJSON();
    saves.push({ segments: JSON.parse(body.subtitleJson), words: JSON.parse(body.wordsJson) });
    await pending;
    await route.fulfill({ json: { success: true } });
  });
  await clips(page).nth(1).click();
  await clips(page).nth(3).click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  await expect.poll(() => saves.length).toBe(1);
  await expect(clips(page)).toHaveCount(4);
  await page.getByTestId('word-editor').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Delete');
  expect(saves).toHaveLength(1);
  await expect(selected(page)).toHaveCount(0);
  release();
  await expect(undo(page)).toBeEnabled();
  await expect(clips(page)).toHaveCount(4);
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(2);
});

test('failed deletion retains the draft for autosave retry and Undo restores all original timings', async ({ page }) => {
  await open(page);
  const saves: Save[] = [];
  await page.route('**/api/videos/update-subtitles', async route => {
    const body = route.request().postDataJSON();
    saves.push({ segments: JSON.parse(body.subtitleJson), words: JSON.parse(body.wordsJson) });
    await route.fulfill(saves.length === 1 ? { status: 500, json: { error: 'שמירה נכשלה לבדיקה' } } : { json: { success: true } });
  });
  await clips(page).nth(1).click();
  await clips(page).nth(3).click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  await expect(page.getByRole('textbox', { name: 'טקסט המקטע' })).toHaveValue('אחת אחת חמש שש');
  await expect(clips(page)).toHaveCount(4);
  await expect(page.getByRole('alert').filter({ hasText: 'Failed to save segments' }).first()).toBeVisible();
  await expect.poll(() => saves.length).toBe(2);
  await expect(undo(page)).toBeEnabled();
  expect(saves[1]).toEqual(saves[0]);
  await undo(page).click();
  await expect(clips(page)).toHaveCount(6);
  expect(saves.at(-1)?.words).toEqual(words);
});
