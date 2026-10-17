import test from 'node:test';
import assert from 'node:assert/strict';
import { cropFilter, cropPosition, cropRectangle, splitVideoVersions, validateVideoCrop } from '../src/videoVersions.js';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probeVideoDimensions } from '../src/burnVideo.js';

test('crop preserves bounds and even dimensions in every format', () => {
  for (const format of ['vertical', 'square', 'portrait']) for (const x of [0, .5, 1]) {
    const source = { width: 1920, height: 1080 }, r = cropRectangle(source, { format, x, y: .5 });
    assert.equal(r.width % 2, 0); assert.equal(r.height % 2, 0);
    assert.ok(r.x >= 0 && r.x + r.width <= source.width);
    assert.ok(r.y >= 0 && r.y + r.height <= source.height);
  }
  assert.deepEqual(cropRectangle({ width: 1920, height: 1080 }, { format: 'square', x: 1, y: 0 }), { x: 840, y: 0, width: 1080, height: 1080 });
});
test('tracking interpolation holds endpoints and rejects untrusted expressions', () => {
  const crop = { format: 'vertical', x: .5, y: .5, points: [{ time: 1, x: 0, y: .5 }, { time: 3, x: 1, y: .5 }] };
  assert.equal(cropPosition(crop, 2).x, .5); assert.equal(cropPosition(crop, 0).x, 0); assert.equal(cropPosition(crop, 10).x, 1);
  for (const patch of [{ x: '1;movie=x' }, { x: NaN }, { format: 'bad' }, { points: [...crop.points].reverse() }, { points: [{ time: 0, x: 3, y: 0 }] }]) {
    assert.throws(() => validateVideoCrop({ ...crop, ...patch }));
  }
});
test('split all uses source time with independent segmentation and preserves input', () => {
  const versions = {
    original: { segments: [{ id: 1, start: 0, end: 4, text: 'one two three four' }], words: [] },
    vertical: { segments: [{ id: 'different', start: 1, end: 3, text: 'two three' }], words: [] },
    square: { segments: [{ id: 1, start: 0, end: 2, text: 'one two' }, { id: 2, start: 2, end: 4, text: 'three four' }], words: [] },
  };
  const before = structuredClone(versions), after = splitVideoVersions(versions, 2);
  assert.deepEqual(versions, before);
  assert.equal(after.original.segments[0].end, 2); assert.equal(after.vertical.segments[1].start, 2);
  assert.deepEqual(after.square, versions.square);
  assert.equal(after.original.segments.map(s => s.text).join(' '), before.original.segments[0].text);
});
test('real FFmpeg exports match preview geometry, including a long automatic path', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'caption-versions-'));
  try {
    const source = path.join(directory, 'source.mp4');
    await writeFile(source, Buffer.from(await readFile('tests/fixtures/landscape-video.base64', 'utf8'), 'base64'));
    for (const format of ['vertical', 'square', 'portrait']) {
      const crop = { format, x: .2, y: .5, points: Array.from({ length: 600 }, (_, i) => ({ time: i / 150, x: i / 599, y: .5 })) };
      const output = path.join(directory, format + '.mp4');
      const script = path.join(directory, format + '.filter'); await writeFile(script, cropFilter(crop));
      const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-filter_script:v', script, '-c:v', 'libx264', '-an', output], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const { width, height } = cropRectangle({ width: 640, height: 360 }, crop);
      assert.deepEqual(await probeVideoDimensions(output), { width, height });
    }
  } finally { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); await rm(directory, { recursive: true, force: true }); }
});
