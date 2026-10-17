import type { Segment, Word } from "./client/types";
export function subtitleTokens(text: string): string[];
export function alignSequence(tokens: string[], source: Word[]): (Word | null)[];
export function synchronizeWords(segments: Segment[], originalWords?: Word[]): Word[];
export function mergeCorrectedSegments(baseSegments: Segment[], corrections: Segment[]): Segment[];
export function activeWordAtTime(words: Word[], time: number): Word | null;
