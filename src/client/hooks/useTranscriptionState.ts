import { useCallback, useEffect, useState } from "react";
import type { Segment } from "../types";
import { segmentsToSrt } from "../utils/transcriptionUtils";

type BurnedVideo = {
  url: string;
  name: string;
};

type SaveState = "idle" | "saving" | "success" | "error";

type UseTranscriptionStateProps = {
  responseSegments: Segment[];
  mediaUrl: string | null;
  isEditable: boolean;
  videoId: number | null;
  onSaveSegments: (segments: Segment[], subtitleContent: string) => Promise<void>;
};

export function useTranscriptionState({
  responseSegments,
  mediaUrl,
  isEditable,
  videoId,
  onSaveSegments,
}: UseTranscriptionStateProps) {
  const [editableSegments, setEditableSegments] = useState<Segment[]>(responseSegments);
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

  useEffect(() => {
    setEditableSegments(responseSegments.map((segment) => ({ ...segment })));
  }, [responseSegments]);

  useEffect(() => {
    setActiveSegmentId(null);
    setCurrentTime(0);
  }, [mediaUrl]);

  useEffect(() => {
    return () => {
      if (burnedVideo) {
        URL.revokeObjectURL(burnedVideo.url);
      }
    };
  }, [burnedVideo]);

  const persistSegments = useCallback(
    async (nextSegments: Segment[]) => {
      setEditableSegments(nextSegments);

      if (!isEditable || !videoId) {
        return;
      }

      setSaveState("saving");
      setSaveError(null);
      try {
        const subtitleContent = segmentsToSrt(nextSegments);
        await onSaveSegments(nextSegments, subtitleContent);
        setSaveState("success");
        setTimeout(() => setSaveState("idle"), 2000);
      } catch (error) {
        console.error(error);
        setSaveState("error");
        setSaveError("שמירת השינויים נכשלה. נסו שוב.");
      }
    },
    [isEditable, videoId, onSaveSegments],
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
      const newSegments = editableSegments.map((segment) =>
        segment.id === segmentId ? { ...segment, text: value } : segment,
      );
      await persistSegments(newSegments);
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

  return {
    // State
    editableSegments,
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
    // Handlers
    handleSegmentTextChange,
    handleSegmentTextChangeAndSave,
    handleSegmentBlur,
    persistSegments,
  };
}