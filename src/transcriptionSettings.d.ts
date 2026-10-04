export const TRANSCRIPTION_LANGUAGE_CODES: string[];
export function validateTranscriptionLanguages(languages: unknown): string[];
export function parseTranscriptionSettings(body?: Record<string, unknown>): { maxCharactersPerSubtitle: number | null; maxWordsPerSubtitle: number; languages?: string[] };
export function transcriptionLanguageOptions(languages: string[]): { languages: string[]; language?: string; prompt?: string };
