export type CaptionOverrides = {
  fontId?: string;
  fontSize?: number;
  fontColor?: string;
  outlineColor?: string;
  activeWordColor?: string;
  positionXPercent?: number;
  offsetYPercent?: number;
  rotation?: number;
};
export function sanitizeCaptionOverrides(value: unknown): CaptionOverrides;
