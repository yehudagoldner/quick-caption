import type { Segment, Word } from "./client/types";
export function canMergeCaptions(segments: Segment[], selectedIds: Segment["id"][]): boolean;
export type CaptionBatchAction = "merge" | "delete" | "split";
export function canSplitCaptionAtTime(segment: Segment | undefined, time: number): boolean;
export function editCaptionBatch(segments: Segment[], words: Word[], selectedIds: Segment["id"][], action: CaptionBatchAction, splitTime?: number): { segments: Segment[]; words: Word[] };
