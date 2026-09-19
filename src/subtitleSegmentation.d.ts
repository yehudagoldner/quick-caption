import type { Segment, Word } from "./client/types";
export function characterCount(text: string): number;
export function reflowSubtitleCharacters(segments: Segment[], words?: Word[], maxCharacters?: number | null): { segments: Segment[]; words: Word[] };
export function limitSubtitleCharacters(segments: Segment[], words?: Word[], maxCharacters?: number): Segment[];
