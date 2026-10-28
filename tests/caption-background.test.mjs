import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { captionBackgroundAss, captionBackgroundCss, sanitizeCaptionBackground } from '../src/captionBackground.js';
import { sanitizeCaptionOverrides } from '../src/captionOverrides.js';
import { readCustomCaptionPresets, sanitizeCaptionAppearance, sameCaptionAppearance } from '../src/captionPresets.js';
import { renderStyledCaptionsAss } from '../src/styledCaptions.js';
import { buildSubtitlesFilter } from '../routes/burnSubtitles.js';

test('background defaults, sanitization, alpha conversion and custom styles', () => {
  assert.deepEqual(sanitizeCaptionBackground(), { backgroundColor: '#000000', backgroundOpacity: 0 });
  assert.deepEqual(sanitizeCaptionBackground({ backgroundColor: '#fff}\\p1', backgroundOpacity: Infinity }), sanitizeCaptionBackground());
  assert.equal(sanitizeCaptionBackground({ backgroundOpacity: -20 }).backgroundOpacity, 0);
  assert.equal(sanitizeCaptionBackground({ backgroundOpacity: 200 }).backgroundOpacity, 100);
  assert.equal(captionBackgroundCss({ backgroundColor: '#123456', backgroundOpacity: 50 }), 'rgba(18, 52, 86, 0.5)');
  assert.equal(captionBackgroundAss({ backgroundColor: '#123456', backgroundOpacity: 50 }), '&H80563412');
  assert.equal(captionBackgroundAss({ backgroundOpacity: 0 }), '&HFF000000');
  assert.equal(captionBackgroundAss({ backgroundOpacity: 100 }), '&H00000000');
  assert.deepEqual(sanitizeCaptionOverrides({ backgroundColor: 'red', backgroundOpacity: NaN }), {});
  assert.deepEqual(sanitizeCaptionOverrides({ backgroundColor: '#123456', backgroundOpacity: 0 }), { backgroundColor: '#123456', backgroundOpacity: 0 });
  const style = sanitizeCaptionAppearance({ backgroundColor: '#123456', backgroundOpacity: 50 });
  const [saved] = readCustomCaptionPresets(JSON.stringify([{ id: 'custom-bg', name: 'Background', style }]));
  assert.ok(sameCaptionAppearance(style, saved.style));
  assert.ok(!sameCaptionAppearance(style, { ...style, backgroundOpacity: 0 }));
});

const options = { videoWidth: 640, videoHeight: 360, fontSize: 64, fontId: 'heebo', fontColor: '#ffffff', outlineColor: '#000000', offsetYPercent: 20, marginPercent: 5, backgroundColor: '#ff0000' };
const segments = [{ id: 1, start: 0, end: 1, text: 'שלום עולם\nABC 123' }];

test('per-caption opacity overrides global values, including zero and moved words', () => {
  const clips = [...segments, { id: 2, start: 1, end: 2, text: 'No background', style: { backgroundOpacity: 0 } }];
  const ass = renderStyledCaptionsAss(clips, [], { ...options, backgroundOpacity: 50 });
  const events = ass.split('\n').filter(line => line.startsWith('Dialogue:'));
  assert.match(events[0], /\\4c&H0000ff&\\4a&H80&/);
  assert.match(events[1], /\\4a&HFF&/);
  const moved = renderStyledCaptionsAss(segments, [{ word: 'שלום', start: 0, end: .5, segmentId: 1, wordIndex: 0, style: { offsetX: 1 } }], { ...options, backgroundOpacity: 50 });
  assert.match(moved, /Dialogue: 1,.*\\4a&HFF&/);
  assert.doesNotMatch(moved, /\\alpha/);
});

test('FFmpeg composites backgrounds once and leaves text opaque in normal, active-word, pop and SRT exports', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'caption-background-'));
  try {
    for (const mode of ['normal', 'active', 'pop', 'srt']) {
      const counts = [];
      for (const backgroundOpacity of [0, 50, 100]) {
        const settings = { ...options, backgroundOpacity, captionMotion: mode === 'pop' ? 'pop' : 'none', activeWordEnabled: mode === 'active', activeWordColor: '#ffffff' };
        const subtitlePath = path.join(directory, `${mode}-${backgroundOpacity}.${mode === 'srt' ? 'srt' : 'ass'}`);
        await writeFile(subtitlePath, mode === 'srt' ? '1\n00:00:00,000 --> 00:00:01,000\nשלום עולם\nABC 123\n' : renderStyledCaptionsAss(segments, [], settings));
        const filter = buildSubtitlesFilter(subtitlePath, { ...settings, fontColor: '&H00FFFFFF', outlineColor: '&H00000000', wholeTextLayout: true });
        const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=640x360:d=1', '-vf', filter, '-ss', '0.3', '-frames:v', '1', '-pix_fmt', 'rgb24', '-threads', '1', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1024 * 1024 });
        assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
        let white = 0, red = 0, purple = 0;
        for (let i = 0; i < result.stdout.length; i += 3) {
          const [r, g, b] = result.stdout.subarray(i, i + 3);
          if (r > 235 && g > 235 && b > 235) white++;
          if (r > 235 && g < 15 && b < 15) red++;
          if (r > 110 && r < 145 && g < 15 && b > 110 && b < 145) purple++;
        }
        counts.push({ white, red, purple });
      }
      assert.ok(counts.every(count => count.white > 50), `${mode}: text must stay opaque`);
      assert.equal(counts[0].red + counts[0].purple, 0, `${mode}: transparent default`);
      assert.ok(counts[1].purple > 200 && counts[1].red === 0, `${mode}: 50% alpha blends with source video ${JSON.stringify(counts)}`);
      assert.ok(counts[2].red > 200, `${mode}: fully opaque background`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
