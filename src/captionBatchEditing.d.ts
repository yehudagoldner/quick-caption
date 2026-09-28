import type { Segment, Word } from "./client/types";
export function canMergeCaptions(segments: Segment[], selectedIds: Segment["id"][]): boolean;
export function editCaptionBatch(segments: Segment[], words: Word[], selectedIds: Segment["id"][], action: "merge" | "delete"): { segments: Segment[]; words: Word[] };
