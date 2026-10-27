import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCaptionOverrides } from '../src/captionOverrides.js';
import { renderStyledCaptionsAss } from '../src/styledCaptions.js';
import { getCaptionFont } from '../src/captionFonts.js';
import { EditHistory, snapshot } from '../src/timelineEditing.js';
import { buildSubtitlesFilter } from '../routes/burnSubtitles.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const segments = [
  { id: 1, start: 0, end: 2, text: 'שלום עולם\nABC 123', style: { fontId: 'fredoka', fontSize: 64, fontColor: '#ff0000', outlineColor: '#00ff00', positionXPercent: 30, offsetYPercent: 40, rotation: 25, activeWordColor: '#0000ff' } },
  { id: 2, start: 2, end: 4, text: 'כתובית אחרת' },
];
const options = { videoWidth: 1000, videoHeight: 500, fontId: 'heebo', fontSize: 90, fontColor: '#ffffff', outlineColor: '#000000', offsetYPercent: 20 };

test('untrusted overrides are bounded, allowlisted and safe for ASS', () => {
  assert.deepEqual(sanitizeCaptionOverrides({ fontId: 'evil\\fnArial', fontSize: Infinity, fontColor: '#fff}\\p1', positionXPercent: -30,
    offsetYPercent: 200, rotation: 999, text: 'x', activeWordColor: '#102030', outlineColor: null }),
  { activeWordColor: '#102030', positionXPercent: 0, offsetYPercent: 100, rotation: 180 });
  assert.deepEqual(sanitizeCaptionOverrides(null), {});
  assert.deepEqual(sanitizeCaptionOverrides({ rotation: NaN, fontSize: -2 }), { fontSize: 12 });
  for (const activeWordEnabled of [false, true]) assert.deepEqual(sanitizeCaptionOverrides({ activeWordEnabled }), { activeWordEnabled });
  for (const activeWordEnabled of ['false', 'true', 0, 1, null, undefined]) assert.deepEqual(sanitizeCaptionOverrides({ activeWordEnabled }), {});
});

for (const globalEnabled of [false, true]) test(`per-caption active word overrides win over global ${globalEnabled} in burned ASS`, () => {
  const clips = [
    { id: 1, start: 0, end: 2, text: 'disabled words', style: { activeWordEnabled: false } },
    { id: 2, start: 2, end: 4, text: 'enabled words', style: { activeWordEnabled: true } },
    { id: 3, start: 4, end: 6, text: 'inherited words' },
  ];
  const ass = renderStyledCaptionsAss(clips, [], { ...options, activeWordEnabled: globalEnabled, activeWordColor: '#123456' });
  const events = ass.split('\n').filter(line => line.startsWith('Dialogue:'));
  const disabled = events.filter(line => line.includes('disabled'));
  const enabled = events.filter(line => line.includes('enabled'));
  const inherited = events.filter(line => line.includes('inherited'));
  assert.equal(disabled.length, 1);
  assert.ok(disabled[0].includes('0:00:00.00,0:00:02.00'));
  assert.ok(!disabled[0].includes('\\1c&H563412&'));
  assert.ok(enabled.some(line => line.includes('\\1c&H563412&')));
  assert.equal(inherited.some(line => line.includes('\\1c&H563412&')), globalEnabled);
});

for (const mode of ['normal', 'active', 'pop']) test(`${mode}: appearance belongs only to its caption and keeps timing and direction`, () => {
  const ass = renderStyledCaptionsAss(segments, [], { ...options, captionMotion: mode === 'pop' ? 'pop' : 'none', activeWordEnabled: mode === 'active' });
  const events = ass.split('\n').filter(line => line.startsWith('Dialogue:'));
  const first = events.filter(line => !line.includes('כתובית') && !line.includes('אחרת'));
  const second = events.filter(line => line.includes('כתובית') || line.includes('אחרת'));
  assert.ok(first.length && second.length);
  for (const line of first) {
    assert.ok(line.includes(`\\fn${getCaptionFont('fredoka').family}`));
    assert.match(line, /\\fs64\\1c&H0000ff&\\3c&H00ff00&\\frz-25\\pos\(300\.00,300\.00\)/);
    assert.ok(line.includes('\u202b'));
  }
  for (const line of second) {
    assert.ok(line.includes(`\\fn${getCaptionFont('heebo').family}`));
    assert.match(line, /\\fs90\\1c&Hffffff&\\3c&H000000&\\frz0/);
    assert.doesNotMatch(line, /\\pos|\\frz-25|\\fs64/);
  }
  if (mode === 'active') assert.match(ass, /\\1c&Hff0000&.*?\\1c&H0000ff&/);
  if (mode === 'normal') assert.ok(ass.includes('\\N'));
  if (mode === 'pop') assert.ok(ass.includes('\\t('));
});

test('text cannot inject ASS tags even when individual appearance is present', () => {
  const ass = renderStyledCaptionsAss([{ ...segments[0], text: '{\\pos(1,1)} hello\\N world' }], [], options);
  assert.ok(ass.includes('｛＼pos(1,1)｝'));
  assert.ok(ass.includes('hello＼N'));
  assert.doesNotMatch(ass, /\\pos\(1,1\)/);
});

test('appearance edits participate in undo and redo without changing neighboring captions', () => {
  const history = new EditHistory();
  const before = snapshot(segments.map(({ style, ...segment }) => segment), []);
  const after = snapshot(segments, []);
  history.push(before, after);
  assert.deepEqual(history.undo(after), before);
  assert.deepEqual(history.redo(before), after);
  assert.equal(after.segments[1].style, undefined);
});

test('FFmpeg draws independent fonts, colours, positions and rotation in all three modes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'caption-appearance-test-'));
  try {
    for (const mode of ['normal', 'active', 'pop']) {
      const subtitlePath = path.join(directory, `${mode}.ass`);
      await writeFile(subtitlePath, renderStyledCaptionsAss(segments, [], { ...options, captionMotion: mode === 'pop' ? 'pop' : 'none', activeWordEnabled: mode === 'active' }));
      const filter = buildSubtitlesFilter(subtitlePath, { ...options, fontColor: '&H00FFFFFF', outlineColor: '&H00000000', marginPercent: 5, wholeTextLayout: true });
      const render = at => {
        const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=1000x500:d=4', '-vf', filter,
          '-ss', String(at), '-frames:v', '1', '-pix_fmt', 'rgb24', '-threads', '1', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 2 * 1024 * 1024 });
        assert.equal(result.status, 0, result.stderr?.toString() ?? result.error?.message);
        const points = [];
        for (let i = 0; i < result.stdout.length; i += 3) {
          const [r, g, b] = result.stdout.subarray(i, i + 3);
          if (r > 100 || g > 100 || b > 100) points.push({ x: i / 3 % 1000, y: Math.floor(i / 3 / 1000), r, g, b });
        }
        assert.ok(points.length > 100, `${mode}: captions must be visible`);
        return points;
      };
      const first = render(.25), second = render(2.25);
      const centerX = points => points.reduce((sum, pixel) => sum + pixel.x, 0) / points.length;
      assert.ok(centerX(first) < 360, `${mode}: individual horizontal position must be applied`);
      assert.ok(centerX(second) > 450 && centerX(second) < 550, `${mode}: neighbor must stay centered`);
      assert.ok(first.some(p => p.g > p.r * 1.5 && p.g > p.b * 1.5), `${mode}: green outline missing`);
      assert.ok(second.some(p => p.r > 180 && p.g > 180 && p.b > 180), `${mode}: default white missing`);
      assert.ok(!second.some(p => p.r > 100 && p.r > p.g * 1.5 && p.r > p.b * 1.5), `${mode}: neighbor inherited red`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
