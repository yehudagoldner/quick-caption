// Local synthetic benchmark; no account access or uploads.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { buildSubtitlesFilter } from '../routes/burnSubtitles.js';
import { buildBurnArguments, runBurnFfmpeg } from '../src/burnVideo.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'burn-benchmark-'));
try {
  const input = path.join(dir, 'source.mp4'), captions = path.join(dir, 'captions.srt');
  const generated = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=15', '-c:v', 'libx264', '-preset', 'ultrafast', input]);
  if (generated.status !== 0) throw new Error(generated.stderr.toString());
  await fs.writeFile(captions, '1\n00:00:00,000 --> 00:00:15,000\n\u202bבדיקת צריבת כתוביות בעברית\u202c\n');
  const filter = buildSubtitlesFilter(captions, { fontSize: 80, fontColor: '&H00FFFFFF', outlineColor: '&H00000000', offsetYPercent: 12, marginPercent: 5, videoWidth: 1920, videoHeight: 1080 });
  const results = [];
  for (const preset of ['medium', 'veryfast', 'medium', 'veryfast']) {
    const output = path.join(dir, `${preset}.mp4`);
    const args = buildBurnArguments(input, filter, output);
    args[args.indexOf('-preset') + 1] = preset;
    const start = performance.now();
    await runBurnFfmpeg(args);
    const result = { preset, seconds: +((performance.now() - start) / 1000).toFixed(2), bytes: (await fs.stat(output)).size };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const average = preset => results.filter(r => r.preset === preset).reduce((sum, r) => sum + r.seconds, 0) / 2;
  console.log(JSON.stringify({ source: '15 seconds, 1080p, 30fps, synthetic motion with Hebrew subtitles', mediumSeconds: average('medium'), veryfastSeconds: average('veryfast'), timeSavedPercent: +(100 * (1 - average('veryfast') / average('medium'))).toFixed(1) }));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
