import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EXPORT_SETTINGS, estimateExportSize, sanitizeExportSettings, validateExportSettings } from '../src/exportSettings.js';
import { buildBurnArguments, buildAudiogramArguments } from '../src/burnVideo.js';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('legacy exports preserve CRF 18; presets and manual bitrate reach both video encoders', () => {
  const defaults = buildBurnArguments('source.mp4', 'null', 'out.mp4');
  assert.equal(defaults[defaults.indexOf('-crf') + 1], '18');
  for (const [quality, crf] of [['high', '18'], ['balanced', '23'], ['compact', '28']]) {
    const args = buildBurnArguments('source.mp4', 'null', 'out.mp4', 'crop.filter', { ...DEFAULT_EXPORT_SETTINGS, quality });
    assert.equal(args[args.indexOf('-crf') + 1], crf);
    assert.ok(args.includes('crop.filter'));
    assert.ok(!args.includes('-b:v'));
  }
  const settings = { ...DEFAULT_EXPORT_SETTINGS, mode: 'bitrate', bitrateMbps: 2.5 };
  for (const args of [buildBurnArguments('in', 'null', 'out', null, settings), buildAudiogramArguments('audio', { width: 1080, height: 1920, background: '#000000' }, 'null', 'out', settings)]) {
    assert.equal(args[args.indexOf('-b:v') + 1], '2500k');
    assert.equal(args[args.indexOf('-b:a') + 1], '192k');
    assert.ok(!args.includes('-crf'));
  }
});

test('invalid persisted values recover; invalid request values are rejected', () => {
  for (const value of [null, [], {}, { ...DEFAULT_EXPORT_SETTINGS, mode: 'bogus' }, { ...DEFAULT_EXPORT_SETTINGS, quality: 'toString' },
    ...[0, -.5, .24, 100.01, Infinity, NaN, '8', null].map(bitrateMbps => ({ ...DEFAULT_EXPORT_SETTINGS, bitrateMbps }))]) {
    assert.throws(() => validateExportSettings(value));
    assert.deepEqual(sanitizeExportSettings(value), DEFAULT_EXPORT_SETTINGS);
  }
  for (const bitrateMbps of [.25, 100]) assert.equal(validateExportSettings({ ...DEFAULT_EXPORT_SETTINGS, bitrateMbps }).bitrateMbps, bitrateMbps);
});

test('size estimates respond to duration, bitrate, quality and export dimensions, including audio', () => {
  const dimensions = { width: 1920, height: 1080 };
  const manual = { ...DEFAULT_EXPORT_SETTINGS, mode: 'bitrate', bitrateMbps: 8 };
  const estimate = estimateExportSize(manual, 60, dimensions);
  assert.equal(estimate.bytes, (8 + .192) * 1_000_000 / 8 * 60 * 1.01);
  assert.equal(estimateExportSize(manual, 120, dimensions).bytes, estimate.bytes * 2);
  assert.ok(estimateExportSize({ ...manual, bitrateMbps: 16 }, 60).bytes > estimate.bytes);
  const high = estimateExportSize(DEFAULT_EXPORT_SETTINGS, 60, dimensions);
  const compact = estimateExportSize({ ...DEFAULT_EXPORT_SETTINGS, quality: 'compact' }, 60, dimensions);
  assert.ok(high.bytes > compact.bytes);
  assert.ok(estimateExportSize(DEFAULT_EXPORT_SETTINGS, 60, { width: 606, height: 1080 }).bytes < high.bytes);
  assert.ok(high.minBytes < high.bytes && high.maxBytes > high.bytes);
  for (const duration of [null, 0, -1, Infinity, NaN]) assert.equal(estimateExportSize(manual, duration), null);
});

test('FFmpeg fixtures produce smaller files at lower quality and bitrate with compatible audio/video', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'caption-export-settings-'));
  try {
    const source = path.join(dir, 'source.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', source]);
    const sizes = {};
    for (const [name, settings] of Object.entries({ high: DEFAULT_EXPORT_SETTINGS, compact: { ...DEFAULT_EXPORT_SETTINGS, quality: 'compact' },
      lowBitrate: { ...DEFAULT_EXPORT_SETTINGS, mode: 'bitrate', bitrateMbps: .25 }, highBitrate: { ...DEFAULT_EXPORT_SETTINGS, mode: 'bitrate', bitrateMbps: 2 } })) {
      const output = path.join(dir, `${name}.mp4`);
      execFileSync('ffmpeg', buildBurnArguments(source, 'null', output, null, settings));
      sizes[name] = (await stat(output)).size;
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8' }));
      assert.equal(probe.streams.find(s => s.codec_type === 'video').codec_name, 'h264');
      assert.equal(probe.streams.find(s => s.codec_type === 'video').pix_fmt, 'yuv420p');
      assert.equal(probe.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
    }
    assert.ok(sizes.compact < sizes.high * .8, JSON.stringify(sizes));
    assert.ok(sizes.lowBitrate < sizes.highBitrate * .5, JSON.stringify(sizes));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
