// Invoke only in the EXISTING QA checkout, with approved cost and an explicit
// QC_AUDIO_AUDIT_APPROVED_CALLS=12 (main) or 4 (--controls).
// No app endpoint, user-credit change or DB write. Never run as an ordinary test.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { probeAudio, coverageSummary } from './audio-audit-metrics.mjs';

const directory = path.resolve(process.argv[2] || '');
const controls = process.argv[3] === '--controls';
const approved = Number(process.env.QC_AUDIO_AUDIT_APPROVED_CALLS);
if (approved !== (controls ? 4 : 12)) throw new Error('Explicit approved call budget is required');
const env = dotenv.parse(await fsp.readFile(path.join(process.cwd(), '.env')));
if (env.DB_NAME !== 'quickcaption_qa' || env.DB_USER !== 'quickcaption_qa') throw new Error('Must run in existing isolated QA');
if (!directory.startsWith('/home/quick-caption-qa/shared/tmp/')) throw new Error('Use the existing QA temporary storage');
const names = controls ? ['premiere-boosted.mp3', 'app-attenuated.mp3', 'premiere-padded.wav', 'premiere-first26.wav']
  : ['app.mp3', 'premiere.wav', 'premiere-normalized.mp3', 'premiere-canonical.wav', 'premiere-mono16.wav', 'premiere-mono48.wav'];
const rounds = controls ? 1 : 2;
let expected = 0;
for (const name of names) {
  if (fs.statSync(path.join(directory, name)).size > 25 * 1024 * 1024) throw new Error('Oversized input');
  const duration = probeAudio(path.join(directory, name)).duration;
  if (duration > 77 || duration < (name === 'premiere-first26.wav' ? 25 : 74)) throw new Error('Unexpected duration');
  expected += duration * rounds / 60 * 0.006;
}
if (expected > (controls ? 0.04 : 0.10)) throw new Error('Approved cost ceiling exceeded');
const ledgerPath = path.join(directory, controls ? 'control-calls.json' : 'calls.json');
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(await fsp.readFile(ledgerPath)) : [];
if (ledger.some(entry => entry.status !== 'completed')) throw new Error('Unknown prior outcome; do not repeat a paid request');
const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0, timeout: 120000 });
for (let round = 1; round <= rounds; round++) {
  // Reverse the second round to reduce a fixed-order confound.
  for (const name of round === 1 ? names : [...names].reverse()) {
    const id = `${name}:${round}`;
    if (ledger.some(entry => entry.id === id && entry.status === 'completed')) continue;
    if (ledger.length >= approved) throw new Error('Approved call count exceeded');
    const entry = { id, status: 'started', started: new Date().toISOString() };
    ledger.push(entry);
    await fsp.writeFile(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
    try {
      const result = await client.audio.transcriptions.create({ file: fs.createReadStream(path.join(directory, name)),
        model: 'whisper-1', temperature: 0, response_format: 'verbose_json', language: 'he', translate: false,
        timestamp_granularities: ['word', 'segment'] });
      const summary = coverageSummary(result);
      await fsp.writeFile(path.join(directory, `${name}.${round}.json`), JSON.stringify(result, null, 2), { mode: 0o600 });
      Object.assign(entry, { status: 'completed', finished: new Date().toISOString(), summary });
      await fsp.writeFile(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
      console.log('AUDIO_EXPERIMENT', JSON.stringify({ name, round, ...summary }));
    } catch (error) {
      entry.status = 'failed-or-unknown';
      await fsp.writeFile(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
      console.error('AUDIO_EXPERIMENT_FAILED', JSON.stringify({ id, status: error.status, name: error.name }));
      process.exitCode = 1;
      break;
    }
  }
  if (process.exitCode) break;
}
console.log('AUDIO_EXPERIMENT_BUDGET', JSON.stringify({ attempted: ledger.length, estimatedUSD: expected }));
