export type CaptionFont = {
  id: string;
  label: string;
  family: string;
  postScriptName: string;
  cssFamily: string;
  file: string;
  weight: number;
  emRatio: number;
  category: string;
  license: string;
  source: string;
};
export const CAPTION_FONTS: CaptionFont[];
export const DEFAULT_CAPTION_FONT_ID: string;
export function getCaptionFont(id: unknown): CaptionFont;
