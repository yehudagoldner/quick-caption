import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, CardContent, Stack } from "@mui/material";
import type { ApiResponse, Segment } from "../types";
import { useVideoPlayer } from "./VideoPlayer";
import type { BurnOptions } from "./VideoToolbar";
import { TranscriptionResultHeader } from "./TranscriptionResultHeader";
import { TranscriptionMainContent } from "./TranscriptionMainContent";
import { useTranscriptionState } from "../hooks/useTranscriptionState";
import { usePreviewStyle } from "../hooks/usePreviewStyle";
import { useTranscriptionHandlers } from "../hooks/useTranscriptionHandlers";
import { useVideoControls } from "../hooks/useVideoControls";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
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
  onMyVideos: () => void;
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
  onMyVideos,
  onBurn,
  onSaveSegments,
  videoId,
  isEditable,
}: TranscriptionResultProps) {
  const { preferences } = useEditorPreferences();
  const [hasTimelineDrafts, setHasTimelineDrafts] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
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
    handleUndoSplit,
    canUndoSplit,
    handleToggleActiveWord,
    handleWordsChange,
    handleResegment,
    handleAIEdit,
    handleCharacterReflow,
    handleUndoReflow,
    canUndoReflow,
    persistSegments,
    handleSaveSegment,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
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
  // Fresh transcriptions already include this notice in the server warnings.
  // Keep the editor fallback for older results and newly edited word timings.
  const hasEstimatedTimingWarning = response.warnings?.some(warning => warning.includes("תזמון משוער")) ?? false;

  const { isPlaying, handlePlayPause } = useVideoControls(videoPlayer);
  const narrow = useNarrowViewport();

  const leaveEditor = async (destination: () => void) => {
    if (isEditable && (saveState === "error" || JSON.stringify(editableSegments) !== JSON.stringify(savedSegments) || JSON.stringify(editableWords) !== JSON.stringify(savedWords))) {
      try { await persistSegments(editableSegments, editableWords, { throwOnError: true }); }
      catch { return; }
    }
    destination();
  };
  const handleLeaveEditor = () => leaveEditor(onBack);
  const handleMyVideos = () => leaveEditor(onMyVideos);

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
    <Card elevation={narrow ? 0 : 3} sx={{ overflow: "visible", ...(narrow ? { bgcolor: "transparent", boxShadow: "none" } : {}) }}>
      <CardContent sx={narrow ? { p: 0, "&:last-child": { pb: 0 } } : undefined}>
        <Stack spacing={narrow ? 0 : 1.5}>
          {!narrow && (
          <TranscriptionResultHeader
            subtitleFormatLabel={subtitleFormatLabel}
            downloadUrl={downloadUrl}
            downloadName={downloadName}
            warnings={response.warnings}
            backDisabled={saveState === "saving" || isBurning || hasTimelineDrafts}
            onBack={handleLeaveEditor}
          />
          )}
          {saveState === "error" && <Alert severity="error" action={<Button onClick={() => persistSegments(editableSegments, editableWords)}>נסה לשמור שוב</Button>}>{saveError}</Alert>}
          {!narrow && activeWordEnabled && !hasEstimatedTimingWarning && editableWords.some(word => word.timingSource === "estimated") && <Alert severity="info">לחלק מהמילים הושלם תזמון משוער. אפשר לדייק אותן בציר המילים של המקטע; הטקסט המתוקן נשמר במלואו.</Alert>}

          <TranscriptionMainContent
            hasTimelineDrafts={hasTimelineDrafts}
            timelineEditing={{ onSaveSegment: handleSaveSegment, onUndo: handleUndo, onRedo: handleRedo, canUndo, canRedo,
              onDraftStateChange: setHasTimelineDrafts, loopEnabled,
              onPlayFrom: time => { handleTimelineTimeChange(time); void videoPlayer?.play().catch(() => setBurnError("לא ניתן להתחיל ניגון.")); },
              onLoopChange: enabled => {
                setLoopEnabled(enabled);
                const selected = editableSegments.find(s => s.id === selectedSegmentId);
                if (enabled && selected) { handleTimelineTimeChange(selected.start); void videoPlayer?.play().catch(() => setLoopEnabled(false)); }
              },
            }}
            editorSettings={<EditorSettings disabled={!isEditable || saveState === "saving" || hasTimelineDrafts} onApply={handleCharacterReflow} onUndo={handleUndoReflow} canUndo={canUndoReflow} exportFormat={exportFormat} onExportFormatChange={setExportFormat} />}
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
            onVideoTimeUpdate={time => {
              const selected = loopEnabled && editableSegments.find(s => s.id === selectedSegmentId);
              if (selected && videoPlayer && (time >= selected.end || time < selected.start)) {
                const wasEnded = videoPlayer.ended;
                handleTimelineTimeChange(selected.start);
                if (wasEnded) void videoPlayer.play().catch(() => setLoopEnabled(false));
              } else handleVideoTimeUpdate(time);
            }}
            onVideoLoadedMetadata={handleVideoLoadedMetadata}
            onVideoResize={handleVideoResize}
            onTimelineSegmentsChange={handleTimelineSegmentsChange}
            onTimelineTimeChange={handleTimelineTimeChange}
            onSegmentSelect={id => { setSelectedSegmentId(id); setLoopEnabled(false); }}
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
            onUndoSplit={handleUndoSplit}
            canUndoSplit={canUndoSplit}
            onToggleActiveWord={handleToggleActiveWord}
            onWordsChange={handleWordsChange}
            onResegment={handleResegment}
            onAIEdit={handleAIEdit}
            isPlaying={isPlaying}
            onPlayPause={handlePlayPause}
            onBack={handleLeaveEditor}
            onMyVideos={handleMyVideos}
            backDisabled={saveState === "saving" || isBurning || hasTimelineDrafts}
          />

        </Stack>
      </CardContent>
    </Card>
  );
}
