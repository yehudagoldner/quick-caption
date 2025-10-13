import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Card, IconButton, Slider, Stack, Typography } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import ZoomInRoundedIcon from "@mui/icons-material/ZoomInRounded";
import ZoomOutRoundedIcon from "@mui/icons-material/ZoomOutRounded";
import RecordVoiceOverRoundedIcon from "@mui/icons-material/RecordVoiceOverRounded";
import {
  Timeline,
  type TimelineAction,
  type TimelineEffect,
  type TimelineRow,
  type TimelineState,
} from "@xzdarcy/react-timeline-editor";
import type { Word, Segment } from "../types";

const ROW_ID = "word-row";

function wordKey(word: Word, index: number): string {
  return `word-${index}-${word.start}-${word.end}`;
}

export type WordTimelineProps = {
  segment: Segment;
  words: Word[];
  currentTime: number | null;
  onWordsChange: (words: Word[]) => void;
  onClose: () => void;
  onSave: () => void;
};

export function WordTimeline({
  segment,
  words: initialWords,
  currentTime,
  onWordsChange,
  onClose,
  onSave,
}: WordTimelineProps) {
  // Filter words that belong to this segment
  const segmentWords = useMemo(() => {
    return initialWords.filter(
      (word) => word.start >= segment.start - 0.01 && word.start <= segment.end + 0.01
    );
  }, [initialWords, segment.start, segment.end]);

  const [editableWords, setEditableWords] = useState<Word[]>(segmentWords);

  const editorData = useMemo<TimelineRow[]>(() => {
    const actions: TimelineAction[] = editableWords.map((word, index) => ({
      id: wordKey(word, index),
      start: word.start,
      end: word.end,
      effectId: wordKey(word, index),
      flexible: true,
      movable: true,
    }));

    return [
      {
        id: ROW_ID,
        actions,
      },
    ];
  }, [editableWords]);

  const effects = useMemo<Record<string, TimelineEffect>>(() => {
    return editableWords.reduce<Record<string, TimelineEffect>>((acc, word, index) => {
      const id = wordKey(word, index);
      acc[id] = {
        id,
        name: word.word,
      };
      return acc;
    }, {});
  }, [editableWords]);

  const wordLookup = useMemo(() => {
    const map = new Map<string, { word: Word; index: number }>();
    editableWords.forEach((word, index) => {
      map.set(wordKey(word, index), { word, index });
    });
    return map;
  }, [editableWords]);

  const duration = segment.end - segment.start;
  const [zoom, setZoom] = useState(0);

  const timelineRef = useRef<TimelineState | null>(null);
  const isCursorDraggingRef = useRef(false);
  const lastAppliedTimeRef = useRef<number | null>(null);

  const baseScaleCount = useMemo(() => Math.max(10, Math.ceil(duration) + 1), [duration]);
  const baseScale = 1;
  const baseScaleWidth = 160; // Larger scale for word-level precision

  const zoomFactor = useMemo(() => Math.pow(2, zoom / 50), [zoom]);
  const scaleWidth = baseScaleWidth * zoomFactor;
  const scaleSplitCount = 4;

  const handleRowsChange = useCallback(
    (rows: TimelineRow[]) => {
      const row = rows.find((item) => item.id === ROW_ID);
      if (!row) {
        return;
      }

      const updatedWords = row.actions
        .map((action) => {
          const original = wordLookup.get(action.id);
          if (!original) {
            return null;
          }

          return {
            ...original.word,
            start: action.start,
            end: action.end,
          };
        })
        .filter((word): word is Word => word !== null)
        .sort((a, b) => a.start - b.start);

      if (updatedWords.length !== editableWords.length) {
        setEditableWords(updatedWords);
        return;
      }

      const changed = updatedWords.some((word, index) => {
        const original = editableWords[index];
        return original.start !== word.start || original.end !== word.end;
      });

      if (changed) {
        setEditableWords(updatedWords);
      }
    },
    [wordLookup, editableWords],
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
    if (lastAppliedTimeRef.current !== null && Math.abs(lastAppliedTimeRef.current - currentTime) < 0.05) {
      return;
    }
    lastAppliedTimeRef.current = currentTime;
    timelineRef.current.setTime(currentTime - segment.start);
  }, [currentTime, segment.start]);

  const renderAction = useCallback(
    (action: TimelineAction) => {
      const wordData = wordLookup.get(action.id);
      const text = wordData?.word.word ?? effects[action.effectId]?.name ?? "מילה";

      return (
        <Stack
          className="word-timeline-action"
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{
            position: "relative",
            width: "100%",
            height: "100%",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              borderRadius: 1,
              background: "linear-gradient(90deg, rgba(76, 175, 80, 0.95), rgba(56, 142, 60, 0.95))",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
              transition: "all 0.2s ease-in-out",
            }}
          />
          <RecordVoiceOverRoundedIcon fontSize="small" sx={{ position: "relative", zIndex: 1, fontSize: 14 }} />
          <Typography variant="caption" noWrap sx={{ position: "relative", zIndex: 1, fontWeight: 600, fontSize: 11 }}>
            {text}
          </Typography>
        </Stack>
      );
    },
    [effects, wordLookup],
  );

  const formatScaleLabel = useCallback((value: number) => {
    if (!Number.isFinite(value)) {
      return "";
    }
    const seconds = Math.max(0, value * baseScale);
    const totalMillis = Math.round(seconds * 1000);
    const wholeSeconds = Math.floor(totalMillis / 1000);
    const millis = totalMillis % 1000;
    const decimalPart = millis ? `.${Math.floor(millis / 100)}` : "";
    return `${wholeSeconds}${decimalPart}s`;
  }, [baseScale]);

  const handleSaveClick = useCallback(() => {
    // Merge updated words back into the full words array
    const updatedWordsMap = new Map(editableWords.map(w => [`${w.start}-${w.end}`, w]));
    const allWords = initialWords.map(w => {
      const key = `${w.start}-${w.end}`;
      return updatedWordsMap.has(key) ? updatedWordsMap.get(key)! : w;
    });

    onWordsChange(allWords);
    onSave();
  }, [editableWords, initialWords, onWordsChange, onSave]);

  return (
    <Card
      elevation={3}
      sx={{
        p: 2,
        bgcolor: "success.main",
        color: "success.contrastText",
        borderRadius: 2,
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Stack direction="row" spacing={1} alignItems="center">
            <RecordVoiceOverRoundedIcon />
            <Typography variant="subtitle1" fontWeight={600}>
              עריכת מיקום מילים
            </Typography>
          </Stack>
          <IconButton size="small" onClick={onClose} sx={{ color: "inherit" }}>
            <CloseRoundedIcon />
          </IconButton>
        </Stack>

        <Typography variant="body2" sx={{ opacity: 0.9 }}>
          כתובית: {segment.text}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ position: "relative" }}>
          {/* Word Timeline */}
          <Box
            sx={{
              flex: 1,
              direction: "ltr",
              "& *": {
                direction: "ltr !important",
              },
            }}
          >
            <Timeline
              ref={timelineRef}
              editorData={editorData}
              effects={effects}
              gridSnap
              dragLine
              scale={baseScale}
              minScaleCount={baseScaleCount}
              scaleWidth={scaleWidth}
              scaleSplitCount={scaleSplitCount}
              startLeft={segment.start}
              getScaleRender={(value) => <span>{formatScaleLabel(value)}</span>}
              onChange={handleRowsChange}
              getActionRender={(action) => renderAction(action)}
              style={{ height: 120, width: "100%" }}
            />
          </Box>

          {/* Vertical Zoom Control */}
          <Stack
            spacing={1}
            alignItems="center"
            sx={{
              width: 40,
              height: 120,
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
                min={-50}
                max={100}
                step={1}
                value={zoom}
                onChange={(_event, value) => setZoom(Array.isArray(value) ? value[0] : value)}
                size="small"
                sx={{ height: 50 }}
              />
            </Box>

            <IconButton size="small" onClick={() => setZoom(Math.max(-50, zoom - 10))}>
              <ZoomOutRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            variant="outlined"
            onClick={onClose}
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
            onClick={handleSaveClick}
            sx={{
              bgcolor: "background.paper",
              color: "success.main",
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
  );
}
