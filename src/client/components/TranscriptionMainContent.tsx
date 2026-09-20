import { useState, type ReactNode } from "react";
import { Box, Divider, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import type { Segment, Word } from "../types";
import { SubtitleTimeline, type SubtitleTimelineProps, type CaptionDraft } from "./SubtitleTimeline";
import { VideoPlayer } from "./VideoPlayer";
import { SubtitleEditor } from "./SubtitleEditor";
import { VideoToolbar } from "./VideoToolbar";

type SaveState = "idle" | "saving" | "success" | "error";

type BurnedVideo = {
  url: string;
  name: string;
};

type TranscriptionMainContentProps = {
  timelineEditing: Pick<SubtitleTimelineProps, "onSaveSegment" | "onUndo" | "onRedo" | "canUndo" | "canRedo" | "onPlayFrom" | "loopEnabled" | "onLoopChange" | "onDraftStateChange">;
  hasTimelineDrafts: boolean;
  editorSettings: ReactNode;
  mediaUrl: string | null;
  activeSegmentText: string | null;
  previewStyle: React.CSSProperties;
  editableSegments: Segment[];
  words?: Word[];
  isEditable: boolean;
  videoDuration: number | null;
  renderDimensions: { width: number; height: number } | null;
  currentTime: number;
  selectedSegmentId: Segment["id"] | null;
  activeSegmentId: Segment["id"] | null;
  fontSize: number;
  fontColor: string;
  outlineColor: string;
  offsetYPercent: number;
  marginPercent: number;
  isBurning: boolean;
  burnError: string | null;
  burnedVideo: BurnedVideo | null;
  videoDimensions: { width: number; height: number } | null;
  saveState: SaveState;
  saveError: string | null;
  downloadUrl: string | null;
  downloadName: string;
  activeWordEnabled: boolean;
  onVideoTimeUpdate: (nextTime: number) => void;
  onVideoLoadedMetadata: (dimensions: { width: number; height: number }, duration: number) => void;
  onVideoResize: (dimensions: { width: number; height: number }) => void;
  onTimelineSegmentsChange: (segments: Segment[]) => void;
  onTimelineTimeChange: (time: number) => void;
  onSegmentSelect: (segmentId: Segment["id"] | null) => void;
  onSegmentTextChangeAndSave: (segmentId: Segment["id"], value: string) => Promise<void>;
  onSegmentTextChange: (segmentId: Segment["id"], value: string) => void;
  onSegmentBlur: (segmentId: Segment["id"]) => Promise<void>;
  onFontSizeChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFontColorChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onOutlineColorChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onOffsetYChange: (event: Event, value: number | number[]) => void;
  onMarginChange: (event: Event, value: number | number[]) => void;
  onBurnVideo: () => void;
  onAddSubtitle: (text: string, startTime: number, endTime: number) => void;
  onDeleteSegment: (segmentId: Segment["id"]) => Promise<void>;
  onSplitSegment: (segmentId: Segment["id"], splitTime: number, draft?: CaptionDraft) => Promise<void>;
  onToggleActiveWord: () => void;
  onWordsChange?: (words: Word[], segmentId?: Segment["id"], text?: string) => void;
  onResegment?: (maxWords: number, customInstructions?: string) => Promise<void>;
  onAIEdit?: (instructions: string) => Promise<void>;
  // Video control props
  isPlaying?: boolean;
  onPlayPause?: () => void;
};

export function TranscriptionMainContent({
  timelineEditing,
  hasTimelineDrafts,
  editorSettings,
  mediaUrl,
  activeSegmentText,
  previewStyle,
  editableSegments,
  words,
  isEditable,
  videoDuration,
  currentTime,
  selectedSegmentId,
  activeSegmentId,
  fontSize,
  fontColor,
  outlineColor,
  offsetYPercent,
  marginPercent,
  isBurning,
  burnError,
  burnedVideo,
  saveState,
  saveError,
  downloadUrl,
  downloadName,
  activeWordEnabled,
  videoDimensions,
  // Video control props
  isPlaying,
  onPlayPause,
  onVideoTimeUpdate,
  onVideoLoadedMetadata,
  onVideoResize,
  onTimelineSegmentsChange,
  onTimelineTimeChange,
  onSegmentSelect,
  onSegmentTextChange,
  onSegmentBlur,
  onFontSizeChange,
  onFontColorChange,
  onOutlineColorChange,
  onOffsetYChange,
  onMarginChange,
  onBurnVideo,
  onAddSubtitle,
  onDeleteSegment,
  onSplitSegment,
  onToggleActiveWord,
  onResegment,
  onAIEdit,
}: TranscriptionMainContentProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(true);

  return (
    <>
      <Stack direction={{ xs: "column", lg: "row" }} spacing={2} alignItems="flex-start" sx={{ width: "100%", minWidth: 0 }}>
        <Stack className="preview-wrapper" spacing={2} sx={{ flex: 1, minWidth: 0, width: "100%" }}>
          <Stack direction="column" spacing={1.5} alignItems="center" justifyContent="center" sx={{ width: "100%", minWidth: 0 }}>
            <VideoToolbar
              pendingEdits={hasTimelineDrafts || saveState === "saving"}
              editorSettings={<>
                {editorSettings}
                <Box sx={{ p: 2 }}>
                  <FormControlLabel control={<Switch checked={showSubtitles} onChange={(_, checked) => setShowSubtitles(checked)} />} label="הצג כתוביות בתצוגה המקדימה" />
                  <Typography variant="caption" display="block" color="text.secondary">כתוביות שכבר צרובות בקובץ הן חלק מהתמונה ואינן ניתנות להסתרה כאן.</Typography>
                </Box>
              </>}
              fontSize={fontSize}
              fontColor={fontColor}
              outlineColor={outlineColor}
              offsetYPercent={offsetYPercent}
              marginPercent={marginPercent}
              isBurning={isBurning}
              burnError={burnError}
              burnedVideo={burnedVideo}
              mediaUrl={mediaUrl}
              canBurn={Boolean(videoDimensions?.width)}
              downloadUrl={downloadUrl}
              downloadName={downloadName}
              sidebarOpen={sidebarOpen}
              currentTime={currentTime}
              activeWordEnabled={activeWordEnabled}
              onFontSizeChange={onFontSizeChange}
              onFontColorChange={onFontColorChange}
              onOutlineColorChange={onOutlineColorChange}
              onOffsetYChange={onOffsetYChange}
              onMarginChange={onMarginChange}
              onBurnVideo={onBurnVideo}
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              onAddSubtitle={onAddSubtitle}
              onToggleActiveWord={onToggleActiveWord}
              onResegment={onResegment}
              onAIEdit={onAIEdit}
            />

          </Stack>
            <Box sx={{ minWidth: 0, width: "100%", position: { xs: selectedSegmentId !== null ? "sticky" : "static", sm: "static" }, top: 8, zIndex: 5, bgcolor: "background.paper", borderRadius: 2 }}>
              <VideoPlayer
                compact={selectedSegmentId !== null}
                mediaUrl={mediaUrl}
                activeSegmentText={showSubtitles ? activeSegmentText : null}
                activeSegmentId={activeSegmentId}
                previewStyle={previewStyle}
                words={words}
                currentTime={currentTime}
                activeWordEnabled={activeWordEnabled}
                onTimeUpdate={onVideoTimeUpdate}
                onLoadedMetadata={onVideoLoadedMetadata}
                onResize={onVideoResize}
              />
            </Box>

          {editableSegments.length > 0 && (
            <SubtitleTimeline
              activeWordEnabled={activeWordEnabled}
              {...timelineEditing}
              mediaUrl={mediaUrl}
              busy={saveState === "saving"}
              segments={editableSegments}
              disabled={!isEditable}
              duration={videoDuration}
              currentTime={currentTime}
              onRequestTimeChange={onTimelineTimeChange}
              onSegmentsChange={onTimelineSegmentsChange}
              selectedSegmentId={selectedSegmentId}
              onSegmentSelect={onSegmentSelect}
              onSplitSegment={onSplitSegment}
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              words={words}
            />
          )}
        </Stack>

        {sidebarOpen && (
          <>
            <Divider orientation="vertical" flexItem sx={{ display: { xs: "none", md: "block" } }} />

            <Stack spacing={2} sx={{ width: { xs: "100%", lg: 310 }, flexShrink: 0, minWidth: 0 }}>
              <SubtitleEditor
                segments={editableSegments}
                isEditable={isEditable && !hasTimelineDrafts && saveState !== "saving"}
                saveState={saveState}
                saveError={saveError}
                activeSegmentId={activeSegmentId}
                onSegmentTextChange={onSegmentTextChange}
                onSegmentBlur={onSegmentBlur}
                onDeleteSegment={onDeleteSegment}
              />
            </Stack>
          </>
        )}
      </Stack>
    </>
  );
}
