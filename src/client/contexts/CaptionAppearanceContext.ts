import { createContext } from 'react';
import type { Segment } from '../types';
import type { CaptionOverrides } from '../../captionOverrides.js';
import type { CaptionLivePreview } from '../hooks/useCaptionLivePreview';

export const CaptionAppearanceContext = createContext<{
  segment: Segment | null;
  values: Required<CaptionOverrides>;
  live: CaptionLivePreview;
  disabled: boolean;
  // The caption looks different from when it was selected; Revert is available.
  dirty: boolean;
  saving: boolean;
  error: string | null;
  controlsOpen: boolean;
  showControls: () => void;
  select: (id: Segment['id'], options?: { deferControls?: boolean }) => void;
  // Changes are applied to the caption and saved automatically shortly after.
  change: (patch: CaptionOverrides) => void;
  // Applies the live patch once a gesture or slider drag ends.
  commit: (patch: CaptionOverrides) => void;
  reset: () => void;
  revert: () => void;
  retry: () => void;
  close: () => void;
} | null>(null);
