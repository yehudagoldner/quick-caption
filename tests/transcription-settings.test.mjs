import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscriptionSettings, TRANSCRIPTION_LANGUAGE_CODES } from '../src/transcriptionSettings.js';

test('explicit unlimited mode keeps zero rather than restoring the five-word default', () => {
  assert.deepEqual(parseTranscriptionSettings({ maxWordsPerSubtitle: '0', languages: '[]' }), { maxWordsPerSubtitle: 0, maxCharactersPerSubtitle: null, languages: [] });
  assert.equal(parseTranscriptionSettings().maxWordsPerSubtitle, 5);
  assert.equal(parseTranscriptionSettings({ maxWordsPerSubtitle: '3' }).maxWordsPerSubtitle, 3);
  assert.equal(parseTranscriptionSettings({ maxCharactersPerSubtitle: '12' }).maxCharactersPerSubtitle, 12);
});

test('language selection accepts the entire catalog and rejects malformed settings', () => {
  assert.ok(TRANSCRIPTION_LANGUAGE_CODES.length >= 98);
  assert.equal(new Set(TRANSCRIPTION_LANGUAGE_CODES).size, TRANSCRIPTION_LANGUAGE_CODES.length);
  assert.deepEqual(parseTranscriptionSettings({ languages: JSON.stringify(TRANSCRIPTION_LANGUAGE_CODES) }).languages, TRANSCRIPTION_LANGUAGE_CODES);
  assert.deepEqual(parseTranscriptionSettings({ languages: '["he","en","he"]' }).languages, ['he', 'en']);
  for (const body of [{ languages: '["invalid"]' }, { languages: '"he"' }, { languages: '{' }, { maxWordsPerSubtitle: '-1' }, { maxWordsPerSubtitle: '2.5' }, { maxCharactersPerSubtitle: '6' }]) {
    assert.throws(() => parseTranscriptionSettings(body), RangeError);
  }
});
