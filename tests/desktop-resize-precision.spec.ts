import { test, expect, type Page } from '@playwright/test';
import { prepareApp } from './app-fixtures';

type Caption = { id: number; start: number; end: number; text: string };
const clips: Caption[] = [
  { id: 1, start: .413, end: 1.237, text: 'first caption' },
  { id: 2, start: 1.6, end: 2.437, text: 'second caption' },
  { id: 3, start: 3, end: 3.8, text: 'third caption' },
];

async function open(page: Page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepareApp(page);
  await page.addInitScript(() => localStorage.setItem('caption-editor-preferences', JSON.stringify({ fps: 30 })));
  const words = clips.flatMap(s => s.text.split(' ').map((word, index) => ({
    word, segmentId: s.id, start: s.start + (s.end - s.start) * index / 2,
    end: s.start + (s.end - s.start) * (index + 1) / 2,
  })));
  await page.route('**/api/videos/load?**', route => route.fulfill({ json: { video: {
    id: 42, subtitle_json: clips, words_json: words, format: '.srt', stored_path: 'portrait.mp4',
  } } }));
  const saves: { segments: Caption[]; words: typeof words }[] = [];
  await page.route('**/api/videos/update-subtitles', async route => {
    const body = route.request().postDataJSON();
    saves.push({ segments: JSON.parse(body.subtitleJson), words: JSON.parse(body.wordsJson) });
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/?screen=edit&video=review-token', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('subtitle-clip')).toHaveCount(3);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  return saves;
}

async function resize(page: Page, index: number, edge: 'left' | 'right', delta: number) {
  const clip = page.getByTestId('subtitle-clip').nth(index);
  await clip.click();
  const box = (await clip.boundingBox())!;
  const pps = box.width / (clips[index].end - clips[index].start);
  const handle = (await clip.locator('..').locator(`.timeline-editor-action-${edge}-stretch`).boundingBox())!;
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + delta * pps, y, { steps: 8 }); await page.mouse.up();
}

for (const edge of ['left', 'right'] as const) {
  test(`a ${edge} resize preserves the opposite sub-frame boundary and trims its neighbour`, async ({ page }) => {
    const saves = await open(page);
    const index = edge === 'left' ? 1 : 0;
    await resize(page, index, edge, edge === 'left' ? -.55 : .65);
    await expect.poll(() => saves.length).toBe(1);
    await expect(page.getByText(/השינוי חופף לכתובית אחרת/)).toHaveCount(0);
    const saved = saves[0];
    const changed = edge === 'left' ? 'start' : 'end';
    const fixed = edge === 'left' ? 'end' : 'start';
    expect(saved.segments[index][fixed]).toBe(clips[index][fixed]);
    const neighbour = edge === 'left' ? 0 : 1;
    expect(saved.segments[neighbour][fixed]).toBe(saved.segments[index][changed]);
    expect(saved.segments[neighbour][changed]).toBe(clips[neighbour][changed]);
    expect(saved.segments[2]).toEqual(clips[2]);
    expect(saved.segments[index][changed]).not.toBe(clips[index][changed]);
    for (const word of saved.words) {
      const owner = saved.segments.find(s => s.id === word.segmentId)!;
      expect(word.start).toBeGreaterThanOrEqual(owner.start - 1e-6);
      expect(word.end).toBeLessThanOrEqual(owner.end + 1e-6);
    }
    await page.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1].segments).toEqual(clips);
  });
}
