import { useSyncExternalStore } from 'react';
import type { CaptionOverrides } from '../../captionOverrides.js';

// Gestures and sliders emit many updates per second. Routing each one through
// the editor state re-renders the whole editor, which stalls phones, so they
// write here and only the preview and the selected-caption panel subscribe.
export type CaptionLivePreview = {
  get: () => CaptionOverrides | null;
  subscribe: (listener: () => void) => () => void;
  set: (patch: CaptionOverrides | null) => void;
  // The patch stays visible until the committed draft renders, avoiding a flash back.
  settle: () => void;
  clearSettled: () => void;
};

export function createCaptionLivePreview(): CaptionLivePreview {
  let patch: CaptionOverrides | null = null, settling = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  return {
    get: () => patch,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: next => { if (next === patch && !settling) return; patch = next; settling = false; emit(); },
    settle: () => { settling = patch !== null; },
    clearSettled: () => { if (settling) { patch = null; settling = false; emit(); } },
  };
}

const idle = { get: () => null, subscribe: () => () => {} };
export function useCaptionLivePatch(store: CaptionLivePreview | null | undefined) {
  const source = store ?? idle;
  return useSyncExternalStore(source.subscribe, source.get, source.get);
}
