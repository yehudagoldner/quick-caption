import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import settingsModule from '../premiere-plugin/transcription-settings.js';
import { pluginPolicy } from '../src/pluginPolicy.js';
import { parseTranscriptionSettings, TRANSCRIPTION_LANGUAGE_CODES } from '../src/transcriptionSettings.js';
const { normalizeSettings, transcriptionFields, LIMITS } = settingsModule;

test('all length modes and language modes produce the same settings accepted by the website upload parser', () => {
  const policy = pluginPolicy();
  for (const mode of ['characters', 'words', 'none']) for (const secondaryLanguageMode of policy.secondaryLanguageModes) {
    const settings = normalizeSettings({ mode, characters: 17, words: 8, languages: ['he', 'en', 'ar'], secondaryLanguageMode }, policy);
    const fields = transcriptionFields(settings, policy);
    assert.deepEqual(parseTranscriptionSettings(fields), {
      maxCharactersPerSubtitle: mode === 'characters' ? 17 : null,
      maxWordsPerSubtitle: mode === 'words' ? 8 : 0,
      languages: ['he', 'en', 'ar'], secondaryLanguageMode,
    });
    assert.equal('maxCharactersPerSubtitle' in fields, mode === 'characters');
  }
});

test('plugin length boundaries agree with the server and invalid stored choices cannot be submitted', () => {
  const policy = pluginPolicy();
  for (const mode of ['characters', 'words']) {
    for (const value of [LIMITS[mode].min, LIMITS[mode].max]) {
      const settings = normalizeSettings({ mode, [mode]: value }, policy);
      assert.doesNotThrow(() => parseTranscriptionSettings(transcriptionFields(settings, policy)));
    }
    const settings = normalizeSettings({}, policy);
    settings.mode = mode; settings[mode] = LIMITS[mode].max + 1;
    assert.throws(() => transcriptionFields(settings, policy));
    assert.throws(() => parseTranscriptionSettings({ [mode === 'characters' ? 'maxCharactersPerSubtitle' : 'maxWordsPerSubtitle']: String(settings[mode]) }));
  }
});

test('all currently supported languages have labels without depending on Intl in Premiere', async () => {
  const labels = JSON.parse(await readFile(new URL('../premiere-plugin/language-labels.json', import.meta.url), 'utf8'));
  for (const code of TRANSCRIPTION_LANGUAGE_CODES) assert.match(labels[code], / · /);
});
