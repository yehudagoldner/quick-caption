import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildBurnArguments } from '../src/burnVideo.js';

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout;
};

for (const withAudio of [true, false]) test(`Photos-compatible export preserves odd-sized frames ${withAudio ? 'with' : 'without'} audio`, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-photos-'));
  const input = path.join(directory, 'source.mkv');
  const output = path.join(directory, 'export.mp4');
  try {
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=321x241:r=10:d=1',
      ...(withAudio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le'] : []),
      '-c:v', 'ffv1', input]);
    run('ffmpeg', buildBurnArguments(input, 'null', output));
    const { streams } = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]));
    const video = streams.find(stream => stream.codec_type === 'video');
    assert.equal(video.codec_name, 'h264');
    assert.equal(video.pix_fmt, 'yuv420p');
    assert.equal(video.width, 322);
    assert.equal(video.height, 242);
    assert.ok(Math.abs(Number(video.duration) - 1) < 0.1);
    const audio = streams.find(stream => stream.codec_type === 'audio');
    if (withAudio) {
      assert.equal(audio.codec_name, 'aac');
      assert.ok(Math.abs(Number(audio.duration) - 1) < 0.1);
    } else assert.equal(audio, undefined);
    // The index must precede the media data so the file opens without a full download.
    const bytes = await fs.readFile(output);
    assert.ok(bytes.indexOf('moov') > 0 && bytes.indexOf('moov') < bytes.indexOf('mdat'));
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
