export type DetectedPlatform = 'windows' | 'mac' | 'mobile' | 'unsupported' | 'unknown';
export function detectPlatform(browser?: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean };
}): DetectedPlatform;
