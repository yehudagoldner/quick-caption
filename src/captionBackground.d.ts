export type CaptionBackground = { backgroundColor: string; backgroundOpacity: number };
export function sanitizeCaptionBackground(value?: Partial<CaptionBackground>): CaptionBackground;
export function captionBackgroundCss(value: Partial<CaptionBackground>): string;
export function captionBackgroundAss(value: Partial<CaptionBackground>): string;
