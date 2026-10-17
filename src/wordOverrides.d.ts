import type { Word, Segment } from './client/types';
export type WordOverrides = { fontColor?: string; fontScale?: number; bold?: boolean };
export function sanitizeWordOverrides(value: unknown): WordOverrides;
export function styleCaptionWords(words: Word[], segmentId: Segment['id'], indexes: number[], patch: WordOverrides | null): Word[];
