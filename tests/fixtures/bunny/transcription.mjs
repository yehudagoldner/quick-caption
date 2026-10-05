export * from '../security/transcription.mjs';
import { readFile } from 'node:fs/promises';
export const transcribeMedia = async ({ inputPath }) => {
  console.log(`FIXTURE_INPUT=${inputPath}`);
  if ((await readFile(inputPath, 'utf8')).includes('FAIL_AI')) throw new Error('Synthetic AI failure');
  const segments = [{ id: 1, start: 0, end: 1, text: 'Synthetic caption' }];
  return { text: 'Synthetic caption', segments, words: [], subtitle: { format: '.srt', content: 'Synthetic caption' }, usage: {} };
};
export const transcribeWithWordTimestamps = transcribeMedia;
