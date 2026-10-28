export type CaptionOverrides = {
  fontId?: string;
  fontSize?: number;
  backgroundColor?: string;
  backgroundOpacity?: number;
  fontColor?: string;
  outlineColor?: string;
  activeWordColor?: string;
  activeWordEnabled?: boolean;
  positionXPercent?: number;
  offsetYPercent?: number;
  rotation?: number;
};
export function sanitizeCaptionOverrides(value: unknown): CaptionOverrides;
