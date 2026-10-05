// Language codes accepted by the multilingual transcription pipeline.
export const TRANSCRIPTION_LANGUAGE_CODES = [
  "he", "en", "ar", "ru", "zh", "de", "es", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "sv", "it", "id", "hi", "fi", "vi", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln", "ha", "ba", "jv", "su",
];

export function validateTranscriptionLanguages(languages) {
  if (!Array.isArray(languages) || languages.some(code => !TRANSCRIPTION_LANGUAGE_CODES.includes(code))) {
    throw new RangeError("בחרו שפות מתוך רשימת שפות התמלול");
  }
  return [...new Set(languages)];
}

export const SECONDARY_LANGUAGE_MODES = ["original", "translate", "transliterate"];

export function validateSecondaryLanguageMode(mode = "translate") {
  if (!SECONDARY_LANGUAGE_MODES.includes(mode)) {
    throw new RangeError("בחרו אופן הצגה תקין לשפות הנוספות");
  }
  return mode;
}

export function parseTranscriptionSettings(body = {}) {
  const maxCharactersPerSubtitle = body.maxCharactersPerSubtitle === undefined ? null : Number(body.maxCharactersPerSubtitle);
  const maxWordsPerSubtitle = body.maxWordsPerSubtitle === undefined ? 5 : Number(body.maxWordsPerSubtitle);
  if (maxCharactersPerSubtitle !== null && (!Number.isInteger(maxCharactersPerSubtitle) || maxCharactersPerSubtitle < 7 || maxCharactersPerSubtitle > 20)) {
    throw new RangeError("מגבלת התווים חייבת להיות בין 7 ל־20");
  }
  if (!Number.isInteger(maxWordsPerSubtitle) || maxWordsPerSubtitle < 0 || maxWordsPerSubtitle > 30) {
    throw new RangeError("מגבלת המילים חייבת להיות בין 1 ל־30, או 0 ללא הגבלה");
  }
  let languages = ["he"];
  if (body.languages !== undefined) {
    try { languages = normalizeTranscriptionLanguages(JSON.parse(body.languages)); }
    catch { throw new RangeError("בחרו שפות מתוך רשימת שפות התמלול"); }
  }
  const secondaryLanguageMode = validateSecondaryLanguageMode(body.secondaryLanguageMode);
  return { maxCharactersPerSubtitle, maxWordsPerSubtitle, languages, secondaryLanguageMode };
}

export function transcriptionLanguageOptions(languages, secondaryLanguageMode) {
  languages = normalizeTranscriptionLanguages(languages);
  if (secondaryLanguageMode !== undefined) validateSecondaryLanguageMode(secondaryLanguageMode);
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  return {
    languages,
    // Calls without the new setting retain the legacy output-language contract.
    targetLanguage: secondaryLanguageMode === undefined ? languages[0] : secondaryLanguageMode === "translate" ? "he" : undefined,
    ...(secondaryLanguageMode !== undefined ? { secondaryLanguageMode, primaryLanguage: languages[0], translate: false } : {}),
    language: languages.length === 1 ? (languages[0] === "jv" ? "jw" : languages[0]) : undefined,
    ...(languages.length > 1 ? { prompt: `The recording contains speech in ${languages.map(code => names.of(code)).join(", ")}. Preserve each spoken language without translating.` } : {}),
  };
}

export function transcriptionCorrectionPrompt(options) {
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  const preserveCues = "Preserve meaning, speaker intent, names, numbers, and the original caption timestamps. Return every base segment with its original id, start, and end, and non-empty text. Do not omit speech, invent content, merge segments, or split segments.";
  if (options.secondaryLanguageMode) {
    const primary = `${names.of(options.primaryLanguage)} (${options.primaryLanguage})`;
    const instructions = {
      original: "Preserve every spoken language in its original script. Never translate or transliterate speech.",
      translate: "Faithfully translate speech in languages other than the primary language into Hebrew (he). Do not transliterate foreign sentences.",
      transliterate: "Phonetically transliterate speech in languages other than the primary language into Hebrew letters, preserving the foreign words and their pronunciation. Never translate their meaning. For example, when English is not the primary language, 'Good morning' becomes 'גוד מורנינג', not 'בוקר טוב'. Speech already in Hebrew stays in Hebrew.",
    };
    return `You are an expert multilingual transcription editor. The primary language is ${primary}; keep speech in this language in its original language and script. ${instructions[options.secondaryLanguageMode]} Apply this rule to each spoken phrase, including code-switching within a segment; do not convert primary-language phrases in mixed segments. The expected spoken languages are ${options.languages.join(", ")}; use this context and both transcripts to resolve ambiguous words and accents. ${preserveCues}`;
  }
  return options.targetLanguage
    ? `You are an expert multilingual transcription editor and translator. Output ALL subtitle text in ${names.of(options.targetLanguage)} (${options.targetLanguage}). Transcribe speech already in this target language and faithfully translate speech in any other language into this target language. The expected spoken languages are ${options.languages.join(", ")}; use this context and both transcripts to resolve ambiguous words, accents, and code-switching. ${preserveCues} Do not transliterate foreign sentences.`
    : "You are an expert multilingual transcription editor. Improve accuracy and grammar while preserving meaning, speaker intent, timestamps, and every original spoken language. Never translate the transcript.";
}

// The first selection is the primary language; later selections are additional
// languages expected in the recording. Preserve the user's order.
export function normalizeTranscriptionLanguages(languages) {
  const selected = validateTranscriptionLanguages(languages);
  return selected.length ? selected : ["he"];
}
