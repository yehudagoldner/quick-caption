import type { Segment, Word } from './client/types';
export type VideoCrop = { format: string; x: number; y: number; points?: { time: number; x: number; y: number }[] };
export type VideoRevision = { segments: Segment[]; words: Word[] };
export const VIDEO_FORMATS: { id: string; label: string; platforms: string; ratio: number | null }[];
export function validateVideoCrop(value: unknown): VideoCrop;
export function cropPosition(crop: VideoCrop, time?: number): { x: number; y: number };
export function cropRectangle(source: { width: number; height: number }, crop: VideoCrop | null, time?: number): { x: number; y: number; width: number; height: number };
export function cropFilter(crop: VideoCrop): string;
export function splitVideoVersions(versions: Record<string, VideoRevision>, time: number): Record<string, VideoRevision>;
