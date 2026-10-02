import type { CaptionFontSizeSetting } from './captionStyle.js';
import type { CaptionMotion, PopIntensity } from './captionMotion.js';
export type CaptionAppearance = { fontId: string; fontSize: CaptionFontSizeSetting; fontColor: string; outlineColor: string; activeWordColor: string; activeWordEnabled: boolean; offsetYPercent: number; marginPercent: number; captionMotion: CaptionMotion; popIntensity: PopIntensity };
export type CaptionPreset = { id: string; name: string; category: string; description: string; style: CaptionAppearance };
export const CAPTION_PRESETS: CaptionPreset[];
export function sanitizeCaptionAppearance(value?: Partial<CaptionAppearance>): CaptionAppearance;
export function sameCaptionAppearance(left: Partial<CaptionAppearance>, right: Partial<CaptionAppearance>): boolean;
export function readCustomCaptionPresets(raw: string | null): CaptionPreset[];
