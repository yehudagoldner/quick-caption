import "react-virtualized/styles.css";
import { Box, Button, Card, IconButton, Slider, Stack, TextField, Tooltip, Typography, ThemeProvider, createTheme, useTheme } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import SubtitlesRoundedIcon from "@mui/icons-material/SubtitlesRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import ZoomInRoundedIcon from "@mui/icons-material/ZoomInRounded";
import ZoomOutRoundedIcon from "@mui/icons-material/ZoomOutRounded";
import ContentCutRoundedIcon from "@mui/icons-material/ContentCutRounded";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Timeline,
  type TimelineAction,
  type TimelineEffect,
  type TimelineRow,
  type TimelineState,
} from "@xzdarcy/react-timeline-editor";
import type { Segment, Word } from "../types";
import { WordTimeline } from "./WordTimeline";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { formatTimecode, snapToFrame } from "../utils/timecode";

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
  onSplitSegment?: (segmentId: Segment["id"], splitTime: number) => Promise<void>;
  // Video control props
  isPlaying?: boolean;
  onPlayPause?: () => void;
  // Word editing props
  words?: Word[];
  activeWordEnabled?: boolean;
  onWordsChange?: (words: Word[], segmentId?: Segment["id"], text?: string) => void;
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
  onSplitSegment,
  isPlaying = false,
  onPlayPause,
  words,
  activeWordEnabled = false,
  onWordsChange,
}: SubtitleTimelineProps) {
  const { preferences } = useEditorPreferences();
  const fps = preferences.fps;
  const parentTheme = useTheme();
  const timelineTheme = useMemo(() => createTheme(parentTheme, { direction: "ltr" }), [parentTheme]);
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
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const [autoViewportWidth, setAutoViewportWidth] = useState<number | null>(null);

  useEffect(() => {
    if (typeof viewportWidth === "number") {
      setAutoViewportWidth(null);
      return;
    }

    const element = timelineContainerRef.current;
    if (!element) {
      setAutoViewportWidth(null);
      return;
    }

    const updateWidth = () => {
      const width = element.getBoundingClientRect().width;
      if (!Number.isFinite(width) || width <= 0) {
        return;
      }
      const rounded = Math.round(width);
      setAutoViewportWidth((prev) => (prev === rounded ? prev : rounded));
    };

    updateWidth();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(element);
      return () => observer.disconnect();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    return undefined;
  }, [viewportWidth]);

  const baseScaleCount = useMemo(() => Math.max(2, Math.ceil(totalDuration) + 1), [totalDuration]);
  const baseScale = 1;

  const effectiveViewportWidth = viewportWidth ?? autoViewportWidth ?? null;

  const baseScaleWidth = useMemo(() => {
    if (!effectiveViewportWidth) {
      // Use a default that works well for most screen sizes
      return 120;
    }
    const usableWidth = effectiveViewportWidth;
    // Calculate minimum width to show entire timeline
    const minWidthForFullView = Math.max(40, usableWidth / baseScaleCount);
    return minWidthForFullView;
  }, [effectiveViewportWidth, baseScaleCount]);

  // Calculate minimum zoom level to show entire timeline
  const minZoom = useMemo(() => {
    if (!effectiveViewportWidth) return -50;
    const containerWidth = effectiveViewportWidth * 0.9; // Account for 90% width
    const requiredWidth = totalDuration * (baseScaleWidth ?? 120);
    if (requiredWidth <= containerWidth) return -50;

    const zoomFactor = containerWidth / requiredWidth;
    return Math.max(-50, Math.log2(zoomFactor) * 50);
  }, [effectiveViewportWidth, totalDuration, baseScaleWidth]);

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
      if (!timelineRef.current || !effectiveViewportWidth) {
        return;
      }

      const startLeft = 20;
      const viewWidth = effectiveViewportWidth;
      const pixelsPerUnit = scaleWidth / baseScale;
      const positionPx = startLeft + time * pixelsPerUnit;

      // Get actual current scroll position from timeline, fallback to tracked position
      const actualScroll = scrollLeftRef.current;

      // Always center the current time when it changes during video playback
      let targetScroll = actualScroll;

      // More aggressive scrolling: always center if not in the center 25% of viewport
      const centerStart = actualScroll + 20;
      const centerEnd = actualScroll + viewWidth - 40;

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
    [baseScale, scaleWidth, effectiveViewportWidth],
  );

  const emitTimeChange = useCallback(
    (time: number) => {
      console.debug('⏰ Timeline emitTimeChange called:', { time, hasHandler: !!onRequestTimeChange });
      if (onRequestTimeChange) {
        const clampedTime = Math.min(totalDuration, Math.max(0, snapToFrame(time, fps)));
        console.debug('⏰ Calling onRequestTimeChange with:', clampedTime);
        onRequestTimeChange(clampedTime);
      }
    },
    [onRequestTimeChange, fps, totalDuration],
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

          const length = Math.min(totalDuration, Math.max(1 / fps, snapToFrame(action.end - action.start, fps)));
          const start = Math.min(Math.max(0, totalDuration - length), Math.max(0, snapToFrame(action.start, fps)));
          return { ...original, start, end: Math.min(totalDuration, start + length) };
        })
        .filter((segment): segment is Segment => segment !== null && segment.end > segment.start)
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
    [segmentLookup, segments, onSegmentsChange, fps, totalDuration],
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

  const handleWordTimelineSave = useCallback(() => {
    onSegmentSelect?.(null);
  }, [onSegmentSelect]);

  const handleWordTimelineClose = useCallback(() => {
    onSegmentSelect?.(null);
  }, [onSegmentSelect]);

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
          title="גררו את גוף המקטע להזזה, את הקצוות לקיצור או הארכה, ולחצו לעריכת הטקסט"
          data-testid="subtitle-clip"
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
            cursor: disabled ? "default" : "grab",
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
          <Typography variant="caption" noWrap sx={{ position: "relative", zIndex: 1, fontWeight: 600, direction: `${preferences.direction} !important`, unicodeBidi: "plaintext" }}>
            {displayText}
          </Typography>
        </Stack>
      );
    },
    [effects, segmentLookup, selectedSegmentId, disabled, handleActionClick, preferences.direction],
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

  const handleSplitAtCursor = useCallback(async () => {
    if (!selectedSegment || !onSplitSegment || typeof currentTime !== "number") return;

    // Check if cursor is within the selected segment
    if (currentTime <= selectedSegment.start || currentTime >= selectedSegment.end) {
      console.warn("Cursor must be within the segment to split");
      return;
    }

    await onSplitSegment(selectedSegment.id, currentTime);
    onSegmentSelect?.(null);
  }, [selectedSegment, onSplitSegment, currentTime, onSegmentSelect]);

  // Check if split is possible (cursor is within segment bounds)
  const canSplit = useMemo(() => {
    if (!selectedSegment || typeof currentTime !== "number") return false;
    if (selectedSegment.text.trim().split(/\s+/).length < 2) return false;
    return currentTime > selectedSegment.start && currentTime < selectedSegment.end;
  }, [selectedSegment, currentTime]);

  const formatTimeDisplay = (time: number) => formatTimecode(time, fps);

  return (
    <Stack spacing={1.5} sx={{ mt: 2, flex: 1, width: "100%", minWidth: 0 }} className="subtitle-timeline">
      <Typography variant="subtitle1" fontWeight={700}>ציר הזמן הראשי — כל ההקלטה</Typography>
      <Typography variant="caption" color="text.secondary">גרירת גוף המקטע מזיזה אותו; גרירת הקצוות משנה את משכו. לחיצה פותחת עריכה של המקטע הנבחר.</Typography>
      {/* Video Controls Row */}
      <Stack direction="row" spacing={2} alignItems="center">
        {/* Play/Pause Button */}
        <IconButton
          aria-label={isPlaying ? "השהה" : "נגן"}
          onClick={onPlayPause}
          disabled={!onPlayPause}
          sx={{ bgcolor: "primary.main", color: "white", "&:hover": { bgcolor: "primary.dark" } }}
        >
          {isPlaying ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
        </IconButton>

        {/* Current Time */}
        <Typography data-testid="playhead-timecode" dir="ltr" variant="body2" color="text.secondary" sx={{ minWidth: 100, fontVariantNumeric: "tabular-nums" }}>
          {formatTimeDisplay(currentTime || 0)}
        </Typography>

        {/* Time Scrubber */}
        <Box sx={{ flexGrow: 1 }} dir="ltr">
          <ThemeProvider theme={timelineTheme}>
          <Slider
            min={0}
            max={totalDuration}
            aria-label="מיקום בהקלטה"
            step={1 / fps}
            value={currentTime || 0}
            onChange={(_event, value) => {
              emitTimeChange(Array.isArray(value) ? value[0] : value);
            }}
            size="small"
            sx={{
              "& .MuiSlider-thumb": {
                bgcolor: "primary.main"
              },
              "& .MuiSlider-track": {
                bgcolor: "primary.main"
              }
            }}
          />
          </ThemeProvider>
        </Box>

        {/* Total Duration */}
        <Typography dir="ltr" variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" }, minWidth: 100 }}>
          {formatTimeDisplay(totalDuration)}
        </Typography>
      </Stack>

      {/* Timeline with Vertical Zoom Control */}
      <Stack direction="row" spacing={1} sx={{ position: "relative" }}>
        {/* Main Timeline */}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            direction: "ltr",
            "& *": {
              direction: "ltr !important"
            },
            "& .timeline-editor": {
              direction: "ltr !important"
            },
            "& .timeline-editor-time-area": {
              direction: "ltr !important"
            }
          }}
          ref={timelineContainerRef}
        >
          <Timeline
            ref={timelineRef}
            editorData={editorData}
            effects={effects}
            gridSnap={false}
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
        <>
          {activeWordEnabled && words && words.length > 0 && onWordsChange ? (
            // Word-level editing mode
            <WordTimeline
              segment={selectedSegment}
              words={words}
              currentTime={currentTime ?? null}
              onWordsChange={onWordsChange}
              onSegmentTextChange={onSegmentTextChange}
              onClose={handleWordTimelineClose}
              onSave={handleWordTimelineSave}
            />
          ) : (
            // Text editing mode
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
                    עריכת המקטע הנבחר
                  </Typography>
                  <IconButton size="small" onClick={handleCancelEdit} sx={{ color: "inherit" }}>
                    <CloseRoundedIcon />
                  </IconButton>
                </Stack>
                <TextField
                  label="טקסט המקטע"
                  inputProps={{ dir: preferences.direction }}
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
                  <Tooltip title={canSplit ? "פצל כתובית במיקום הנוכחי" : "הזז את הסמן לתוך הכתובית כדי לפצל"}>
                    <span>
                      <Button
                        variant="outlined"
                        startIcon={<ContentCutRoundedIcon />}
                        onClick={handleSplitAtCursor}
                        disabled={!canSplit}
                        sx={{
                          color: "inherit",
                          borderColor: "inherit",
                          "&:hover": {
                            borderColor: "inherit",
                            bgcolor: "rgba(255, 255, 255, 0.1)",
                          },
                          "&.Mui-disabled": {
                            color: "rgba(255, 255, 255, 0.4)",
                            borderColor: "rgba(255, 255, 255, 0.3)",
                          },
                        }}
                      >
                        פצל
                      </Button>
                    </span>
                  </Tooltip>
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
        </>
      )}
    </Stack>
  );
}





