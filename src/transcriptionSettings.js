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

export function parseTranscriptionSettings(body = {}) {
  const maxCharactersPerSubtitle = body.maxCharactersPerSubtitle === undefined ? null : Number(body.maxCharactersPerSubtitle);
  const maxWordsPerSubtitle = body.maxWordsPerSubtitle === undefined ? 5 : Number(body.maxWordsPerSubtitle);
  if (maxCharactersPerSubtitle !== null && (!Number.isInteger(maxCharactersPerSubtitle) || maxCharactersPerSubtitle < 7 || maxCharactersPerSubtitle > 20)) {
    throw new RangeError("מגבלת התווים חייבת להיות בין 7 ל־20");
  }
  if (!Number.isInteger(maxWordsPerSubtitle) || maxWordsPerSubtitle < 0 || maxWordsPerSubtitle > 30) {
    throw new RangeError("מגבלת המילים חייבת להיות בין 1 ל־30, או 0 ללא הגבלה");
  }
  let languages;
  if (body.languages !== undefined) {
    try { languages = validateTranscriptionLanguages(JSON.parse(body.languages)); }
    catch { throw new RangeError("בחרו שפות מתוך רשימת שפות התמלול"); }
  }
  return { maxCharactersPerSubtitle, maxWordsPerSubtitle, languages };
}

export function transcriptionLanguageOptions(languages) {
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  return {
    languages,
    language: languages.length === 1 ? (languages[0] === "jv" ? "jw" : languages[0]) : undefined,
    ...(languages.length > 1 ? { prompt: `The recording contains speech in ${languages.map(code => names.of(code)).join(", ")}. Preserve each spoken language without translating.` } : {}),
  };
}
