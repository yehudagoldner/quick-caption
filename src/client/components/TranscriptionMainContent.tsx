import { Box, Divider, Stack } from "@mui/material";
import type { Segment } from "../types";
import { SubtitleTimeline } from "./SubtitleTimeline";
import { VideoPlayer } from "./VideoPlayer";
import { SubtitleEditor } from "./SubtitleEditor";
import { VideoBurner, type BurnOptions } from "./VideoBurner";

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
}: TranscriptionMainContentProps) {
  return (
    <>
   

      <Stack direction={{ xs: "column", md: "row" }} spacing={3} alignItems="stretch">
        <Stack flex={{ xs: 1, md: 4 }}  className="preview-wrapper" spacing={2}>
         <Box sx={{ maxWidth: "70%" }}>
            <VideoPlayer
              mediaUrl={mediaUrl}
              activeSegmentText={activeSegmentText}
              previewStyle={previewStyle}
              onTimeUpdate={onVideoTimeUpdate}
              onLoadedMetadata={onVideoLoadedMetadata}
              onResize={onVideoResize}
            />
          </Box>
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
          <VideoBurner
            fontSize={fontSize}
            fontColor={fontColor}
            outlineColor={outlineColor}
            offsetYPercent={offsetYPercent}
            marginPercent={marginPercent}
            isBurning={isBurning}
            burnError={burnError}
            burnedVideo={burnedVideo}
            mediaUrl={mediaUrl}
            videoDimensions={videoDimensions}
            onFontSizeChange={onFontSizeChange}
            onFontColorChange={onFontColorChange}
            onOutlineColorChange={onOutlineColorChange}
            onOffsetYChange={onOffsetYChange}
            onMarginChange={onMarginChange}
            onBurnVideo={onBurnVideo}
          />
        </Stack>

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
      </Stack>
    </>
  );
}