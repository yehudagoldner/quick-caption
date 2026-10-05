export const TRANSCRIPTION_LANGUAGE_CODES: string[];
export type SecondaryLanguageMode = "original" | "translate" | "transliterate";
export const SECONDARY_LANGUAGE_MODES: SecondaryLanguageMode[];
export function validateSecondaryLanguageMode(mode?: unknown): SecondaryLanguageMode;
export function validateTranscriptionLanguages(languages: unknown): string[];
export function normalizeTranscriptionLanguages(languages: unknown): string[];
export function parseTranscriptionSettings(body?: Record<string, unknown>): { maxCharactersPerSubtitle: number | null; maxWordsPerSubtitle: number; languages: string[]; secondaryLanguageMode: SecondaryLanguageMode };
export function transcriptionLanguageOptions(languages: string[], secondaryLanguageMode?: SecondaryLanguageMode): { languages: string[]; targetLanguage?: string; primaryLanguage?: string; secondaryLanguageMode?: SecondaryLanguageMode; translate?: boolean; language?: string; prompt?: string };
export function transcriptionCorrectionPrompt(options: ReturnType<typeof transcriptionLanguageOptions>): string;
