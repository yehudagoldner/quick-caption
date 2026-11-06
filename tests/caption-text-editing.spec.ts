import { test, expect, type Page } from '@playwright/test';
import type { Segment, Word } from '../src/client/types';
import { prepareApp } from './app-fixtures';

async function setup(page: Page, mobile: boolean, automatic = false) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 });
  await page.addInitScript(() => localStorage.setItem('caption-editor-preferences', JSON.stringify({ fps: 25 })));
  await prepareApp(page);
  let segments: Segment[] = [
    { id: 1, start: 0, end: automatic ? .5 : 2, text: 'שלום עולם', ...(automatic ? { wordTimingMode: 'automatic' as const } : {}) },
    { id: 2, start: automatic ? .5 : 2, end: 4, text: 'כתובית הבאה' },
  ];
  let words: Word[] = segments.flatMap(segment => segment.text.split(' ').map((word, index) => ({
    word, segmentId: segment.id,
    start: segment.start + (segment.end - segment.start) * index / 2,
    end: segment.start + (segment.end - segment.start) * (index + 1) / 2,
  })));
  const initial = structuredClone({ segments, words });
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: {
    id: 42, subtitle_json: segments, words_json: words, format: '.srt', stored_path: 'portrait.mp4',
  } } }));
  await page.route('**/api/videos/update-subtitles', route => {
    const body = route.request().postDataJSON(); segments = JSON.parse(body.subtitleJson); words = JSON.parse(body.wordsJson);
    return route.fulfill({ json: { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
  const open = async () => {
    if (mobile) await page.getByRole('button', { name: `עריכת כתובית: ${segments[0].text}`, exact: true }).click();
    else await page.getByTestId('subtitle-clip').first().click();
  };
  await open();
  const field = () => page.getByRole('textbox', { name: mobile ? 'טקסט הכתובית' : 'טקסט המקטע', exact: true });
  const edit = async (text: string) => {
    await field().fill(text); await field().blur();
    await expect.poll(() => segments[0].text).toBe(text);
  };
  return { edit, open, initial, segments: () => segments, words: () => words };
}

for (const mobile of [false, true]) test(`clearing a new caption saves empty words, survives reload and supports undo (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  const state = await setup(page, mobile, true);
  await state.edit('');
  expect(state.segments()).toEqual([{ ...state.initial.segments[0], text: '' }, state.initial.segments[1]]);
  expect(state.words().filter(word => word.segmentId === 1)).toEqual([]);
  if (mobile) await page.getByRole('button', { name: 'סיום', exact: true }).click();
  await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => state.segments()[0].text).toBe('שלום עולם');
  expect(state.words().filter(word => word.segmentId === 1).map(({ start, end }) => [start, end])).toEqual([[0, .25], [.25, .5]]);
  await page.getByRole('button', { name: 'ביצוע חוזר', exact: true }).click();
  await expect.poll(() => state.segments()[0].text).toBe('');
  await page.reload(); await state.open();
  await expect(page.getByRole('textbox', { name: mobile ? 'טקסט הכתובית' : 'טקסט המקטע', exact: true })).toHaveValue('');
  await state.edit('מילה חדשה');
  for (const word of state.words().filter(word => word.segmentId === 1)) expect(word.end - word.start).toBeCloseTo(.25);
  await state.edit('');
  if (mobile) {
    await page.getByRole('button', { name: 'סיום', exact: true }).click();
    await page.getByRole('checkbox', { name: /^בחירת כתובית:/ }).first().check();
    await page.getByRole('button', { name: 'מחיקת כתוביות נבחרות', exact: true }).click();
  } else {
    await page.getByTestId('subtitle-clip').first().click();
    await page.keyboard.press('Delete');
  }
  await expect.poll(() => state.segments().length).toBe(1);
  expect(state.segments()[0]).toEqual(state.initial.segments[1]);
});

for (const mobile of [false, true]) test(`existing caption keeps timing, adds four-frame words, trims its neighbour and undoes (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  const state = await setup(page, mobile);
  await state.edit('שלום עולם ממש חדש');
  const saved = structuredClone({ segments: state.segments(), words: state.words() });
  const own = saved.words.filter(word => word.segmentId === 1);
  expect(own.slice(0, 2).map(({ start, end }) => [start, end])).toEqual([[0, 1], [1, 2]]);
  for (const word of own.slice(2)) expect(word.end - word.start).toBeCloseTo(4 / 25);
  expect(saved.segments[0].end).toBeCloseTo(2.32);
  expect(saved.segments[1].start).toBeCloseTo(2.32);
  expect(saved.segments[1].end).toBe(4);
  const followingWords = saved.words.filter(word => word.segmentId === 2);
  expect(followingWords[0].start).toBeCloseTo(2.32);
  expect(followingWords[0].end).toBe(3);
  expect([followingWords[1].start, followingWords[1].end]).toEqual([3, 4]);
  if (mobile) await page.getByRole('button', { name: 'סיום', exact: true }).click();
  await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => state.segments()[0].text).toBe('שלום עולם');
  expect(state.segments()).toEqual(state.initial.segments);
  expect(state.words().map(({ word, start, end, segmentId }) => ({ word, start, end, segmentId }))).toEqual(state.initial.words);
  await page.getByRole('button', { name: 'ביצוע חוזר', exact: true }).click();
  await expect.poll(() => state.segments()[0].text).toBe('שלום עולם ממש חדש');
  expect(state.segments()).toEqual(saved.segments);
  await page.reload();
  await state.open();
  expect(state.segments()[0].end).toBeCloseTo(2.32);
  await expect(page.getByRole('textbox', { name: mobile ? 'טקסט הכתובית' : 'טקסט המקטע', exact: true })).toHaveValue('שלום עולם ממש חדש');
});

test('new caption redistributes on each edit, extends by four frames and keeps its mode after reload', async ({ page }) => {
  const state = await setup(page, false, true);
  await state.edit('שלום עולם ממש חדש');
  expect(state.segments()[0].end).toBeCloseTo(.66);
  for (const word of state.words().filter(word => word.segmentId === 1)) expect(word.end - word.start).toBeCloseTo(.165);
  expect(state.segments()[1].start).toBeCloseTo(.66);
  await page.reload(); await state.open();
  await state.edit('שלום עולם ממש חדש כאן');
  expect(state.segments()[0].end).toBeCloseTo(.82);
  for (const word of state.words().filter(word => word.segmentId === 1)) expect(word.end - word.start).toBeCloseTo(.164);
});

test('creating a caption marks it automatic and expands its end while typing', async ({ page }) => {
  const state = await setup(page, true);
  await page.getByRole('button', { name: 'סיום', exact: true }).click();
  await page.getByRole('button', { name: 'עוד', exact: true }).click();
  await page.getByText('הוסף כתובית', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'הוסף כתובית חדשה', exact: true });
  await dialog.getByRole('textbox', { name: 'טקסט הכתובית' }).fill('אחת שתיים שלוש ארבע');
  await expect(dialog.getByRole('spinbutton', { name: 'זמן סיום (שניות)' })).toHaveValue('0.66');
  await dialog.getByRole('button', { name: 'הוסף', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const added = state.segments().find(segment => segment.text === 'אחת שתיים שלוש ארבע')!;
  expect(added.wordTimingMode).toBe('automatic');
  expect(added.end).toBeCloseTo(.66);
  for (const word of state.words().filter(word => word.segmentId === added.id)) expect(word.end - word.start).toBeCloseTo(.165);
});
