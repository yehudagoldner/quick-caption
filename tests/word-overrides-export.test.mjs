import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import multer from 'multer';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBurnSubtitlesRouter } from '../routes/burnSubtitles.js';

test('burn endpoint renders per-word appearance without caption overrides, with active words and pop', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'word-appearance-'));
  const source = path.join(directory, 'source.mp4');
  let server;
  const run = args => {
    const result = spawnSync('ffmpeg', ['-v', 'error', ...args], { maxBuffer: 640 * 360 * 4 });
    assert.equal(result.status, 0, result.stderr?.toString() ?? result.error?.message);
    return result.stdout;
  };
  try {
    run(['-y', '-f', 'lavfi', '-i', 'color=black:s=640x360:r=25:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
    const app = express(); app.use('/burn', createBurnSubtitlesRouter(multer({ dest: directory })));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    for (const mode of ['normal', 'active', 'pop']) {
      const body = new FormData();
      body.append('media', new Blob([await readFile(source)], { type: 'video/mp4' }), 'words.mp4');
      const segments = [{ id: 1, start: 0, end: 2, text: 'שלום שלום' }];
      const words = [{ word: 'שלום', start: 0, end: 1, segmentId: 1, style: { fontColor: '#ff0000', fontScale: 1.5, bold: true } },
        { word: 'שלום', start: 1, end: 2, segmentId: 1 }];
      for (const [key, value] of Object.entries({ subtitleContent: 'unused', segments: JSON.stringify(segments), words: JSON.stringify(words),
        fontId: 'assistant', fontSize: 60, fontColor: '#ffffff', outlineColor: '#000000', videoWidth: 640, videoHeight: 360,
        captionMotion: mode === 'pop' ? 'pop' : 'none', activeWordEnabled: mode === 'active', activeWordColor: '#00ff00' })) body.append(key, String(value));
      const response = await fetch(`http://127.0.0.1:${server.address().port}/burn`, { method: 'POST', body });
      assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
      const output = path.join(directory, `${mode}.mp4`); await writeFile(output, Buffer.from(await response.arrayBuffer()));
      const pixels = at => run(['-ss', String(at), '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-threads', '1', '-f', 'rawvideo', 'pipe:1']);
      const stats = bytes => {
        let red = 0, white = 0, green = 0; const redYs = [], whiteYs = [];
        for (let i = 0; i < bytes.length; i += 3) {
          const [r, g, b] = bytes.subarray(i, i + 3);
          if (r > 180 && g < 70 && b < 70) { red++; redYs.push(Math.floor(i / 3 / 640)); }
          if (r > 180 && g > 180 && b > 180) { white++; whiteYs.push(Math.floor(i / 3 / 640)); }
          if (g > 180 && r < 70 && b < 70) green++;
        }
        return { red, white, green, redHeight: Math.max(...redYs) - Math.min(...redYs), whiteHeight: Math.max(...whiteYs) - Math.min(...whiteYs) };
      };
      const first = stats(pixels(.5)), second = stats(pixels(1.5));
      if (mode === 'active') { assert.ok(first.green > 100); assert.ok(second.red > 100 && second.green > 100); }
      else assert.ok(first.red > 100, `${mode}: explicit red word missing`);
      if (mode === 'normal') { assert.ok(first.white > 100); assert.ok(first.redHeight > first.whiteHeight * 1.3, 'word size must survive export'); }
      if (mode === 'pop') { assert.equal(second.red, 0); assert.ok(second.white > 100); }
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
