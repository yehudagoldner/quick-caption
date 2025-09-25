import "react-virtualized/styles.css";
import { Box, Button, Card, IconButton, Slider, Stack, TextField, Typography } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import SubtitlesRoundedIcon from "@mui/icons-material/SubtitlesRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import ZoomInRoundedIcon from "@mui/icons-material/ZoomInRounded";
import ZoomOutRoundedIcon from "@mui/icons-material/ZoomOutRounded";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Timeline,
  type TimelineAction,
  type TimelineEffect,
  type TimelineRow,
  type TimelineState,
} from "@xzdarcy/react-timeline-editor";
import type { Segment } from "../types";

const ROW_ID = "subtitle-row";

function segmentKey(segment: Segment): string {
  return String(segment.id ?? `${segment.start}-${segment.end}-${segment.text}`);
}

export type SubtitleTimelineProps = {
  segments: Segment[];
  disabled?: boolean;
  duration?: number | null;
  viewportWidth?: number | null;
  currentTime?: number | null;
  onRequestTimeChange?: (time: number) => void;
  onSegmentsChange: (segments: Segment[]) => void;
  selectedSegmentId?: Segment["id"] | null;
  onSegmentSelect?: (segmentId: Segment["id"] | null) => void;
  onSegmentTextChange?: (segmentId: Segment["id"], text: string) => void;
  // Video control props
  isPlaying?: boolean;
  onPlayPause?: () => void;
};

export function SubtitleTimeline({
  segments,
  disabled,
  duration,
  viewportWidth,
  currentTime,
  onRequestTimeChange,
  onSegmentsChange,
  selectedSegmentId,
  onSegmentSelect,
  onSegmentTextChange,
  isPlaying = false,
  onPlayPause,
}: SubtitleTimelineProps) {
  const editorData = useMemo<TimelineRow[]>(() => {
    const actions: TimelineAction[] = segments.map((segment) => ({
      id: segmentKey(segment),
      start: segment.start,
      end: segment.end,
      effectId: segmentKey(segment),
      flexible: !disabled,
      movable: !disabled,
    }));

    return [
      {
        id: ROW_ID,
        actions,
      },
    ];
  }, [segments, disabled]);

  const effects = useMemo<Record<string, TimelineEffect>>(() => {
    return segments.reduce<Record<string, TimelineEffect>>((acc, segment) => {
      const id = segmentKey(segment);
      acc[id] = {
        id,
        name: segment.text,
      };
      return acc;
    }, {});
  }, [segments]);

  const segmentLookup = useMemo(() => {
    const map = new Map<string, Segment>();
    segments.forEach((segment) => {
      map.set(segmentKey(segment), segment);
    });
    return map;
  }, [segments]);

  const totalDuration = useMemo(() => {
    const maxSegmentEnd = segments.reduce((max, segment) => Math.max(max, segment.end ?? 0), 0);
    const candidate = duration ?? 0;
    return Math.max(candidate, maxSegmentEnd, 1);
  }, [segments, duration]);

  const [zoom, setZoom] = useState(0);

  const timelineRef = useRef<TimelineState | null>(null);
  const isCursorDraggingRef = useRef(false);
  const lastAppliedTimeRef = useRef<number | null>(null);
  const scrollLeftRef = useRef(0);

  const baseScaleCount = useMemo(() => Math.max(20, Math.ceil(totalDuration) + 2), [totalDuration]);
  const baseScale = 1;

  const baseScaleWidth = useMemo(() => {
    if (!viewportWidth) {
      // Use a default that works well for most screen sizes
      return 120;
    }
    const usableWidth = viewportWidth;
    // Calculate minimum width to show entire timeline
    const minWidthForFullView = Math.max(40, usableWidth / baseScaleCount);
    return minWidthForFullView;
  }, [viewportWidth, baseScaleCount]);

  // Calculate minimum zoom level to show entire timeline
  const minZoom = useMemo(() => {
    if (!viewportWidth) return -50;
    const containerWidth = viewportWidth * 0.9; // Account for 90% width
    const requiredWidth = totalDuration * (baseScaleWidth ?? 120);
    if (requiredWidth <= containerWidth) return -50;

    const zoomFactor = containerWidth / requiredWidth;
    return Math.max(-50, Math.log2(zoomFactor) * 50);
  }, [viewportWidth, totalDuration, baseScaleWidth]);

  // Update zoom to minimum when minZoom changes to ensure full view
  useEffect(() => {
    if (zoom < minZoom) {
      setZoom(minZoom);
    }
  }, [minZoom, zoom]);

  const zoomFactor = useMemo(() => Math.pow(2, zoom / 50), [zoom]);
  const scaleWidth = (baseScaleWidth ?? 120) * zoomFactor;
  const scaleSplitCount = 4;

  const ensureCursorVisible = useCallback(
    (time: number) => {
      if (!timelineRef.current || !viewportWidth) {
        return;
      }

      const startLeft = 20;
      const viewWidth = viewportWidth * 0.9; // Account for 90% timeline width
      const pixelsPerUnit = scaleWidth / baseScale;
      const positionPx = startLeft + time * pixelsPerUnit;

      // Get actual current scroll position from timeline, fallback to tracked position
      let actualScroll = scrollLeftRef.current;
      if (timelineRef.current.getScrollLeft && typeof timelineRef.current.getScrollLeft === 'function') {
        try {
          actualScroll = timelineRef.current.getScrollLeft();
        } catch (error) {
          // Fallback to tracked scroll position if getScrollLeft fails
        }
      }

      // Always center the current time when it changes during video playback
      // Use a smaller margin to be more aggressive about scrolling
      const margin = Math.min(50, viewWidth / 8);
      let targetScroll = actualScroll;

      // More aggressive scrolling: always center if not in the center 25% of viewport
      const centerStart = actualScroll + (viewWidth * 0.375); // 37.5% from left
      const centerEnd = actualScroll + (viewWidth * 0.625);   // 62.5% from left

      if (positionPx < centerStart || positionPx > centerEnd) {
        // Center the current time in the viewport
        targetScroll = Math.max(positionPx - viewWidth / 2, 0);

        console.debug('🔄 Timeline auto-scroll:', {
          time,
          positionPx,
          actualScroll,
          targetScroll,
          viewWidth,
          centerStart,
          centerEnd,
          willScroll: Math.abs(targetScroll - actualScroll) > 5
        });

        scrollLeftRef.current = targetScroll;

        // Try to set scroll position
        if (timelineRef.current.setScrollLeft && typeof timelineRef.current.setScrollLeft === 'function') {
          try {
            timelineRef.current.setScrollLeft(targetScroll);
            console.debug('✅ Timeline scroll applied successfully');
          } catch (error) {
            console.warn('❌ Failed to set timeline scroll position:', error);
          }
        } else {
          console.warn('❌ Timeline setScrollLeft method not available');
        }
      } else {
        console.debug('⏸️ Timeline scroll not needed - cursor in center area');
      }
    },
    [baseScale, scaleWidth, viewportWidth],
  );

  const emitTimeChange = useCallback(
    (time: number) => {
      console.debug('⏰ Timeline emitTimeChange called:', { time, hasHandler: !!onRequestTimeChange });
      if (onRequestTimeChange) {
        const clampedTime = Math.max(0, time);
        console.debug('⏰ Calling onRequestTimeChange with:', clampedTime);
        onRequestTimeChange(clampedTime);
      }
    },
    [onRequestTimeChange],
  );


  const handleRowsChange = useCallback(
    (rows: TimelineRow[]) => {
      const row = rows.find((item) => item.id === ROW_ID);
      if (!row) {
        return;
      }

      const updatedSegments = row.actions
        .map((action) => {
          const original = segmentLookup.get(action.id);
          if (!original) {
            return null;
          }

          return {
            ...original,
            start: action.start,
            end: action.end,
          };
        })
        .filter((segment): segment is Segment => segment !== null)
        .sort((a, b) => a.start - b.start);

      if (updatedSegments.length !== segments.length) {
        onSegmentsChange(updatedSegments);
        return;
      }

      const changed = updatedSegments.some((segment, index) => {
        const original = segments[index];
        return original.start !== segment.start || original.end !== segment.end;
      });

      if (changed) {
        onSegmentsChange(updatedSegments);
      }
    },
    [segmentLookup, segments, onSegmentsChange],
  );

  useEffect(() => {
    if (!timelineRef.current) {
      return;
    }
    if (typeof currentTime !== "number") {
      return;
    }
    if (isCursorDraggingRef.current) {
      return;
    }
    if (lastAppliedTimeRef.current !== null && Math.abs(lastAppliedTimeRef.current - currentTime) < 0.1) {
      return;
    }
    lastAppliedTimeRef.current = currentTime;
    timelineRef.current.setTime(currentTime);
    // Always scroll to show current time when video time changes
    ensureCursorVisible(currentTime);
  }, [currentTime, ensureCursorVisible]);

  const handleCursorDragStart = useCallback(
    (time: number) => {
      isCursorDraggingRef.current = true;
      emitTimeChange(time);
    },
    [emitTimeChange],
  );

  const handleCursorDrag = useCallback(
    (time: number) => {
      emitTimeChange(time);
      ensureCursorVisible(time);
    },
    [emitTimeChange, ensureCursorVisible],
  );

  const handleCursorDragEnd = useCallback(
    (time: number) => {
      emitTimeChange(time);
      ensureCursorVisible(time);
      isCursorDraggingRef.current = false;
      lastAppliedTimeRef.current = time;
    },
    [emitTimeChange, ensureCursorVisible],
  );

  const handleTimeAreaClick = useCallback(
    (time: number) => {
      emitTimeChange(time);
      ensureCursorVisible(time);
      return true;
    },
    [emitTimeChange, ensureCursorVisible],
  );

  const handleTimedScroll = useCallback((params: { scrollLeft?: number }) => {
    if (typeof params?.scrollLeft === "number") {
      scrollLeftRef.current = params.scrollLeft;
    }
  }, []);

  const handleActionClick = useCallback(
    (action: TimelineAction) => {
      if (disabled || !onSegmentSelect) {
        return;
      }
      const segment = segmentLookup.get(action.id);
      if (segment) {
        onSegmentSelect(segment.id);
      }
    },
    [disabled, onSegmentSelect, segmentLookup],
  );

  const renderAction = useCallback(
    (action: TimelineAction) => {
      const segment = segmentLookup.get(action.id);
      const rawText = segment?.text ?? effects[action.effectId]?.name ?? "כתובית";
      const text = (rawText || "").trim() || "כתובית";
      const displayText = text.length > 40 ? `${text.slice(0, 37)}…` : text;
      const isSelected = segment && selectedSegmentId === segment.id;

      console.debug('🎬 Rendering timeline segment:', {
        actionId: action.id,
        segmentId: segment?.id,
        text: displayText,
        isSelected,
        selectedSegmentId,
        start: action.start,
        end: action.end
      });

      return (
        <Stack
          className="subtitle-timeline-action"
          direction="row"
          spacing={0.75}
          alignItems="center"
          onClick={() => handleActionClick(action)}
          sx={{
            position: "relative",
            width: "100%",
            height: "100%",
            pointerEvents: disabled ? "none" : "auto",
            color: "#fff",
            cursor: disabled ? "default" : "pointer",
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              borderRadius: 1.5,
              background: isSelected
                ? "linear-gradient(90deg, rgba(33, 150, 243, 0.95), rgba(21, 101, 192, 0.95))"
                : disabled
                  ? "linear-gradient(90deg, rgba(255, 213, 79, 0.7), rgba(255, 152, 0, 0.7))"
                  : "linear-gradient(90deg, rgba(255, 213, 79, 0.95), rgba(255, 152, 0, 0.95))",
              boxShadow: isSelected ? "0 2px 8px rgba(33, 150, 243, 0.5)" : "0 2px 6px rgba(0, 0, 0, 0.4)",
              transition: "all 0.2s ease-in-out",
            }}
          />
          <SubtitlesRoundedIcon fontSize="small" sx={{ position: "relative", zIndex: 1 }} />
          <Typography variant="caption" noWrap sx={{ position: "relative", zIndex: 1, fontWeight: 600 }}>
            {displayText}
          </Typography>
        </Stack>
      );
    },
    [effects, segmentLookup, selectedSegmentId, disabled, handleActionClick],
  );

  const formatScaleLabel = useCallback((value: number) => {
    if (!Number.isFinite(value)) {
      return "";
    }
    const seconds = Math.max(0, value * baseScale);
    const totalMillis = Math.round(seconds * 1000);
    const minutes = Math.floor(totalMillis / 60000);
    const wholeSeconds = Math.floor((totalMillis % 60000) / 1000);
    const millis = totalMillis % 1000;
    const secondsPart = minutes > 0 ? String(wholeSeconds).padStart(2, "0") : String(wholeSeconds);
    const decimalPart = millis ? `.${Math.round(millis / 100)}` : "";
    return minutes > 0 ? `${minutes}:${secondsPart}${decimalPart}` : `${secondsPart}${decimalPart}`;
  }, [baseScale]);

  const selectedSegment = useMemo(
    () => segments.find((seg) => seg.id === selectedSegmentId) ?? null,
    [segments, selectedSegmentId],
  );

  const [editText, setEditText] = useState("");

  useEffect(() => {
    if (selectedSegment) {
      setEditText(selectedSegment.text);
    }
  }, [selectedSegment]);

  const handleSaveEdit = useCallback(() => {
    if (selectedSegment && onSegmentTextChange && editText !== selectedSegment.text) {
      onSegmentTextChange(selectedSegment.id, editText);
    }
    onSegmentSelect?.(null);
  }, [selectedSegment, onSegmentTextChange, editText, onSegmentSelect]);

  const handleCancelEdit = useCallback(() => {
    onSegmentSelect?.(null);
  }, [onSegmentSelect]);

  const formatTimeDisplay = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <Stack spacing={1.5} sx={{ mt: 2, flex: 1, width: "90%" }} className="subtitle-timeline">
      {/* Video Controls Row */}
      <Stack direction="row" spacing={2} alignItems="center">
        {/* Play/Pause Button */}
        <IconButton
          onClick={onPlayPause}
          disabled={!onPlayPause}
          sx={{ bgcolor: "primary.main", color: "white", "&:hover": { bgcolor: "primary.dark" } }}
        >
          {isPlaying ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
        </IconButton>

        {/* Current Time */}
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 50 }}>
          {formatTimeDisplay(currentTime || 0)}
        </Typography>

        {/* Time Scrubber */}
        <Box sx={{ flexGrow: 1 }}>
          <Slider
            min={0}
            max={totalDuration}
            step={0.1}
            value={currentTime || 0}
            onChange={(_event, value) => {
              const time = Array.isArray(value) ? value[0] : value;
              console.debug('🎚️ Scrubber onChange:', { time, hasHandler: !!onRequestTimeChange });
              onRequestTimeChange?.(time);
            }}
            size="small"
            sx={{
              "& .MuiSlider-thumb": {
                bgcolor: "primary.main",
              },
              "& .MuiSlider-track": {
                bgcolor: "primary.main",
              },
            }}
          />
        </Box>

        {/* Total Duration */}
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 50 }}>
          {formatTimeDisplay(totalDuration)}
        </Typography>
      </Stack>

      {/* Timeline with Vertical Zoom Control */}
      <Stack direction="row" spacing={1} sx={{ position: "relative" }}>
        {/* Main Timeline */}
        <Box sx={{ flex: 1 }}>
          <Timeline
            ref={timelineRef}
            editorData={editorData}
            effects={effects}
            gridSnap
            dragLine
            disableDrag={disabled}
            scale={baseScale}
            minScaleCount={baseScaleCount}
            scaleWidth={scaleWidth}
            scaleSplitCount={scaleSplitCount}
            getScaleRender={(value) => <span>{formatScaleLabel(value)}</span>}
            onChange={handleRowsChange}
            onCursorDragStart={handleCursorDragStart}
            onCursorDrag={handleCursorDrag}
            onCursorDragEnd={handleCursorDragEnd}
            onClickTimeArea={handleTimeAreaClick}
            getActionRender={(action) => renderAction(action)}
            onScroll={handleTimedScroll}
            style={{ height: 150, width: "100%" }}
          />
        </Box>

        {/* Vertical Zoom Control */}
        <Stack
          spacing={1}
          alignItems="center"
          sx={{
            width: 40,
            height: 150,
            bgcolor: "background.paper",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            py: 1,
          }}
        >
          <IconButton size="small" onClick={() => setZoom(Math.min(100, zoom + 10))}>
            <ZoomInRoundedIcon fontSize="small" />
          </IconButton>

          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Slider
              orientation="vertical"
              min={minZoom}
              max={100}
              step={1}
              value={Math.max(minZoom, zoom)}
              onChange={(_event, value) => setZoom(Math.max(minZoom, Array.isArray(value) ? value[0] : value))}
              size="small"
              sx={{ height: 60 }}
            />
          </Box>

          <IconButton size="small" onClick={() => setZoom(Math.max(minZoom, zoom - 10))}>
            <ZoomOutRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>

      {selectedSegment && !disabled && (
        <Card
          elevation={3}
          sx={{
            p: 2,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            borderRadius: 2,
          }}
        >
          <Stack spacing={2}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle1" fontWeight={600}>
                עריכת כתובית
              </Typography>
              <IconButton size="small" onClick={handleCancelEdit} sx={{ color: "inherit" }}>
                <CloseRoundedIcon />
              </IconButton>
            </Stack>
            <TextField
              multiline
              minRows={3}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              fullWidth
              sx={{
                bgcolor: "background.paper",
                borderRadius: 1,
                "& .MuiInputBase-root": {
                  color: "text.primary",
                },
              }}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button
                variant="outlined"
                onClick={handleCancelEdit}
                sx={{
                  color: "inherit",
                  borderColor: "inherit",
                  "&:hover": {
                    borderColor: "inherit",
                    bgcolor: "rgba(255, 255, 255, 0.1)",
                  },
                }}
              >
                ביטול
              </Button>
              <Button
                variant="contained"
                startIcon={<CheckRoundedIcon />}
                onClick={handleSaveEdit}
                sx={{
                  bgcolor: "background.paper",
                  color: "primary.main",
                  "&:hover": {
                    bgcolor: "rgba(255, 255, 255, 0.9)",
                  },
                }}
              >
                שמור שינויים
              </Button>
            </Stack>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}





