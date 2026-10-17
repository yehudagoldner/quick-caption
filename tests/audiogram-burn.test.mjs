import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import multer from 'multer';
import { createBurnSubtitlesRouter } from '../routes/burnSubtitles.js';
import { buildAudiogramArguments, probeHasVideo } from '../src/burnVideo.js';
import { audiogramDimensions, audiogramWaveBox, sanitizeAudiogram } from '../src/audiogram.js';

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout;
};
const frame = (file, seconds = 1) => spawnSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 }).stdout;
const pixel = (rgb, width, x, y) => [...rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
const near = (actual, expected, tolerance = 24) => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
const streams = file => JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));

test('audiogram settings fall back to safe defaults', () => {
  assert.deepEqual(sanitizeAudiogram({ format: 'square', background: '#ABCDEF', imageFit: 'cover', waveform: false, waveColor: '#00FF00' }),
    { format: 'square', background: '#abcdef', imageFit: 'cover', waveform: false, waveColor: '#00ff00' });
  assert.deepEqual(sanitizeAudiogram({ format: '../x', background: 'red', imageFit: 'tile', waveform: 'yes', waveColor: 7 }), sanitizeAudiogram(null));
  assert.deepEqual(audiogramDimensions('landscape'), { width: 1920, height: 1080 });
  const band = audiogramWaveBox(1080, 1920);
  assert.ok(band.top % 2 === 0 && band.height % 2 === 0 && band.top + band.height <= 1920);
});

test('audio becomes a captioned video with an image over a color background', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audiogram-test-'));
  const audio = path.join(dir, 'podcast.wav'), cover = path.join(dir, 'cover.png'), video = path.join(dir, 'clip.mp4');
  run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audio]);
  run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=200x100', '-frames:v', '1', cover]);
  run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x240:r=10:d=1', '-c:v', 'libx264', '-preset', 'ultrafast', video]);
  const lookup = async ({ videoId }) => ({ stored_path: videoId === 1 ? 'podcast.wav' : 'clip.mp4', original_filename: 'פודקאסט.wav' });
  const { createBurnSourceResolver } = await import('../src/burnSource.js');
  const app = express();
  app.use((req, _res, next) => { req.identity = { uid: 'owner' }; next(); });
  app.use('/burn', createBurnSubtitlesRouter(multer({ dest: path.join(dir, 'uploads') }), {
    resolveVideo: createBurnSourceResolver({ getVideoById: lookup, bunny: null, localDir: dir, tempDir: dir }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/burn`;
  const form = ({ videoId = 1, audiogram, image, imageType = 'image/png' } = {}) => {
    const body = new FormData();
    for (const [key, value] of Object.entries({ videoId, subtitleContent: '1\n00:00:00,000 --> 00:00:02,000\nשלום\n', fontSize: 60, offsetYPercent: 5, videoWidth: 10, videoHeight: 10 })) body.append(key, String(value));
    if (audiogram) body.append('audiogram', JSON.stringify(audiogram));
    if (image) body.append('background', new Blob([image], { type: imageType }), 'cover.png');
    return body;
  };
  try {
    assert.equal(await probeHasVideo(audio), false);
    assert.equal(await probeHasVideo(video), true);
    const settings = { format: 'vertical', background: '#123456', imageFit: 'contain', waveform: false, waveColor: '#ffffff' };
    const response = await fetch(base, { method: 'POST', body: form({ audiogram: settings, image: await fs.readFile(cover) }) });
    assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
    assert.match(decodeURIComponent(response.headers.get('content-disposition')), /פודקאסט-subtitled\.mp4/);
    const output = path.join(dir, 'result.mp4');
    await fs.writeFile(output, Buffer.from(await response.arrayBuffer()));
    const probe = streams(output);
    const picture = probe.streams.find(stream => stream.codec_type === 'video');
    assert.deepEqual([picture.codec_name, picture.width, picture.height, picture.pix_fmt], ['h264', 1080, 1920, 'yuv420p']);
    assert.equal(probe.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac');
    assert.ok(Math.abs(Number(probe.format.duration) - 2) < .15, probe.format.duration);
    const rgb = frame(output);
    assert.ok(near(pixel(rgb, 1080, 20, 20), [0x12, 0x34, 0x56]), String(pixel(rgb, 1080, 20, 20)));
    // A 2:1 image is fitted to the full width and centred vertically.
    assert.ok(near(pixel(rgb, 1080, 540, 960), [255, 0, 0], 40), String(pixel(rgb, 1080, 540, 960)));
    assert.ok(near(pixel(rgb, 1080, 540, 600), [0x12, 0x34, 0x56]), String(pixel(rgb, 1080, 540, 600)));

    const mismatched = await fetch(base, { method: 'POST', body: form({ videoId: 2, audiogram: settings }) });
    assert.equal(mismatched.status, 400);
    assert.match((await mismatched.json()).error, /אודיו בלבד/);
    const missing = await fetch(base, { method: 'POST', body: form() });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /רקע/);
    const wrongType = await fetch(base, { method: 'POST', body: form({ audiogram: settings, image: Buffer.from('not an image'), imageType: 'text/plain' }) });
    assert.equal(wrongType.status, 400);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await fs.readdir(path.join(dir, 'uploads')), []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the waveform is drawn in its band and follows the audio length', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audiogram-wave-'));
  const audio = path.join(dir, 'tone.wav'), output = path.join(dir, 'wave.mp4');
  try {
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1.5,volume=6', audio]);
    const { width, height } = audiogramDimensions('square');
    run('ffmpeg', buildAudiogramArguments(audio, { width, height, background: '#000000', waveform: true, waveColor: '#ffffff', imageFit: 'contain', duration: 1.5 }, 'null', output));
    const probe = streams(output);
    assert.ok(Math.abs(Number(probe.format.duration) - 1.5) < .15, probe.format.duration);
    const rgb = frame(output, .7);
    const band = audiogramWaveBox(width, height);
    const bright = y => Array.from({ length: width }, (_, x) => pixel(rgb, width, x, y)).filter(value => value.every(channel => channel > 180)).length;
    assert.ok(bright(band.top + band.height / 2) > width * .3, `center row bright pixels: ${bright(band.top + band.height / 2)}`);
    assert.equal(bright(band.top - 20), 0);
    assert.equal(bright(band.top + band.height + 20), 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
