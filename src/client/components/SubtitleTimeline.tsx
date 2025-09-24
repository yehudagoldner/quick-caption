import "react-virtualized/styles.css";
import { Box, Slider, Stack, Typography } from "@mui/material";
import SubtitlesRoundedIcon from "@mui/icons-material/SubtitlesRounded";
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
};

export function SubtitleTimeline({
  segments,
  disabled,
  duration,
  viewportWidth,
  currentTime,
  onRequestTimeChange,
  onSegmentsChange,
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
      return null;
    }
    const usableWidth = Math.max(viewportWidth - 40, viewportWidth * 0.8);
    return Math.max(40, usableWidth / baseScaleCount);
  }, [viewportWidth, baseScaleCount]);

  const zoomFactor = useMemo(() => Math.pow(2, zoom / 50), [zoom]);
  const scaleWidth = (baseScaleWidth ?? 160) * zoomFactor;
  const scaleSplitCount = 4;

  const ensureCursorVisible = useCallback(
    (time: number) => {
      if (!timelineRef.current || !viewportWidth) {
        return;
      }

      const startLeft = 20;
      const viewWidth = viewportWidth;
      const pixelsPerUnit = scaleWidth / baseScale;
      const positionPx = startLeft + time * pixelsPerUnit;
      const currentScroll = scrollLeftRef.current;
      const margin = Math.min(120, viewWidth / 5);
      let targetScroll = currentScroll;

      if (positionPx < currentScroll + margin) {
        targetScroll = Math.max(positionPx - margin, 0);
      } else if (positionPx > currentScroll + viewWidth - margin) {
        targetScroll = Math.max(positionPx - viewWidth + margin, 0);
      }

      if (Math.abs(targetScroll - currentScroll) > 1) {
        scrollLeftRef.current = targetScroll;
        timelineRef.current.setScrollLeft(targetScroll);
      }
    },
    [baseScale, scaleWidth, viewportWidth],
  );

  const emitTimeChange = useCallback(
    (time: number) => {
      if (onRequestTimeChange) {
        onRequestTimeChange(Math.max(0, time));
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
    if (lastAppliedTimeRef.current !== null && Math.abs(lastAppliedTimeRef.current - currentTime) < 0.02) {
      return;
    }
    lastAppliedTimeRef.current = currentTime;
    timelineRef.current.setTime(currentTime);
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

  const renderAction = useCallback(
    (action: TimelineAction) => {
      const segment = segmentLookup.get(action.id);
      const rawText = segment?.text ?? effects[action.effectId]?.name ?? "כתובית";
      const text = (rawText || "").trim() || "כתובית";
      const displayText = text.length > 40 ? `${text.slice(0, 37)}…` : text;

      return (
        <Stack
          className="subtitle-timeline-action"
          direction="row"
          spacing={0.75}
          alignItems="center"
          sx={{
            position: "relative",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            color: "#fff",
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              borderRadius: 1.5,
              background: disabled
                ? "linear-gradient(90deg, rgba(255, 213, 79, 0.7), rgba(255, 152, 0, 0.7))"
                : "linear-gradient(90deg, rgba(255, 213, 79, 0.95), rgba(255, 152, 0, 0.95))",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.4)",
            }}
          />
          <SubtitlesRoundedIcon fontSize="small" sx={{ position: "relative", zIndex: 1 }} />
          <Typography variant="caption" noWrap sx={{ position: "relative", zIndex: 1, fontWeight: 600 }}>
            {displayText}
          </Typography>
        </Stack>
      );
    },
    [effects, segmentLookup],
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

  return (
    <Stack spacing={1.5} sx={{ mt: 2 }} className="subtitle-timeline">
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="body2" color="text.secondary">
          זום ציר הזמן
        </Typography>
        <Box sx={{ flexGrow: 1 }}>
          <Slider
            min={-50}
            max={100}
            step={1}
            value={zoom}
            onChange={(_event, value) => setZoom(Array.isArray(value) ? value[0] : value)}
            size="small"
          />
        </Box>
      </Stack>

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
        style={{ height: 220 }}
      />
    </Stack>
  );
}





