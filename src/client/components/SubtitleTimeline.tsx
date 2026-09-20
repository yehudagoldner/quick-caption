import "react-virtualized/styles.css";
import "./SubtitleTimeline.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Chip, IconButton, Slider, Stack, TextField, ThemeProvider, Tooltip, Typography, createTheme, useTheme } from "@mui/material";
import { PlayArrowRounded, PauseRounded, UndoRounded, RedoRounded, RepeatRounded, ContentCutRounded, SaveOutlined, CloseRounded, RestartAltRounded } from "@mui/icons-material";
import { Timeline, type TimelineRow, type TimelineState } from "@xzdarcy/react-timeline-editor";
import type { Segment, Word } from "../types";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { formatTimecode, snapToFrame } from "../utils/timecode";
import { retimeCaption, validateCaptionRange, wordsForSegment, timelineZoomForWindow, timelineScrollForTime } from "../../timelineEditing.js";
import { synchronizeWords } from "../../wordAlignment.js";
import { WordTimeline } from "./WordTimeline";
import { AudioWaveform } from "./AudioWaveform";

export type CaptionDraft = { segment: Segment; words: Word[] };
export type SubtitleTimelineProps = {
  activeWordEnabled: boolean;
  segments: Segment[]; words?: Word[]; disabled?: boolean; busy?: boolean;
  duration?: number | null; currentTime?: number | null; mediaUrl: string | null;
  selectedSegmentId?: Segment["id"] | null;
  onSegmentSelect: (id: Segment["id"] | null) => void;
  onRequestTimeChange: (time: number) => void;
  onSegmentsChange: (segments: Segment[]) => void | Promise<void>;
  onSaveSegment: (segment: Segment, words: Word[]) => Promise<void>;
  onSplitSegment: (id: Segment["id"], time: number, draft?: CaptionDraft) => Promise<void>;
  isPlaying?: boolean; onPlayPause?: () => void; onPlayFrom: (time: number) => void;
  loopEnabled: boolean; onLoopChange: (enabled: boolean) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  onDraftStateChange: (dirty: boolean) => void;
};

export function SubtitleTimeline({ activeWordEnabled, segments, words = [], disabled, busy, duration, currentTime = 0, mediaUrl,
  selectedSegmentId, onSegmentSelect, onRequestTimeChange, onSegmentsChange, onSaveSegment, onSplitSegment,
  isPlaying, onPlayPause, onPlayFrom, loopEnabled, onLoopChange, onUndo, onRedo, canUndo, canRedo, onDraftStateChange,
}: SubtitleTimelineProps) {
  const { preferences } = useEditorPreferences();
  const fps = preferences.fps;
  const theme = useTheme();
  const ltrTheme = useMemo(() => createTheme(theme, { direction: "ltr" }), [theme]);
  const total = duration && Number.isFinite(duration) ? duration : Math.max(1, ...segments.map(s => s.end));
  const time = Math.max(0, Math.min(total, currentTime ?? 0));
  const timeline = useRef<TimelineState | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const scrollLeft = useRef(0);
  const [width, setWidth] = useState(800);
  // Null keeps the 30-second window automatic while metadata/width loads.
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => { setZoom(null); scrollLeft.current = 0; timeline.current?.setScrollLeft(0); }, [mediaUrl]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, CaptionDraft>>({});
  const locked = disabled || busy || saving;
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => { onDraftStateChange(dirty); }, [dirty, onDraftStateChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  const effectiveZoom = zoom ?? timelineZoomForWindow(total);
  const pixelsPerSecond = Math.max(.01, (width - 40) / total) * 2 ** (effectiveZoom / 25);
  const scale = Math.max(1, Math.ceil(100 / pixelsPerSecond));
  const scaleWidth = pixelsPerSecond * scale;
  useLayoutEffect(() => {
    if (timeline.current?.getTime() !== time) timeline.current?.setTime(time);
    const nextScroll = timelineScrollForTime(time, pixelsPerSecond, width, scrollLeft.current);
    if (nextScroll !== scrollLeft.current) {
      scrollLeft.current = nextScroll;
      timeline.current?.setScrollLeft(scrollLeft.current);
    }
  }, [time, pixelsPerSecond, width]);
  const seek = (value: number) => { onRequestTimeChange(Math.max(0, Math.min(total, snapToFrame(value, fps)))); return true; };
  const rows = useMemo<TimelineRow[]>(() => [{ id: "captions", actions: segments.map(s => ({
    id: String(s.id), effectId: String(s.id), start: s.start, end: s.end, movable: !locked && !dirty, flexible: !locked && !dirty,
  })) }], [segments, locked, dirty]);
  const effects = useMemo(() => Object.fromEntries(segments.map(s => [String(s.id), { id: String(s.id), name: s.text }])), [segments]);
  const selected = segments.find(s => s.id === selectedSegmentId);
  // Playback changes time each frame, not the track data. Keep the word array stable
  // so the timeline does not rebuild its virtualized grid on every video frame.
  const draft = useMemo(() => selected ? drafts[String(selected.id)] ?? {
    segment: selected, words: wordsForSegment(words, selected),
  } : null, [selected, drafts, words]);
  const setDraft = (next: CaptionDraft) => {
    setDrafts(previous => ({ ...previous, [String(next.segment.id)]: next }));
  };
  const clearDraft = (id: Segment["id"]) => setDrafts(previous => {
    const next = { ...previous }; delete next[String(id)]; return next;
  });
  const save = async (split = false) => {
    if (!draft || locked) return;
    setSaving(true); setError(null);
    try {
      if (split) await onSplitSegment(draft.segment.id, time, draft);
      else await onSaveSegment(draft.segment, draft.words);
      clearDraft(draft.segment.id);
      if (split) onSegmentSelect(null);
    } catch (e) { setError((e as Error).message || "השמירה נכשלה; הטיוטה נשמרה בעורך."); }
    finally { setSaving(false); }
  };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,[contenteditable="true"],[role="dialog"]') || locked || dirty) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault(); if (event.shiftKey) { if (canRedo) onRedo(); } else if (canUndo) onUndo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); if (canRedo) onRedo();
      }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, [locked, dirty, canUndo, canRedo, onUndo, onRedo]);
  const canSplit = draft && draft.segment.text.trim().split(/\s+/).length > 1 && time > draft.segment.start && time < draft.segment.end;

  return <Stack spacing={1.5} className="subtitle-timeline" sx={{ width: "100%", minWidth: 0 }}>
    <Typography variant="subtitle1" fontWeight={700}>ציר הזמן הראשי — כל ההקלטה</Typography>
    <Typography variant="caption">גררו גוף מקטע להזזה וקצה לשינוי משך. חפיפות וחיתוך מילים מתוזמנות נחסמים. לחצו על מקטע לעריכה.</Typography>
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} alignItems="center">
      <Button startIcon={<UndoRounded />} onClick={onUndo} disabled={!canUndo || locked || dirty}>ביטול פעולה</Button>
      <Button startIcon={<RedoRounded />} onClick={onRedo} disabled={!canRedo || locked || dirty}>ביצוע חוזר</Button>
    </Stack>
    {dirty && <Alert severity="info">יש טיוטות שלא נשמרו. אפשר לעבור בין מקטעים ללא אובדן השינויים; שמרו או בטלו את הטיוטות לפני יציאה, ייצוא או ביטול פעולה.
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} sx={{ mt: 1 }}>{Object.values(drafts).map(d => <Chip key={d.segment.id} label={`טיוטה: ${d.segment.text.slice(0, 22)}`} onClick={() => onSegmentSelect(d.segment.id)} />)}</Stack>
    </Alert>}
    {error && <Alert severity="warning" onClose={() => setError(null)}>{error}</Alert>}
    <Stack direction="row" alignItems="center" gap={1}>
      <IconButton aria-label={isPlaying ? "השהה" : "נגן"} onClick={onPlayPause}>{isPlaying ? <PauseRounded /> : <PlayArrowRounded />}</IconButton>
      <Button size="small" aria-label="פריים אחורה" onClick={() => seek(time - 1 / fps)}>−1F</Button>
      <Typography variant="body2" dir="ltr" data-testid="playhead-timecode" sx={{ whiteSpace: "nowrap" }}>{formatTimecode(time, fps)}</Typography>
      <Button size="small" aria-label="פריים קדימה" onClick={() => seek(time + 1 / fps)}>+1F</Button>
    </Stack>
    <ThemeProvider theme={ltrTheme}><Box dir="ltr" sx={{ px: 1 }}><Slider aria-label="מיקום בהקלטה" min={0} max={total} step={1 / fps} value={time} onChange={(_, value) => seek(value as number)} /></Box></ThemeProvider>
    <AudioWaveform mediaUrl={mediaUrl} duration={total} currentTime={time} onSeek={seek} />
    <Box data-testid="timeline-tracks" sx={{ minWidth: 0 }}>
    <Stack data-testid="main-timeline-zoom" direction="row" gap={1} alignItems="center" sx={{ height: 40, px: 1, bgcolor: "action.hover", minWidth: 0 }}>
      <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>זום ציר ראשי</Typography>
      <ThemeProvider theme={ltrTheme}><Box dir="ltr" sx={{ flex: 1, minWidth: 40, maxWidth: 240, px: 1 }}>
        <Slider size="small" aria-label="זום ציר ראשי" min={0} max={Math.max(200, Math.ceil(timelineZoomForWindow(total, 1)))} value={effectiveZoom}
          aria-valuetext={`כ־${Math.round(total / 2 ** (effectiveZoom / 25))} שניות בתצוגה`} onChange={(_, value) => setZoom(value as number)} />
      </Box></ThemeProvider>
      <Button size="small" aria-label="תצוגת 30 שניות" aria-pressed={zoom === null} variant={zoom === null ? "contained" : "text"} onClick={() => setZoom(null)} sx={{ whiteSpace: "nowrap", minWidth: 0 }}>30 שנ׳</Button>
      <Button size="small" aria-label="התאם את כל ההקלטה" aria-pressed={zoom === 0} onClick={() => { setZoom(0); scrollLeft.current = 0; timeline.current?.setScrollLeft(0); }} sx={{ whiteSpace: "nowrap", minWidth: 0 }}>הכול</Button>
    </Stack>
    <Box ref={container} data-testid="caption-track" sx={{ minWidth: 0, direction: "ltr", "& *": { direction: "ltr !important" } }}>
      <Timeline ref={timeline} editorData={rows} effects={effects} disableDrag={locked || dirty} gridSnap={false} dragLine
        scale={scale} scaleWidth={scaleWidth} scaleSplitCount={4} minScaleCount={Math.max(2, Math.ceil(total / scale) + 1)}
        getScaleRender={value => <span>{formatTimecode(value, fps)}</span>}
        onCursorDrag={seek} onCursorDragEnd={seek} onClickTimeArea={seek}
        onScroll={p => { scrollLeft.current = p.scrollLeft; }}
        onChange={nextRows => {
          const next = nextRows[0].actions.map(action => {
            const original = segments.find(s => String(s.id) === action.id)!;
            // Do not quantize untouched boundaries or words.
            if (action.start === original.start && action.end === original.end) return original;
            const moving = Math.abs(action.end - action.start - (original.end - original.start)) < .000001;
            const start = action.start === original.start ? original.start : snapToFrame(action.start, fps);
            return { ...original, start, end: moving ? start + original.end - original.start : snapToFrame(action.end, fps) };
          });
          try {
            for (const item of next) {
              const original = segments.find(s => s.id === item.id)!;
              if (original.start === item.start && original.end === item.end) continue;
              const problem = validateCaptionRange(item, next, total);
              if (problem) throw new Error(problem);
              try { retimeCaption(original, item, words); }
              catch (e) {
                const hint = activeWordEnabled ? "" : ' הפעילו ״מילה אקטיבית״ כדי להציג את ציר המילים.';
                throw new Error((e as Error).message + hint);
              }
            }
            setError(null);
            Promise.resolve(onSegmentsChange(next)).catch(e => setError(e.message));
          } catch (e) { setError((e as Error).message); return false; }
        }}
        getActionRender={action => {
          // The timeline library retains the previous row for one render after split/undo.
          const segment = segments.find(s => String(s.id) === action.id);
          if (!segment) return null;
          return <Box className="subtitle-timeline-action" data-testid="subtitle-clip" role="button" tabIndex={0}
            aria-label={`עריכת כתובית: ${segment.text}`} aria-pressed={selectedSegmentId === segment.id}
            title={`${segment.text} · ${formatTimecode(segment.start, fps)} – ${formatTimecode(segment.end, fps)}. גררו להזזה או לחצו לעריכה.`}
            onClick={() => { if (!locked) onSegmentSelect(segment.id); }}
            onKeyDown={e => { if (!locked && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSegmentSelect(segment.id); } }}
            sx={{ bgcolor: selectedSegmentId === segment.id ? "primary.main" : "#9b5700", color: "white", height: "100%", px: 1, display: "flex", alignItems: "center", borderRadius: 1, overflow: "hidden" }}>
            <Typography noWrap variant="caption" sx={{ direction: `${preferences.direction} !important`, unicodeBidi: "plaintext" }}>{segment.text}</Typography>
          </Box>;
        }} style={{ height: 130, width: "100%" }} />
    </Box>
    {draft && !disabled && <Box data-testid="segment-inspector">
        <WordTimeline enabled={activeWordEnabled} segment={draft.segment} words={draft.words} currentTime={time} disabled={locked} onSeek={seek}
          toolbarEditor={<TextField variant="standard" fullWidth value={draft.segment.text} disabled={locked}
          placeholder="טקסט המקטע" inputProps={{ dir: preferences.direction, "aria-label": "טקסט המקטע", title: draft.segment.text }}
          InputProps={{ disableUnderline: true }} onChange={e => {
            const segment = { ...draft.segment, text: e.target.value };
            setDraft({ segment, words: synchronizeWords([segment], draft.words) });
          }} />}
          toolbarActions={<>
            <Tooltip title="נגן מתחילת המקטע"><span><IconButton size="small" aria-label="נגן מכאן" onClick={() => onPlayFrom(draft.segment.start)} disabled={locked}><PlayArrowRounded /></IconButton></span></Tooltip>
            <Tooltip title="נגן מקטע בלולאה"><IconButton size="small" aria-label="נגן מקטע בלולאה" aria-pressed={loopEnabled} color={loopEnabled ? "primary" : "default"} onClick={() => onLoopChange(!loopEnabled)}><RepeatRounded /></IconButton></Tooltip>
            <Tooltip title="פצל בגבול המילה הקרוב לסמן"><span><IconButton size="small" aria-label="פצל" disabled={locked || !canSplit} onClick={() => save(true)}><ContentCutRounded /></IconButton></span></Tooltip>
            <Tooltip title="ביטול טיוטת המקטע"><span><IconButton size="small" aria-label="ביטול טיוטה" disabled={locked || !drafts[String(draft.segment.id)]} onClick={() => clearDraft(draft.segment.id)}><RestartAltRounded /></IconButton></span></Tooltip>
          </>}
          toolbarPrimary={<Tooltip title={drafts[String(draft.segment.id)] ? "שמור שינויים • יש טיוטה" : "אין שינויים לשמירה"}><span><IconButton size="small" aria-label="שמור שינויים" color="primary"
            sx={{ bgcolor: drafts[String(draft.segment.id)] ? "primary.main" : undefined, color: drafts[String(draft.segment.id)] ? "primary.contrastText" : undefined, "&:hover": { bgcolor: "primary.dark", color: "primary.contrastText" } }}
            disabled={locked || !drafts[String(draft.segment.id)] || !draft.segment.text.trim()} onClick={() => save()}><SaveOutlined /></IconButton></span></Tooltip>}
          toolbarClose={<Tooltip title="סגור עורך — הטיוטה נשמרת עד לשמירה או ביטול"><span><IconButton size="small" aria-label="סגור עורך" onClick={() => onSegmentSelect(null)} disabled={saving}><CloseRounded /></IconButton></span></Tooltip>}
          onWordsChange={nextWords => setDraft({ segment: { ...draft.segment, text: nextWords.map(w => w.word).join(" ") }, words: nextWords })} />
    </Box>}
    </Box>
  </Stack>;
}
