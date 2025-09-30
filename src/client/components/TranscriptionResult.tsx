import { useMemo } from "react";
import { Card, CardContent, Stack } from "@mui/material";
import type { ApiResponse, Segment } from "../types";
import { useVideoPlayer } from "./VideoPlayer";
import type { BurnOptions } from "./VideoToolbar";
import { TranscriptionResultHeader } from "./TranscriptionResultHeader";
import { TranscriptionMainContent } from "./TranscriptionMainContent";
import { useTranscriptionState } from "../hooks/useTranscriptionState";
import { usePreviewStyle } from "../hooks/usePreviewStyle";
import { useTranscriptionHandlers } from "../hooks/useTranscriptionHandlers";
import { useVideoControls } from "../hooks/useVideoControls";

export type { BurnOptions };
type BurnResult = { blob: Blob; filename?: string; };
type BurnedVideo = { url: string; name: string; };
type SaveState = "idle" | "saving" | "success" | "error";

type TranscriptionResultProps = {
  response: ApiResponse;
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
  mediaUrl: string | null;
  onBack: () => void;
  onBurn: (options: BurnOptions) => Promise<BurnResult>;
  onSaveSegments: (segments: Segment[], subtitleContent: string) => Promise<void>;
  videoId: number | null;
  isEditable: boolean;
};

export function TranscriptionResult({
  response,
  subtitleFormatLabel,
  downloadUrl,
  downloadName,
  mediaUrl,
  onBack,
  onBurn,
  onSaveSegments,
  videoId,
  isEditable,
}: TranscriptionResultProps) {
  const videoPlayer = useVideoPlayer();
  const responseSegments = response.segments ?? [];

  const {
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
    handleSegmentTextChange,
    handleSegmentTextChangeAndSave,
    handleSegmentBlur,
    handleAddSubtitle,
    persistSegments,
  } = useTranscriptionState({
    responseSegments,
    mediaUrl,
    isEditable,
    videoId,
    onSaveSegments,
  });

  const previewStyle = usePreviewStyle({
    fontColor,
    fontSize,
    offsetYPercent,
    outlineColor,
    marginPercent,
    videoDimensions,
    renderDimensions,
  });


  const activeSegment = useMemo(
    () => {
      const segment = editableSegments.find((segment) => segment.id === activeSegmentId) ?? null;
      console.debug('🎯 Active segment computed:', {
        activeSegmentId,
        segmentFound: segment,
        segmentText: segment?.text,
        totalSegments: editableSegments.length
      });
      return segment;
    },
    [editableSegments, activeSegmentId],
  );

  const { isPlaying, handlePlayPause } = useVideoControls(videoPlayer);

  const {
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
  } = useTranscriptionHandlers({
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
  });

  return (
    <Card elevation={3}>
      <CardContent>
        <Stack spacing={3}>
          <TranscriptionResultHeader
            subtitleFormatLabel={subtitleFormatLabel}
            downloadUrl={downloadUrl}
            downloadName={downloadName}
            warnings={response.warnings}
            onBack={onBack}
          />

          <TranscriptionMainContent
            mediaUrl={mediaUrl}
            activeSegmentText={activeSegment?.text ?? null}
            previewStyle={previewStyle}
            editableSegments={editableSegments}
            isEditable={isEditable}
            videoDuration={videoDuration}
            renderDimensions={renderDimensions}
            currentTime={currentTime}
            selectedSegmentId={selectedSegmentId}
            activeSegmentId={activeSegmentId}
            fontSize={fontSize}
            fontColor={fontColor}
            outlineColor={outlineColor}
            offsetYPercent={offsetYPercent}
            marginPercent={marginPercent}
            isBurning={isBurning}
            burnError={burnError}
            burnedVideo={burnedVideo}
            videoDimensions={videoDimensions}
            saveState={saveState}
            saveError={saveError}
            downloadUrl={downloadUrl}
            downloadName={downloadName}
            onVideoTimeUpdate={handleVideoTimeUpdate}
            onVideoLoadedMetadata={handleVideoLoadedMetadata}
            onVideoResize={handleVideoResize}
            onTimelineSegmentsChange={handleTimelineSegmentsChange}
            onTimelineTimeChange={handleTimelineTimeChange}
            onSegmentSelect={setSelectedSegmentId}
            onSegmentTextChangeAndSave={handleSegmentTextChangeAndSave}
            onSegmentTextChange={handleSegmentTextChange}
            onSegmentBlur={handleSegmentBlur}
            onFontSizeChange={handleFontSizeChange}
            onFontColorChange={handleFontColorChange}
            onOutlineColorChange={handleOutlineColorChange}
            onOffsetYChange={handleOffsetYChange}
            onMarginChange={handleMarginChange}
            onBurnVideo={handleBurnVideo}
            onAddSubtitle={handleAddSubtitle}
            isPlaying={isPlaying}
            onPlayPause={handlePlayPause}
          />

        </Stack>
      </CardContent>
    </Card>
  );
}