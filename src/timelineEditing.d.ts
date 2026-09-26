import type { Segment, Word } from "./client/types";
export function timelineZoomForWindow(duration: number, seconds?: number): number;
export function mobileTimelineWindowSeconds(segments: Segment[], viewportWidth: number, duration: number): number;
export const MIN_MOBILE_CAPTION_SECONDS: number;
export function placeMobileCaption(segment: Segment, segments: Segment[], duration: number, deltaSeconds: number, mode: "move" | "start" | "end", fps?: number): Segment[];
export function placeCaption(segment: Segment, segments: Segment[], words: Word[], duration: number, deltaSeconds: number, mode: "move" | "start" | "end", fps?: number): { start: number; end: number };
export function timelineScrollForTime(time: number, pixelsPerSecond: number, width: number, scrollLeft: number): number;
export type EditSnapshot = { segments: Segment[]; words: Word[] };
export function validateCaptionRange(segment: Segment, segments: Segment[], duration: number): string | null;
export function wordsForSegment(words: Word[], segment: Segment): Word[];
export function retimeCaption(original: Segment, next: Segment, words: Word[], fitWords?: boolean): Word[];
export function validateWordRange(word: Word, segment: Segment, others?: Word[]): string | null;
export function placeMobileWord(words: Word[], index: number, segment: Segment, delta: number, mode: "move" | "start" | "end", fps?: number): Word[];
export function snapshot(segments: Segment[], words: Word[]): EditSnapshot;
export class EditHistory {
  past: EditSnapshot[];
  future: EditSnapshot[];
  push(before: EditSnapshot, after: EditSnapshot): void;
  undo(current: EditSnapshot): EditSnapshot | null;
  redo(current: EditSnapshot): EditSnapshot | null;
}
