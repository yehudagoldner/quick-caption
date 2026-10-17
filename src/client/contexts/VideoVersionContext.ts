import { createContext } from 'react';
import type { VideoCrop } from '../../videoVersions.js';
export const VideoVersionContext = createContext<{
  activeId: string; crop: VideoCrop | null; disabled: boolean;
  updateCrop: (crop: VideoCrop) => void; splitAll: (time: number) => Promise<void>;
} | null>(null);
