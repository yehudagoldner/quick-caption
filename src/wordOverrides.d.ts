import type { Word, Segment } from './client/types';
export type WordOverrides = { fontColor?: string; fontScale?: number; bold?: boolean; offsetX?: number; offsetY?: number };
export type WordDelta = { x: number; y: number };
export function moveCaptionWords(words: Word[], segmentId: Segment['id'], indexes: number[], delta: WordDelta): Word[];
export function wordDragDelta(dx: number, dy: number, fontSize: number, rotation?: number): WordDelta;
export function snapWordBottom(delta: WordDelta, movingBottom: number, targetBottom: number, fontSize: number, tolerance?: number): { delta: WordDelta; snapped: boolean };
export function sanitizeWordOverrides(value: unknown): WordOverrides;
export function styleCaptionWords(words: Word[], segmentId: Segment['id'], indexes: number[], patch: WordOverrides | null): Word[];
