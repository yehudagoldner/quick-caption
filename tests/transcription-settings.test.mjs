import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscriptionSettings, TRANSCRIPTION_LANGUAGE_CODES, transcriptionLanguageOptions } from '../src/transcriptionSettings.js';

test('explicit unlimited mode keeps zero rather than restoring the five-word default', () => {
  assert.deepEqual(parseTranscriptionSettings({ maxWordsPerSubtitle: '0', languages: '[]' }), { maxWordsPerSubtitle: 0, maxCharactersPerSubtitle: null, languages: ['he'] });
  assert.equal(parseTranscriptionSettings().maxWordsPerSubtitle, 5);
  assert.equal(parseTranscriptionSettings({ maxWordsPerSubtitle: '3' }).maxWordsPerSubtitle, 3);
  assert.equal(parseTranscriptionSettings({ maxCharactersPerSubtitle: '12' }).maxCharactersPerSubtitle, 12);
});

test('Hebrew is the default output language and the first selected language controls translation', () => {
  assert.deepEqual(parseTranscriptionSettings().languages, ['he']);
  assert.equal(transcriptionLanguageOptions([]).targetLanguage, 'he');
  assert.equal(transcriptionLanguageOptions(['ar', 'en', 'he']).targetLanguage, 'ar');
  assert.deepEqual(transcriptionLanguageOptions(['ar', 'en', 'he']).languages, ['ar', 'en', 'he']);
  assert.equal(transcriptionLanguageOptions(['ar', 'en']).language, undefined);
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
