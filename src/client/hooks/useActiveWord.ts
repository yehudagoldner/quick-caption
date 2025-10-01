import { useMemo } from "react";
import type { Word } from "../types";

type UseActiveWordParams = {
  words: Word[] | undefined;
  currentTime: number;
  enabled: boolean;
};

/**
 * Hook to find the currently active word based on video playback time
 * @param words - Array of words with start/end timestamps
 * @param currentTime - Current video playback time in seconds
 * @param enabled - Whether active word highlighting is enabled
 * @returns The currently active word, or null if none is active or feature is disabled
 */
export function useActiveWord({ words, currentTime, enabled }: UseActiveWordParams): Word | null {
  return useMemo(() => {
    if (!enabled || !words || words.length === 0) {
      return null;
    }

    // Find the word that matches the current time
    const activeWord = words.find(
      (word) => currentTime >= word.start && currentTime < word.end
    );

    return activeWord ?? null;
  }, [words, currentTime, enabled]);
}
