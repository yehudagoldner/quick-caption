import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import multer from 'multer';
import { CAPTION_PRESETS, readCustomCaptionPresets, sanitizeCaptionAppearance, sameCaptionAppearance } from '../src/captionPresets.js';
import { renderActiveWordSrt } from '../src/activeWordSubtitles.js';
import { getCaptionFont } from '../src/captionFonts.js';
import { createBurnSubtitlesRouter } from '../routes/burnSubtitles.js';

test('custom templates bound imported data, reject duplicate/unknown fonts, and preserve complete styles', () => {
  const valid = { id: 'custom-one', name: ' שלי ', style: CAPTION_PRESETS[2].style };
  assert.deepEqual(readCustomCaptionPresets('broken'), []);
  assert.deepEqual(readCustomCaptionPresets('{}'), []);
  const saved = readCustomCaptionPresets(JSON.stringify([null, valid, valid, { ...valid, id: 'custom-two', style: { fontId: 'injected' } }]));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'שלי');
  assert.ok(sameCaptionAppearance(saved[0].style, valid.style));
  assert.ok(!sameCaptionAppearance(saved[0].style, { ...valid.style, activeWordColor: '#ff0000' }));
  const normalized = sanitizeCaptionAppearance({ fontSize: Infinity, marginPercent: 100, offsetYPercent: -20, fontColor: 'red', activeWordEnabled: 'true', captionMotion: 'unknown' });
  assert.equal(normalized.fontColor, '#ffffff');
  assert.equal(normalized.marginPercent, 40);
  assert.equal(normalized.activeWordEnabled, false);
  assert.ok(Number.isFinite(normalized.fontSize));
});
test('active-word colour is escaped by validation while caption text remains intact', () => {
  const segments = [{ id: 1, start: 0, end: 1, text: 'שלום <עולם>' }];
  const green = renderActiveWordSrt(segments, [], 'rtl', '#b8ff48');
  assert.match(green, /color="#b8ff48"/);
  assert.match(green, /&lt;עולם&gt;/);
  const fallback = renderActiveWordSrt(segments, [], 'rtl', '#fff" size="1000');
  assert.match(fallback, /color="#FFD700"/);
  assert.doesNotMatch(fallback, /size=/);
});

test('every style exports a real Hebrew MP4 with its text or active-word palette', async () => {
  const dir = path.resolve('tmp/caption-styles');
  await fs.mkdir(dir, { recursive: true });
  const source = path.join(dir, 'source.mp4');
  const created = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x151c2b:s=640x360:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
  assert.equal(created.status, 0, created.stderr?.toString());
  const segments = [{ id: 1, start: 0, end: 1, text: 'שלום עולם' }];
  const words = [{ word: 'שלום', start: 0, end: .5 }, { word: 'עולם', start: .5, end: 1 }];
  const app = express(); app.use('/burn', createBurnSubtitlesRouter(multer({ dest: dir })));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const preset of CAPTION_PRESETS) {
      assert.equal(getCaptionFont(preset.style.fontId).id, preset.style.fontId);
      const body = new FormData();
      body.append('media', new Blob([await fs.readFile(source)], { type: 'video/mp4' }), `${preset.id}.mp4`);
      for (const [key, value] of Object.entries({ ...preset.style, fontSize: 72, subtitleContent: '1\n00:00:00,000 --> 00:00:01,000\nשלום עולם\n', segments: JSON.stringify(segments), words: JSON.stringify(words), videoWidth: 640, videoHeight: 360 })) body.append(key, String(value));
      const response = await fetch(`http://127.0.0.1:${server.address().port}/burn`, { method: 'POST', body });
      assert.equal(response.status, 200, `${preset.id}: ${response.status === 200 ? '' : await response.text()}`);
      const output = path.join(dir, `${preset.id}.mp4`);
      await fs.writeFile(output, Buffer.from(await response.arrayBuffer()));
      const decoded = spawnSync('ffmpeg', ['-v', 'error', '-ss', '0.3', '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-threads', '1', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 640 * 360 * 4 });
      assert.equal(decoded.status, 0, decoded.stderr?.toString());
      const hex = preset.style.activeWordEnabled ? preset.style.activeWordColor : preset.style.fontColor;
      const expected = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16));
      let matching = 0;
      for (let i = 0; i < decoded.stdout.length; i += 3) if (expected.every((channel, index) => Math.abs(decoded.stdout[i + index] - channel) < 25)) matching++;
      assert.ok(matching > 60, `${preset.id}: missing palette ${hex} (${matching} matching pixels)`);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
