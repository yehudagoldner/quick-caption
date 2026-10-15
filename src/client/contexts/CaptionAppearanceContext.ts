import { createContext } from 'react';
import type { Segment } from '../types';
import type { CaptionOverrides } from '../../captionOverrides.js';

export const CaptionAppearanceContext = createContext<{
  segment: Segment | null;
  values: Required<CaptionOverrides>;
  disabled: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  controlsOpen: boolean;
  showControls: () => void;
  select: (id: Segment['id'], options?: { deferControls?: boolean }) => void;
  change: (patch: CaptionOverrides) => void;
  reset: () => void;
  save: () => Promise<void>;
  close: () => void;
} | null>(null);
