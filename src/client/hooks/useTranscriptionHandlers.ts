import type { ChangeEvent } from "react";
import { useCallback } from "react";
import type { ApiResponse, Segment } from "../types";
import type { BurnOptions } from "../components/VideoToolbar";
import { findSegment } from "../utils/transcriptionUtils";

type BurnResult = {
  blob: Blob;
  filename?: string;
};

type BurnedVideo = {
  url: string;
  name: string;
};

type UseTranscriptionHandlersProps = {
  editableSegments: Segment[];
  setActiveSegmentId: (id: Segment["id"] | null) => void;
  setCurrentTime: (time: number) => void;
  setVideoDimensions: (dimensions: { width: number; height: number }) => void;
  setVideoDuration: (duration: number | null) => void;
  setRenderDimensions: (dimensions: { width: number; height: number }) => void;
  setFontSize: (size: number) => void;
  setFontColor: (color: string) => void;
  setOutlineColor: (color: string) => void;
  setOffsetYPercent: (percent: number) => void;
  setMarginPercent: (percent: number) => void;
  setBurnError: (error: string | null) => void;
  setIsBurning: (burning: boolean) => void;
  setBurnedVideo: (video: BurnedVideo | null) => void;
  persistSegments: (segments: Segment[]) => Promise<void>;
  videoPlayer: HTMLVideoElement | null;
  response: ApiResponse;
  downloadName: string;
  burnedVideo: BurnedVideo | null;
  fontSize: number;
  fontColor: string;
  outlineColor: string;
  offsetYPercent: number;
  marginPercent: number;
  videoDimensions: { width: number; height: number } | null;
  onBurn: (options: BurnOptions) => Promise<BurnResult>;
};

export function useTranscriptionHandlers({
  editableSegments,
  setActiveSegmentId,
  setCurrentTime,
  setVideoDimensions,
  setVideoDuration,
  setRenderDimensions,
  setFontSize,
  setFontColor,
  setOutlineColor,
  setOffsetYPercent,
  setMarginPercent,
  setBurnError,
  setIsBurning,
  setBurnedVideo,
  persistSegments,
  videoPlayer,
  response,
  downloadName,
  burnedVideo,
  fontSize,
  fontColor,
  outlineColor,
  offsetYPercent,
  marginPercent,
  videoDimensions,
  onBurn,
}: UseTranscriptionHandlersProps) {
  const handleVideoTimeUpdate = useCallback((nextTime: number) => {
    const segment = findSegment(editableSegments, nextTime);
    setActiveSegmentId(segment?.id ?? null);
    setCurrentTime(nextTime);
  }, [editableSegments, setActiveSegmentId, setCurrentTime]);

  const handleVideoLoadedMetadata = useCallback((dimensions: { width: number; height: number }, duration: number) => {
    setVideoDimensions(dimensions);
    if (!Number.isNaN(duration) && duration > 0) {
      setVideoDuration(duration);
    }
  }, [setVideoDimensions, setVideoDuration]);

  const handleVideoResize = useCallback((dimensions: { width: number; height: number }) => {
    setRenderDimensions(dimensions);
  }, [setRenderDimensions]);

  const handleTimelineTimeChange = useCallback((time: number) => {
    console.debug('🔥 Timeline time change called:', { time });

    if (!videoPlayer) {
      console.debug('🔥 No video player, updating time and segment directly');
      setCurrentTime(time);
      // Update active segment even when no video player
      const segment = findSegment(editableSegments, time);
      console.debug('🔥 Found segment for time', time, ':', segment);
      setActiveSegmentId(segment?.id ?? null);
      return;
    }
    const duration = Number.isFinite(videoPlayer.duration) && videoPlayer.duration > 0 ? videoPlayer.duration : undefined;
    const clamped = Math.max(0, duration ? Math.min(time, duration) : time);
    console.debug('🔥 Video player exists, clamped time:', clamped, 'duration:', duration);

    if (Math.abs(videoPlayer.currentTime - clamped) > 0.01) {
      videoPlayer.currentTime = clamped;
      console.debug('🔥 Updated video currentTime to:', clamped);
    }
    setCurrentTime(clamped);
    // Update active segment immediately when timeline changes
    const segment = findSegment(editableSegments, clamped);
    console.debug('🔥 Found segment for clamped time', clamped, ':', segment);
    setActiveSegmentId(segment?.id ?? null);
    console.debug('🔥 Set active segment ID to:', segment?.id ?? null);
  }, [videoPlayer, setCurrentTime, editableSegments, setActiveSegmentId]);

  const handleTimelineSegmentsChange = useCallback(
    async (nextSegments: Segment[]) => {
      const newSegments = nextSegments.map((segment) => ({ ...segment }));
      await persistSegments(newSegments);
    },
    [persistSegments],
  );

  const handleFontSizeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const numeric = Number(event.target.value);
    if (Number.isFinite(numeric)) {
      setFontSize(Math.min(96, Math.max(12, Math.round(numeric))));
    }
  }, [setFontSize]);

  const handleFontColorChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFontColor(event.target.value);
  }, [setFontColor]);

  const handleOutlineColorChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setOutlineColor(event.target.value);
  }, [setOutlineColor]);

  const handleOffsetYChange = useCallback((_: Event, value: number | number[]) => {
    setOffsetYPercent(Array.isArray(value) ? value[0] : value);
  }, [setOffsetYPercent]);

  const handleMarginChange = useCallback((_: Event, value: number | number[]) => {
    setMarginPercent(Array.isArray(value) ? value[0] : value);
  }, [setMarginPercent]);

  const handleBurnVideo = useCallback(async () => {
    if (!response.subtitle?.content) {
      setBurnError("לא נמצאו כתוביות מתאימות לצריבה.");
      return;
    }

    setIsBurning(true);
    setBurnError(null);
    try {
      const result = await onBurn({
        fontSize,
        fontColor,
        outlineColor,
        offsetYPercent,
        marginPercent,
        videoWidth: videoDimensions?.width ?? null,
        videoHeight: videoDimensions?.height ?? null,
      });
      if (burnedVideo) {
        URL.revokeObjectURL(burnedVideo.url);
      }
      const url = URL.createObjectURL(result.blob);
      const baseName = downloadName.replace(/\.[^.]+$/, "") || "video";
      const filename = result.filename ?? `${baseName}-burned.mp4`;
      setBurnedVideo({ url, name: filename });

      // Auto-download the burned video
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
    } catch (error) {
      setBurnError(error instanceof Error ? error.message : "אירעה שגיאה בזמן יצירת הווידאו.");
    } finally {
      setIsBurning(false);
    }
  }, [
    response.subtitle?.content,
    setBurnError,
    setIsBurning,
    onBurn,
    fontSize,
    fontColor,
    outlineColor,
    offsetYPercent,
    marginPercent,
    videoDimensions,
    burnedVideo,
    setBurnedVideo,
    downloadName,
  ]);

  return {
    handleVideoTimeUpdate,
    handleVideoLoadedMetadata,
    handleVideoResize,
    handleTimelineTimeChange,
    handleTimelineSegmentsChange,
    handleFontSizeChange,
    handleFontColorChange,
    handleOutlineColorChange,
    handleOffsetYChange,
    handleMarginChange,
    handleBurnVideo,
  };
}