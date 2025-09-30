import { useState } from "react";
import { Box, Divider, Stack } from "@mui/material";
import type { Segment } from "../types";
import { SubtitleTimeline } from "./SubtitleTimeline";
import { VideoPlayer } from "./VideoPlayer";
import { SubtitleEditor } from "./SubtitleEditor";
import { VideoToolbar, type BurnOptions } from "./VideoToolbar";

type SaveState = "idle" | "saving" | "success" | "error";

type BurnedVideo = {
  url: string;
  name: string;
};

type TranscriptionMainContentProps = {
  mediaUrl: string | null;
  activeSegmentText: string | null;
  previewStyle: React.CSSProperties;
  editableSegments: Segment[];
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
  // Video control props
  isPlaying?: boolean;
  onPlayPause?: () => void;
};

export function TranscriptionMainContent({
  mediaUrl,
  activeSegmentText,
  previewStyle,
  editableSegments,
  isEditable,
  videoDuration,
  renderDimensions,
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
  videoDimensions,
  saveState,
  saveError,
  downloadUrl,
  downloadName,
  // Video control props
  isPlaying,
  onPlayPause,
  onVideoTimeUpdate,
  onVideoLoadedMetadata,
  onVideoResize,
  onTimelineSegmentsChange,
  onTimelineTimeChange,
  onSegmentSelect,
  onSegmentTextChangeAndSave,
  onSegmentTextChange,
  onSegmentBlur,
  onFontSizeChange,
  onFontColorChange,
  onOutlineColorChange,
  onOffsetYChange,
  onMarginChange,
  onBurnVideo,
  onAddSubtitle,
}: TranscriptionMainContentProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      <Stack direction={{ xs: "column", md: "row" }} spacing={3} alignItems="flex-start">
        <Stack flex={{ xs: 1, md: sidebarOpen ? 4 : 1 }} className="preview-wrapper" spacing={2} sx={{ maxWidth: sidebarOpen ? "calc(100% - 350px)" : "100%" }}>
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <VideoToolbar
              fontSize={fontSize}
              fontColor={fontColor}
              outlineColor={outlineColor}
              offsetYPercent={offsetYPercent}
              marginPercent={marginPercent}
              isBurning={isBurning}
              burnError={burnError}
              burnedVideo={burnedVideo}
              mediaUrl={mediaUrl}
              downloadUrl={downloadUrl}
              downloadName={downloadName}
              sidebarOpen={sidebarOpen}
              currentTime={currentTime}
              onFontSizeChange={onFontSizeChange}
              onFontColorChange={onFontColorChange}
              onOutlineColorChange={onOutlineColorChange}
              onOffsetYChange={onOffsetYChange}
              onMarginChange={onMarginChange}
              onBurnVideo={onBurnVideo}
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              onAddSubtitle={onAddSubtitle}
            />

            <Box sx={{ maxWidth: 800, flex: 1 }}>
              <VideoPlayer
                mediaUrl={mediaUrl}
                activeSegmentText={activeSegmentText}
                previewStyle={previewStyle}
                onTimeUpdate={onVideoTimeUpdate}
                onLoadedMetadata={onVideoLoadedMetadata}
                onResize={onVideoResize}
              />
            </Box>
          </Stack>

          {editableSegments.length > 0 && (
            <SubtitleTimeline
              segments={editableSegments}
              disabled={!isEditable}
              duration={videoDuration}
              viewportWidth={null}
              currentTime={currentTime}
              onRequestTimeChange={onTimelineTimeChange}
              onSegmentsChange={onTimelineSegmentsChange}
              selectedSegmentId={selectedSegmentId}
              onSegmentSelect={onSegmentSelect}
              onSegmentTextChange={onSegmentTextChangeAndSave}
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
            />
          )}
        </Stack>

        {sidebarOpen && (
          <>
            <Divider orientation="vertical" flexItem sx={{ display: { xs: "none", md: "block" } }} />

            <Stack flex={{ xs: 1, md: 1 }} spacing={2}>
              <SubtitleEditor
                segments={editableSegments}
                isEditable={isEditable}
                saveState={saveState}
                saveError={saveError}
                activeSegmentId={activeSegmentId}
                onSegmentTextChange={onSegmentTextChange}
                onSegmentBlur={onSegmentBlur}
              />
            </Stack>
          </>
        )}
      </Stack>
    </>
  );
}