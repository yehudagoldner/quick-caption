// Mirrors the website's initial settings and its existing upload contract.
// Languages and presentation modes are always restricted by the live server policy.
const LIMITS = { characters: { min: 7, max: 20 }, words: { min: 1, max: 30 } };
const MODES = ['original', 'translate', 'transliterate'];
function normalizeSettings(saved = {}, policy = {}) {
  const supported = Array.isArray(policy.languages) && policy.languages.length ? policy.languages : ['he'];
  const fallback = supported.includes(policy.defaults?.languages?.[0]) ? policy.defaults.languages[0] : supported[0];
  const languages = [...new Set((Array.isArray(saved.languages) ? saved.languages : [fallback]).filter(code => supported.includes(code)))];
  const bounded = (value, kind, initial) => Number.isInteger(value) && value >= LIMITS[kind].min && value <= LIMITS[kind].max ? value : initial;
  const modes = Array.isArray(policy.secondaryLanguageModes) && policy.secondaryLanguageModes.length ? policy.secondaryLanguageModes : MODES;
  return {
    mode: ['characters', 'words', 'none'].includes(saved.mode) ? saved.mode : 'characters',
    characters: bounded(saved.characters, 'characters', 20),
    words: bounded(saved.words, 'words', 5),
    languages: languages.length ? languages : [fallback],
    secondaryLanguageMode: modes.includes(saved.secondaryLanguageMode) ? saved.secondaryLanguageMode : (modes.includes('original') ? 'original' : modes[0]),
    activeWord: saved.activeWord === true,
    activeWordColor: /^#[0-9a-f]{6}$/i.test(saved.activeWordColor || '') ? saved.activeWordColor.toUpperCase() : '#FFD45A',
  };
}
function transcriptionFields(settings, policy) {
  const current = normalizeSettings(settings, policy);
  if (['mode', 'characters', 'words', 'secondaryLanguageMode'].some(key => current[key] !== settings[key]) || JSON.stringify(current.languages) !== JSON.stringify(settings.languages)) throw new Error('הגדרות התמלול השתנו או אינן תקינות. בדקו את ההגדרות ואת המחיר שוב.');
  return {
    languages: JSON.stringify(current.languages),
    secondaryLanguageMode: current.secondaryLanguageMode,
    maxWordsPerSubtitle: String(current.mode === 'words' ? current.words : 0),
    ...(current.mode === 'characters' ? { maxCharactersPerSubtitle: String(current.characters) } : {}),
  };
}
module.exports = { LIMITS, normalizeSettings, transcriptionFields };
