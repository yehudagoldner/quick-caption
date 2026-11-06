import type { Segment, Word } from './client/types';
export const MIN_ADDED_WORD_FRAMES: number;
export function automaticCaptionEnd(segment: Segment, text: string, fps?: number): number;
export function editCaptionText(segment: Segment, words: Word[], text: string, fps?: number, duration?: number): { segment: Segment; words: Word[] };
export function applyCaptionTextEdit(segments: Segment[], words: Word[], edited: Segment, editedWords: Word[]): { segments: Segment[]; words: Word[] };
export function clipCaptionRanges(originalSegments: Segment[], nextSegments: Segment[], words: Word[]): { segments: Segment[]; words: Word[] };
