import { createContext } from 'react';
import type { Segment } from '../types';
import type { WordOverrides, WordDelta } from '../../wordOverrides.js';

export const WordAppearanceContext = createContext<{
  versionId: string;
  disabled: boolean;
  saving: boolean;
  change: (segmentId: Segment['id'], indexes: number[], patch: WordOverrides | null) => Promise<void>;
  move: (segmentId: Segment['id'], indexes: number[], delta: WordDelta) => Promise<void>;
} | null>(null);
