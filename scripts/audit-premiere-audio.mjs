// Headless, unpaid diagnostics. API calls are intercepted before any network IO.
// Use copies of private source media; outputs stay in the requested directory.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Transcriptions } from 'openai/resources/audio/transcriptions';
import { probeAudio, decodeAudio, compareSamples } from './audio-audit-metrics.mjs';

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
  return pairs;
}, []));
for (const key of ['source', 'premiere', 'output']) if (!options[key]) throw new Error(`Missing --${key}`);
const output = path.resolve(options.output);
await fsp.mkdir(output, { recursive: true });
globalThis.__appEnvLoaded = true;
process.env.OPENAI_API_KEY = 'preparation-intercepted-no-network';
const { transcribeMedia } = await import('../src/transcription.js');
const stop = new Error('Preparation captured; no API call');
let captureTo;
const originalCreate = Transcriptions.prototype.create;
Transcriptions.prototype.create = async request => {
  const stream = request.file;
  try { await fsp.copyFile(stream.path, captureTo); }
  finally {
    stream.destroy();
    if (!stream.closed) await new Promise(resolve => stream.once('close', resolve));
  }
  throw stop;
};
try {
  for (const [inputPath, filename] of [[options.source, 'app.mp3'], [options.premiere, 'premiere-upload.mp3']]) {
    captureTo = path.join(output, filename);
    try { await transcribeMedia({ inputPath, languages: ['he'], secondaryLanguageMode: 'original', logger: {} }); }
    catch (error) { if (error !== stop) throw error; }
  }
} finally { Transcriptions.prototype.create = originalCreate; }

// Same conversion arguments as prepareAudioForTranscription, applied to the
// precise exported WAV. Additional WAV controls isolate metadata, rate, channels.
const raw = path.join(output, 'premiere.wav');
await fsp.copyFile(options.premiere, raw);
const conversions = {
  'premiere-normalized.mp3': ['-vn', '-ac', '1', '-ar', '16000', '-b:a', '128k'],
  'premiere-canonical.wav': ['-map_metadata', '-1', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le'],
  'premiere-mono16.wav': ['-map_metadata', '-1', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le'],
  'premiere-mono48.wav': ['-map_metadata', '-1', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le'],
};
for (const [name, args] of Object.entries(conversions)) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, ...args, path.join(output, name)]);
}
const reference = decodeAudio(options.source);
const variants = [];
for (const name of ['app.mp3', 'premiere-upload.mp3', 'premiere.wav', ...Object.keys(conversions)]) {
  const file = path.join(output, name), samples = decodeAudio(file);
  variants.push({ name, ...probeAudio(file), bytes: fs.statSync(file).size,
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    prefix: compareSamples(reference, samples, { end: 27.3, maxLag: 800 }),
    speech: compareSamples(reference, samples, { start: 30, end: 40, maxLag: 800 }) });
}
const report = { ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0],
  source: probeAudio(options.source), variants };
await fsp.writeFile(path.join(output, 'preparation.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
