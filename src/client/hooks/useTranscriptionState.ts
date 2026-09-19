import { useCallback, useEffect, useMemo, useState } from "react";
import type { Segment, Word } from "../types";
import { segmentsToSrt, cleanSegmentText, fixSegmentOverlaps } from "../utils/transcriptionUtils";
import { reflowSubtitleCharacters } from "../../subtitleSegmentation.js";
import { synchronizeWords } from "../../wordAlignment.js";

type BurnedVideo = {
  url: string;
  name: string;
};

type SaveState = "idle" | "saving" | "success" | "error";

type UseTranscriptionStateProps = {
  responseSegments: Segment[];
  responseWords?: Word[];
  mediaUrl: string | null;
  isEditable: boolean;
  videoId: number | null;
  onSaveSegments: (segments: Segment[], subtitleContent: string, words?: Word[]) => Promise<void>;
};

export function useTranscriptionState({
  responseSegments,
  responseWords,
  mediaUrl,
  isEditable,
  videoId,
  onSaveSegments,
}: UseTranscriptionStateProps) {
  const [editableSegments, setEditableSegments] = useState<Segment[]>(responseSegments);
  const [wordTimingData, setEditableWords] = useState<Word[]>(responseWords ?? []);
  // Repair legacy/missing timing data on load and keep live text edits in sync.
  const editableWords = useMemo(() => synchronizeWords(editableSegments, wordTimingData), [editableSegments, wordTimingData]);
  const [activeSegmentId, setActiveSegmentId] = useState<Segment["id"] | null>(null);
  const [fontSize, setFontSize] = useState(60);
  const [fontColor, setFontColor] = useState("#ffffff");
  const [outlineColor, setOutlineColor] = useState("#000000");
  const [offsetYPercent, setOffsetYPercent] = useState(20);
  const [marginPercent, setMarginPercent] = useState(5);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);
  const [renderDimensions, setRenderDimensions] = useState<{ width: number; height: number } | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [isBurning, setIsBurning] = useState(false);
  const [burnedVideo, setBurnedVideo] = useState<BurnedVideo | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<Segment["id"] | null>(null);
  const [reflowUndo, setReflowUndo] = useState<{ segments: Segment[]; words: Word[]; after: string } | null>(null);
  const [activeWordEnabled, setActiveWordEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem("activeWordEnabled");
      return stored === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const cleaned = fixSegmentOverlaps(
      responseSegments.map((segment) => ({
        ...segment,
        text: cleanSegmentText(segment.text),
      }))
    );
    setEditableSegments(cleaned);
  }, [responseSegments]);

  useEffect(() => {
    setEditableWords(responseWords ?? []);
  }, [responseWords]);

  useEffect(() => {
    setActiveSegmentId(null);
    setCurrentTime(0);
    setReflowUndo(null);
  }, [mediaUrl, videoId]);

  useEffect(() => {
    return () => {
      if (burnedVideo) {
        URL.revokeObjectURL(burnedVideo.url);
      }
    };
  }, [burnedVideo]);

  const persistSegments = useCallback(
    async (nextSegments: Segment[], nextWords?: Word[], options?: { throwOnError?: boolean }) => {
      console.log('💾 persistSegments called:', {
        segmentsCount: nextSegments.length,
        hasWords: !!nextWords,
        wordsCount: nextWords?.length,
        firstSegmentText: nextSegments[0]?.text?.substring(0, 50)
      });
      setEditableSegments(nextSegments);
      const synchronizedWords = synchronizeWords(nextSegments, nextWords ?? editableWords);
      setEditableWords(synchronizedWords);
      console.log('💾 persistSegments - editableSegments state updated');

      if (!isEditable || !videoId) {
        console.log('💾 persistSegments - skipping save (not editable or no videoId)');
        return;
      }

      setSaveState("saving");
      setSaveError(null);
      try {
        const subtitleContent = segmentsToSrt(nextSegments);
        // Text and its word map are one revision; always persist them together.
        await onSaveSegments(nextSegments, subtitleContent, synchronizedWords);
        setSaveState("success");
        setTimeout(() => setSaveState("idle"), 2000);
      } catch (error) {
        console.error(error);
        setSaveState("error");
        setSaveError("שמירת השינויים נכשלה. נסו שוב.");
        if (options?.throwOnError) throw error;
      }
    },
    [isEditable, videoId, onSaveSegments, editableWords],
  );

  const handleSegmentTextChange = useCallback(
    (segmentId: Segment["id"], value: string) => {
      setEditableSegments((prev) =>
        prev.map((segment) => (segment.id === segmentId ? { ...segment, text: value } : segment)),
      );
    },
    [],
  );

  const handleSegmentTextChangeAndSave = useCallback(
    async (segmentId: Segment["id"], value: string) => {
      console.log('🔄 handleSegmentTextChangeAndSave called:', {
        segmentId,
        oldText: editableSegments.find(s => s.id === segmentId)?.text,
        newText: value
      });
      const newSegments = editableSegments.map((segment) =>
        segment.id === segmentId ? { ...segment, text: value } : segment,
      );
      console.log('🔄 handleSegmentTextChangeAndSave - calling persistSegments with updated segments');
      await persistSegments(newSegments);
      console.log('🔄 handleSegmentTextChangeAndSave - persistSegments complete');
    },
    [editableSegments, persistSegments],
  );

  const handleSegmentBlur = async (segmentId: Segment["id"]) => {
    if (!isEditable || !videoId) {
      return;
    }

    const original = responseSegments.find((segment) => segment.id === segmentId);
    const updated = editableSegments.find((segment) => segment.id === segmentId);

    if (!original || !updated || original.text === updated.text) {
      return;
    }

    await persistSegments(editableSegments.map((segment) => ({ ...segment })));
  };

  const handleAddSubtitle = useCallback(
    async (text: string, startTime: number, endTime: number) => {
      const newSegment: Segment = {
        id: Date.now(), // Simple ID generation
        start: startTime,
        end: endTime,
        text,
      };

      const newSegments = [...editableSegments, newSegment].sort((a, b) => a.start - b.start);
      setEditableSegments(newSegments);
      await persistSegments(newSegments);
    },
    [editableSegments, persistSegments],
  );

  const handleToggleActiveWord = useCallback(() => {
    setActiveWordEnabled((prev) => {
      const newValue = !prev;
      try {
        localStorage.setItem("activeWordEnabled", String(newValue));
      } catch (error) {
        console.warn("Failed to save activeWordEnabled to localStorage:", error);
      }
      return newValue;
    });
  }, []);

  const handleWordsChange = useCallback(
    async (words: Word[], segmentId?: Segment["id"], text?: string) => {
      console.log('🎤 handleWordsChange - updating editableWords:', {
        wordsCount: words.length,
        firstThree: words.slice(0, 3).map(w => ({ word: w.word, start: w.start, end: w.end }))
      });
      setEditableWords(words);

      if (!isEditable || !videoId) {
        console.log('🎤 handleWordsChange - skipping save (not editable or no videoId)');
        return;
      }

      // Save words along with segments
      console.log('🎤 handleWordsChange - calling persistSegments');
      const nextSegments = segmentId !== undefined && text !== undefined
        ? editableSegments.map(s => s.id === segmentId ? { ...s, text } : s)
        : editableSegments;
      await persistSegments(nextSegments, words);
      console.log('🎤 handleWordsChange - persistSegments complete');
    },
    [isEditable, videoId, editableSegments, persistSegments],
  );

  const handleResegment = useCallback(
    async (maxWords: number, customInstructions?: string) => {
      if (!editableWords || editableWords.length === 0) {
        console.warn("No words available for resegmentation");
        return;
      }

      setSaveState("saving"); // Reuse saving state to show activity
      try {
        const response = await fetch("/api/resegment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ words: editableWords, maxWords, customInstructions }),
        });

        if (!response.ok) {
          throw new Error("Resegmentation failed");
        }

        const data = await response.json();
        const newSegments = data.segments;

        const cleanedSegments = fixSegmentOverlaps(
          newSegments.map((s: Segment) => ({ ...s, text: cleanSegmentText(s.text) }))
        );

        console.log('🔄 handleResegment - new segments count:', cleanedSegments.length);
        await persistSegments(cleanedSegments, data.words ?? editableWords);
        setSaveState("success");
      } catch (error) {
        console.error("Failed to resegment:", error);
        setSaveState("error");
        setSaveError("שגיאה בפיצול מחדש");
      } finally {
        setTimeout(() => setSaveState("idle"), 2000);
      }
    },
    [editableWords, persistSegments]
  );

  const handleAIEdit = useCallback(
    async (instructions: string) => {
      if (!instructions.trim()) {
        console.warn("No instructions provided for AI edit");
        return;
      }

      setSaveState("saving");
      try {
        const response = await fetch("/api/ai-edit-subtitles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segments: editableSegments,
            words: editableWords,
            instructions: instructions.trim(),
          }),
        });

        if (!response.ok) {
          throw new Error("AI edit failed");
        }

        const data = await response.json();
        const newSegments = data.segments;

        const cleanedSegments = fixSegmentOverlaps(
          newSegments.map((s: Segment) => ({ ...s, text: cleanSegmentText(s.text) }))
        );

        console.log('🤖 handleAIEdit - new segments count:', cleanedSegments.length);
        if (data.reasoning) {
          console.log('🤖 AI reasoning:', data.reasoning);
        }
        await persistSegments(cleanedSegments, data.words ?? editableWords);
        setSaveState("success");
      } catch (error) {
        console.error("Failed to AI edit:", error);
        setSaveState("error");
        setSaveError("שגיאה בעריכת AI");
      } finally {
        setTimeout(() => setSaveState("idle"), 2000);
      }
    },
    [editableSegments, editableWords, persistSegments]
  );

  const handleDeleteSegment = useCallback(
    async (segmentId: Segment["id"]) => {
      const newSegments = editableSegments.filter((segment) => segment.id !== segmentId);
      await persistSegments(newSegments);
    },
    [editableSegments, persistSegments]
  );

  const handleSplitSegment = useCallback(
    async (segmentId: Segment["id"], splitTime: number) => {
      const index = editableSegments.findIndex(s => s.id === segmentId);
      if (index < 0) return;
      const segment = editableSegments[index];
      const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
      if (tokens.length < 2 || splitTime <= segment.start || splitTime >= segment.end) return;
      const timed = editableWords.filter(w => w.start >= segment.start - .001 && w.start < segment.end && w.end <= segment.end + .001);
      const aligned = timed.length === tokens.length && timed.every((w, i) => w.word.trim() === tokens[i]);
      let boundary = Math.min(tokens.length - 1, Math.max(1, Math.round(tokens.length * (splitTime - segment.start) / (segment.end - segment.start))));
      if (aligned) {
        boundary = 1;
        for (let i = 2; i < timed.length; i++) {
          if (Math.abs(timed[i].start - splitTime) < Math.abs(timed[boundary].start - splitTime)) boundary = i;
        }
      }
      const fallbackTime = segment.start + (segment.end - segment.start) * boundary / tokens.length;
      const stamp = Date.now();
      const next = [
        { ...segment, id: `split-${stamp}-a`, end: aligned ? timed[boundary - 1].end : fallbackTime, text: tokens.slice(0, boundary).join(" ") },
        { ...segment, id: `split-${stamp}-b`, start: aligned ? timed[boundary].start : fallbackTime, text: tokens.slice(boundary).join(" ") },
      ];
      await persistSegments([...editableSegments.slice(0, index), ...next, ...editableSegments.slice(index + 1)]);
    },
    [editableSegments, editableWords, persistSegments],
  );

  // An undo is valid only immediately after this reflow: never overwrite a
  // subsequent manual edit, clip move, deletion, or word timing adjustment.
  const canUndoReflow = reflowUndo !== null && reflowUndo.after === JSON.stringify([editableSegments, editableWords]);
  const handleCharacterReflow = async (limit: number | null) => {
    const next = reflowSubtitleCharacters(editableSegments, editableWords, limit);
    next.words = synchronizeWords(next.segments, next.words);
    setReflowUndo({ segments: editableSegments.map(s => ({ ...s })), words: editableWords.map(w => ({ ...w })), after: JSON.stringify([next.segments, next.words]) });
    setSelectedSegmentId(null);
    setActiveSegmentId(null);
    await persistSegments(next.segments, next.words, { throwOnError: true });
  };
  const handleUndoReflow = async () => {
    if (!reflowUndo || !canUndoReflow) return;
    try {
      await persistSegments(reflowUndo.segments, reflowUndo.words, { throwOnError: true });
    } catch (error) {
      // Optimistic state is already restored; retain a retryable undo if its
      // persistence failed rather than silently reporting a completed undo.
      setReflowUndo({ ...reflowUndo, after: JSON.stringify([reflowUndo.segments, reflowUndo.words]) });
      throw error;
    }
    setReflowUndo(null);
    setSelectedSegmentId(null);
    setActiveSegmentId(null);
  };

  return {
    // State
    editableSegments,
    editableWords,
    activeSegmentId,
    setActiveSegmentId,
    fontSize,
    setFontSize,
    fontColor,
    setFontColor,
    outlineColor,
    setOutlineColor,
    offsetYPercent,
    setOffsetYPercent,
    marginPercent,
    setMarginPercent,
    videoDimensions,
    setVideoDimensions,
    renderDimensions,
    setRenderDimensions,
    videoDuration,
    setVideoDuration,
    currentTime,
    setCurrentTime,
    burnError,
    setBurnError,
    isBurning,
    setIsBurning,
    burnedVideo,
    setBurnedVideo,
    saveState,
    saveError,
    selectedSegmentId,
    setSelectedSegmentId,
    activeWordEnabled,
    // Handlers
    handleSegmentTextChange,
    handleSegmentTextChangeAndSave,
    handleSegmentBlur,
    handleAddSubtitle,
    handleDeleteSegment,
    handleSplitSegment,
    handleToggleActiveWord,
    handleWordsChange,
    handleResegment,
    handleAIEdit,
    handleCharacterReflow,
    handleUndoReflow,
    canUndoReflow,
    persistSegments,
  };
}
