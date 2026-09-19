import { useEffect, useMemo, useState } from "react";
import { Alert, Card, CardContent, Stack } from "@mui/material";
import type { ApiResponse, Segment } from "../types";
import { useVideoPlayer } from "./VideoPlayer";
import type { BurnOptions } from "./VideoToolbar";
import { TranscriptionResultHeader } from "./TranscriptionResultHeader";
import { TranscriptionMainContent } from "./TranscriptionMainContent";
import { useTranscriptionState } from "../hooks/useTranscriptionState";
import { usePreviewStyle } from "../hooks/usePreviewStyle";
import { useTranscriptionHandlers } from "../hooks/useTranscriptionHandlers";
import { useVideoControls } from "../hooks/useVideoControls";
import { EditorSettings } from "./EditorSettings";
import { serializeSubtitles } from "../utils/subtitleExport";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { cleanSegmentText, fixSegmentOverlaps, findSegment } from "../utils/transcriptionUtils";
import { synchronizeWords } from "../../wordAlignment.js";

export type { BurnOptions };
type BurnResult = { blob: Blob; filename?: string; };

type TranscriptionResultProps = {
  response: ApiResponse;
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
  mediaUrl: string | null;
  onBack: () => void;
  onBurn: (options: BurnOptions) => Promise<BurnResult>;
  onSaveSegments: (segments: Segment[], subtitleContent: string, words?: any[]) => Promise<void>;
  videoId: number | null;
  isEditable: boolean;
};

export function TranscriptionResult({
  response,
  subtitleFormatLabel,
  downloadUrl: _originalDownloadUrl,
  downloadName: originalDownloadName,
  mediaUrl,
  onBack,
  onBurn,
  onSaveSegments,
  videoId,
  isEditable,
}: TranscriptionResultProps) {
  const { preferences } = useEditorPreferences();
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState(response.subtitle?.format || ".srt");
  const downloadName = originalDownloadName.replace(/\.[^.]+$/, "") + exportFormat;
  useEffect(() => { setExportFormat(response.subtitle?.format || ".srt"); }, [mediaUrl, videoId, response.subtitle?.format]);
  const videoPlayer = useVideoPlayer();
  const responseSegments = response.segments ?? [];
  const savedSegments = useMemo(() => fixSegmentOverlaps(responseSegments.map(segment => ({ ...segment, text: cleanSegmentText(segment.text) }))), [responseSegments]);
  const savedWords = useMemo(() => synchronizeWords(savedSegments, response.words), [savedSegments, response.words]);

  const {
    editableSegments,
    editableWords,
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
  } = useTranscriptionState({
    responseSegments,
    responseWords: response.words,
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

  useEffect(() => {
    const content = serializeSubtitles(editableSegments, exportFormat, preferences.direction);
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [editableSegments, exportFormat, preferences.direction]);


  const activeSegment = useMemo(() => findSegment(editableSegments, currentTime) ?? null, [editableSegments, currentTime]);

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
    editableWords,
    activeWordEnabled,
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
        <Stack spacing={1.5}>
          <TranscriptionResultHeader
            subtitleFormatLabel={subtitleFormatLabel}
            downloadUrl={downloadUrl}
            downloadName={downloadName}
            warnings={response.warnings}
            backDisabled={saveState === "saving" || isBurning}
            onBack={async () => {
              // Flush in-progress text edits before leaving the editor. Do not
              // navigate on save failure: the user must be able to retry.
              if (isEditable && (saveState === "error" || JSON.stringify(editableSegments) !== JSON.stringify(savedSegments) || JSON.stringify(editableWords) !== JSON.stringify(savedWords))) {
                try { await persistSegments(editableSegments, editableWords, { throwOnError: true }); }
                catch { return; }
              }
              onBack();
            }}
          />
          {saveState === "error" && <Alert severity="error">{saveError}</Alert>}
          {activeWordEnabled && editableWords.some(word => word.timingSource === "estimated") && <Alert severity="info">לחלק מהמילים הושלם תזמון משוער. אפשר לדייק אותן בציר המילים של המקטע; הטקסט המתוקן נשמר במלואו.</Alert>}

          <TranscriptionMainContent
            editorSettings={<EditorSettings disabled={!isEditable || saveState === "saving"} onApply={handleCharacterReflow} onUndo={handleUndoReflow} canUndo={canUndoReflow} exportFormat={exportFormat} onExportFormatChange={setExportFormat} />}
            mediaUrl={mediaUrl}
            activeSegmentText={activeSegment?.text ?? null}
            previewStyle={previewStyle}
            editableSegments={editableSegments}
            words={editableWords}
            isEditable={isEditable}
            videoDuration={videoDuration}
            renderDimensions={renderDimensions}
            currentTime={currentTime}
            selectedSegmentId={selectedSegmentId}
            activeSegmentId={activeSegment?.id ?? null}
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
            activeWordEnabled={activeWordEnabled}
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
            onDeleteSegment={handleDeleteSegment}
            onSplitSegment={handleSplitSegment}
            onToggleActiveWord={handleToggleActiveWord}
            onWordsChange={handleWordsChange}
            onResegment={handleResegment}
            onAIEdit={handleAIEdit}
            isPlaying={isPlaying}
            onPlayPause={handlePlayPause}
          />

        </Stack>
      </CardContent>
    </Card>
  );
}
