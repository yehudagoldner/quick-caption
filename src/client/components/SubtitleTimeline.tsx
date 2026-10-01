import "react-virtualized/styles.css";
import "./SubtitleTimeline.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Slider, Stack, TextField, ThemeProvider, Tooltip, Typography, createTheme, useTheme } from "@mui/material";
import { PlayArrowRounded, PauseRounded, UndoRounded, RedoRounded, RepeatRounded, ContentCutRounded, CloseRounded, RestartAltRounded, EditOutlined, OpenInFullRounded } from "@mui/icons-material";
import { Timeline, type TimelineRow, type TimelineState } from "@xzdarcy/react-timeline-editor";
import type { Segment, Word } from "../types";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { formatTimecode, snapToFrame } from "../utils/timecode";
import { retimeCaption, validateCaptionRange, wordsForSegment, timelineZoomForWindow, timelineScrollForTime } from "../../timelineEditing.js";
import { synchronizeWords } from "../../wordAlignment.js";
import { WordTimeline } from "./WordTimeline";
import { CaptionSelectionToolbar } from "./CaptionSelectionToolbar";
import { moveCaptionSelection } from "../../captionSelection.js";
import { canMergeCaptions, canSplitCaptionAtTime, type CaptionBatchAction } from "../../captionBatchEditing.js";
import { AudioWaveform } from "./AudioWaveform";
import { useTimelineScrubbing } from "../hooks/useTimelineScrubbing";
import { VideoSeekBar } from "./VideoSeekBar";

export type CaptionDraft = { segment: Segment; words: Word[] };
export type SubtitleTimelineProps = {
  activeWordEnabled: boolean;
  segments: Segment[]; words?: Word[]; disabled?: boolean; busy?: boolean;
  duration?: number | null; currentTime?: number | null; mediaUrl: string | null;
  selectedSegmentId?: Segment["id"] | null;
  onSegmentSelect: (id: Segment["id"] | null) => void;
  onRequestTimeChange: (time: number) => void;
  onCaptionBatch: (ids: Segment["id"][], action: CaptionBatchAction, splitTime?: number) => Promise<void>;
  onSegmentsChange: (segments: Segment[]) => void | Promise<void>;
  onAddSubtitle: (text: string, startTime: number, endTime: number) => void;
  onSaveSegment: (segment: Segment, words: Word[]) => Promise<void>;
  onSplitSegment: (id: Segment["id"], time: number, draft?: CaptionDraft) => Promise<void>;
  isPlaying?: boolean; onPlayPause?: () => void; onPlayFrom: (time: number) => void;
  loopEnabled: boolean; onLoopChange: (enabled: boolean) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  onDraftStateChange: (dirty: boolean) => void;
  layout?: "full" | "timing";
  compactDesktop?: boolean;
};

export function SubtitleTimeline({ activeWordEnabled, segments, words = [], disabled, busy, duration, currentTime = 0, mediaUrl,
  selectedSegmentId, onSegmentSelect, onRequestTimeChange, onSegmentsChange, onAddSubtitle, onCaptionBatch, onSaveSegment, onSplitSegment,
  isPlaying, onPlayPause, onPlayFrom, loopEnabled, onLoopChange,   onUndo, onRedo, canUndo, canRedo, onDraftStateChange, layout = "full", compactDesktop = false,
}: SubtitleTimelineProps) {
  const { preferences } = useEditorPreferences();
  const fps = preferences.fps;
  const theme = useTheme();
  const ltrTheme = useMemo(() => createTheme(theme, { direction: "ltr" }), [theme]);
  const total = duration && Number.isFinite(duration) ? duration : Math.max(1, ...segments.map(s => s.end));
  const time = Math.max(0, Math.min(total, currentTime ?? 0));
  const root = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<Segment["id"][]>([]);
  const selectionAnchor = useRef<Segment["id"] | null>(null);
  const localFocus = useRef<Segment["id"] | null | undefined>(undefined);
  const [movePreview, setMovePreview] = useState<Segment[] | null>(null);
  const dragging = useRef<{ x: number; scroll: number; ids: Segment["id"][]; source: Segment[]; next: Segment[]; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
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
  const [expandedSegmentId, setExpandedSegmentId] = useState<Segment["id"] | null>(null);
  useEffect(() => { setExpandedSegmentId(null); }, [mediaUrl]);
  useEffect(() => {
    if (expandedSegmentId !== null && expandedSegmentId !== selectedSegmentId) setExpandedSegmentId(null);
  }, [selectedSegmentId, expandedSegmentId]);
  const locked = disabled || busy || saving;
  const dirty = Object.keys(drafts).length > 0;
  const groupLocked = !!locked || dirty || movePreview !== null;
  useEffect(() => { setSelection([]); selectionAnchor.current = null; setMovePreview(null); dragging.current = null; }, [mediaUrl]);
  useEffect(() => {
    if (selectedSegmentId === localFocus.current) { localFocus.current = undefined; return; }
    setSelection(selectedSegmentId == null ? [] : [selectedSegmentId]);
  }, [selectedSegmentId]);
  useEffect(() => {
    if (!saving) setSelection(ids => ids.filter(id => segments.some(s => s.id === id)));
  }, [segments, saving]);
  const applySelection = (ids: Segment["id"][]) => {
    setSelection(ids);
    const focus = ids.length === 1 ? ids[0] : null;
    localFocus.current = focus;
    onSegmentSelect(focus);
    if (isPlaying) onPlayPause?.();
    onLoopChange(false);
  };
  const choose = (id: Segment["id"], event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (groupLocked) return;
    if (event.shiftKey && selectionAnchor.current != null) {
      const ordered = [...segments].sort((a, b) => a.start - b.start);
      const a = ordered.findIndex(s => s.id === selectionAnchor.current), b = ordered.findIndex(s => s.id === id);
      if (a >= 0 && b >= 0) applySelection(ordered.slice(Math.min(a, b), Math.max(a, b) + 1).map(s => s.id));
    } else if (event.ctrlKey || event.metaKey) {
      applySelection(selection.includes(id) ? selection.filter(value => value !== id) : [...selection, id]);
      selectionAnchor.current = id;
    } else { applySelection([id]); selectionAnchor.current = id; }
  };
  useEffect(() => { onDraftStateChange(dirty || saving || movePreview !== null); }, [dirty, saving, movePreview, onDraftStateChange]);
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
  const seek = (value: number) => { onRequestTimeChange(Math.max(0, Math.min(total, snapToFrame(value, fps)))); return true; };
  const { handlers: scrubbing, active: scrubbingActive } = useTimelineScrubbing(timeline, pixelsPerSecond, seek);
  useLayoutEffect(() => {
    if (timeline.current?.getTime() !== time) timeline.current?.setTime(time);
    if (scrubbingActive.current) return;
    const nextScroll = timelineScrollForTime(time, pixelsPerSecond, width, scrollLeft.current);
    if (nextScroll !== scrollLeft.current) {
      scrollLeft.current = nextScroll;
      timeline.current?.setScrollLeft(scrollLeft.current);
    }
  }, [time, pixelsPerSecond, width]);
  const displaySegments = movePreview ?? segments;
  const trackStructure = displaySegments.map(segment => `${segment.id}:${segment.start}:${segment.end}`).join("|");
  const rows = useMemo<TimelineRow[]>(() => [{ id: "captions", actions: displaySegments.map(s => ({
    id: String(s.id), effectId: String(s.id), start: s.start, end: s.end, movable: false, flexible: !locked && !dirty && selection.length <= 1,
  })) }], [trackStructure, locked, dirty, selection.length]);
  const effects = useMemo(() => Object.fromEntries(segments.map(s => [String(s.id), { id: String(s.id), name: String(s.id) }])), [trackStructure]);
  const selected = segments.find(s => s.id === selectedSegmentId);
  // Playback changes time each frame, not the track data. Keep the word array stable
  // so the timeline does not rebuild its virtualized grid on every video frame.
  const draft = useMemo(() => selected ? drafts[String(selected.id)] ?? {
    segment: selected, words: wordsForSegment(words, selected),
  } : null, [selected, drafts, words]);
  const setDraft = (next: CaptionDraft) => {
    setDrafts(previous => ({ ...previous, [String(next.segment.id)]: next }));
  };
  const changeText = (text: string) => {
    if (!draft || locked) return;
    const segment = { ...draft.segment, text };
    setDraft({ segment, words: synchronizeWords([segment], draft.words) });
  };
  const openExpandedEditor = (id: Segment["id"]) => {
    if (locked) return;
    onSegmentSelect(id);
    setExpandedSegmentId(id);
  };
  const expanded = !!draft && !disabled && expandedSegmentId === draft.segment.id;
  const clearDraft = (id: Segment["id"]) => setDrafts(previous => {
    const next = { ...previous }; delete next[String(id)]; return next;
  });
  const draftsRef = useRef(drafts);
  const segmentsRef = useRef(segments);
  const wordsRef = useRef(words);
  const saveSegmentRef = useRef(onSaveSegment);
  const gateRef = useRef({ disabled: !!disabled, busy: !!busy });
  const flight = useRef(false);
  draftsRef.current = drafts;
  segmentsRef.current = segments;
  wordsRef.current = words;
  saveSegmentRef.current = onSaveSegment;
  gateRef.current = { disabled: !!disabled, busy: !!busy };
  const draftSignature = (item: CaptionDraft) => JSON.stringify([
    item.segment.text, item.segment.start, item.segment.end,
    item.words.map(word => [word.word, word.start, word.end, word.segmentId]),
  ]);
  const commitDraft = async (item: CaptionDraft) => {
    const source = segmentsRef.current.find(segment => segment.id === item.segment.id);
    if (!source || !item.segment.text.trim()) return;
    const stamp = draftSignature(item);
    const persisted = draftSignature({ segment: source, words: wordsForSegment(wordsRef.current, source) });
    if (persisted === stamp) {
      setDrafts(previous => {
        const current = previous[String(item.segment.id)];
        if (!current || draftSignature(current) !== stamp) return previous;
        const next = { ...previous }; delete next[String(item.segment.id)]; return next;
      });
      return;
    }
    await saveSegmentRef.current({ ...item.segment, start: source.start, end: source.end }, item.words);
    setDrafts(previous => {
      const current = previous[String(item.segment.id)];
      if (!current || draftSignature(current) !== stamp) return previous;
      const next = { ...previous }; delete next[String(item.segment.id)]; return next;
    });
  };
  const commitRef = useRef(commitDraft);
  commitRef.current = commitDraft;
  useEffect(() => {
    const tick = async () => {
      if (flight.current || gateRef.current.disabled || gateRef.current.busy) return;
      const pending = Object.values(draftsRef.current).filter(item => item.segment.text.trim());
      if (!pending.length) return;
      flight.current = true;
      try {
        for (const item of pending) await commitRef.current(item);
      } catch (e) { setError((e as Error).message || "השמירה נכשלה; הטיוטה נשמרה בעורך."); }
      finally { flight.current = false; }
    };
    const timer = window.setInterval(() => { void tick(); }, 3000);
    return () => window.clearInterval(timer);
  }, [mediaUrl]);
  const save = async (split = false) => {
    if (!draft || locked || flight.current || !draft.segment.text.trim()) return false;
    flight.current = true;
    setSaving(true); setError(null);
    try {
      if (split) await onSplitSegment(draft.segment.id, time, draft);
      else await commitDraft(draft);
      if (split) clearDraft(draft.segment.id);
      if (split) onSegmentSelect(null);
      return true;
    } catch (e) { setError((e as Error).message || "השמירה נכשלה; הטיוטה נשמרה בעורך."); return false; }
    finally { flight.current = false; setSaving(false); }
  };
  const deleteWords = async (remainingWords: Word[]) => {
    if (!draft || locked || flight.current) return;
    flight.current = true; setSaving(true); setError(null);
    try {
      if (!remainingWords.length) {
        // Removing every word also removes the now-empty caption, keeping
        // autosave/navigation valid and using the existing Undo history.
        await onCaptionBatch([draft.segment.id], "delete");
        clearDraft(draft.segment.id);
        onSegmentSelect(null);
      } else {
        const next = { segment: { ...draft.segment, text: remainingWords.map(word => word.word).join(" ") }, words: remainingWords };
        setDraft(next);
        await commitDraft(next);
      }
    } catch (e) { setError((e as Error).message || "מחיקת המילים נכשלה; השינוי נשמר בעורך."); throw e; }
    finally { flight.current = false; setSaving(false); }
  };
  const runSelectionAction = async (action: CaptionBatchAction) => {
    if (groupLocked || flight.current || !selection.length) return;
    root.current?.focus({ preventScroll: true });
    flight.current = true; setSaving(true); setError(null);
    try {
      await onCaptionBatch(selection, action, time);
      clearSelection();
    } catch (e) { setError((e as Error).message || "שמירת הפעולה נכשלה. הבחירה נשמרה; נסו שוב."); }
    finally { flight.current = false; setSaving(false); }
  };
  const commitMove = async (next: Segment[]) => {
    if (flight.current || next === segments || next.every((s, i) => s.start === segments[i]?.start && s.end === segments[i]?.end)) return;
    flight.current = true; setSaving(true); setError(null);
    try { await onSegmentsChange(next); }
    catch (e) { setError((e as Error).message || "שמירת ההזזה נכשלה. נסו שוב."); }
    finally { flight.current = false; setSaving(false); }
  };
  const nudge = (frames: number) => {
    if (!groupLocked && !flight.current) void commitMove(moveCaptionSelection(segments, selection, frames / fps, total, fps));
  };
  const clearSelection = () => { applySelection([]); selectionAnchor.current = null; };
  const cancelDrag = () => { dragging.current = null; setMovePreview(null); suppressClick.current = true; };
  const selectedCaption = selection.length === 1 ? segments.find(s => s.id === selection[0]) : undefined;
  useEffect(() => {
    if (!compactDesktop || selection.length < 2 || groupLocked || flight.current) return;
    const dismiss = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || dragging.current) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('button,a,input,textarea,select,video,audio,[contenteditable="true"],[role="button"],[role="slider"],[role="dialog"],[role="menu"],[role="listbox"],[role="tab"],[role="toolbar"],[data-testid="segment-inspector"],[data-testid="word-track"],.timeline-editor-action,.timeline-editor-cursor')) return;
      clearSelection();
    };
    // Capture before timeline scrubbing stops propagation, including blank space
    // elsewhere in the desktop editor. Caption and control gestures stay intact.
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  });
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (compactDesktop && event.code === "Escape" && selection.length && !locked && !dirty && !flight.current && !dragging.current
        && !event.defaultPrevented && !event.isComposing && !target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"],[role="listbox"]')) {
        event.preventDefault(); clearSelection(); return;
      }
      if (event.defaultPrevented || event.isComposing || !root.current?.contains(target)
        || target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="slider"],[data-testid="segment-inspector"]')) return;
      const command = event.ctrlKey || event.metaKey;
      if (event.code === "Escape" && dragging.current) { event.preventDefault(); cancelDrag(); return; }
      if (locked || dirty || dragging.current || flight.current) return;
      if (command && event.code === "KeyA") { event.preventDefault(); applySelection(segments.map(s => s.id)); }
      else if (event.code === "Escape") { event.preventDefault(); clearSelection(); }
      else if (command && event.code === "KeyZ") {
        event.preventDefault(); if (event.shiftKey) { if (canRedo) onRedo(); } else if (canUndo) onUndo();
      } else if (command && event.code === "KeyY") { event.preventDefault(); if (canRedo) onRedo(); }
      else if (command && event.code === "KeyM") { event.preventDefault(); if (canMergeCaptions(segments, selection)) void runSelectionAction("merge"); }
      else if (command && event.code === "KeyK") { event.preventDefault(); if (canSplitCaptionAtTime(selectedCaption, time)) void runSelectionAction("split"); }
      else if (!command && !event.altKey && (event.code === "Delete" || event.code === "Backspace")) { event.preventDefault(); if (selection.length) void runSelectionAction("delete"); }
      else if ((!command || event.metaKey) && (event.code === "ArrowLeft" || event.code === "ArrowRight")) {
        event.preventDefault(); const frames = (event.code === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1);
        if (selection.length) nudge(frames); else seek(time + frames / fps);
      } else if (!command && !event.altKey && event.code === "Space" && !target.closest('button')) { event.preventDefault(); onPlayPause?.(); }
      else if (!command && (event.code === "Home" || event.code === "End")) { event.preventDefault(); seek(event.code === "Home" ? 0 : total); }
      else if (!command && (event.code === "Equal" || event.code === "Minus" || event.code === "NumpadAdd" || event.code === "NumpadSubtract")) {
        event.preventDefault(); setZoom(Math.max(0, Math.min(Math.max(200, Math.ceil(timelineZoomForWindow(total, 1))), effectiveZoom + (event.code === "Equal" || event.code === "NumpadAdd" ? 10 : -10))));
      } else if (command && event.code === "Digit0") { event.preventDefault(); setZoom(0); scrollLeft.current = 0; timeline.current?.setScrollLeft(0); }
      else if (event.code === "F2" && selectedCaption) { event.preventDefault(); openExpandedEditor(selectedCaption.id); }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  });
  const compactTiming = layout === "timing";
  const canSplit = draft && draft.segment.text.trim().split(/\s+/).length > 1 && time > draft.segment.start && time < draft.segment.end;

  return <Stack ref={root} tabIndex={-1} onPointerDownCapture={event => { if (!(event.target as HTMLElement).closest('input,textarea,button,[role="slider"],[data-testid="segment-inspector"]')) root.current?.focus({ preventScroll: true }); }} spacing={compactTiming || compactDesktop ? .75 : 1.5} className="subtitle-timeline" sx={{ width: "100%", minWidth: 0, flexShrink: 0, outline: "none" }}>
    {!compactTiming && !compactDesktop && <>
    <Typography variant="subtitle1" fontWeight={700}>ציר הזמן הראשי — כל ההקלטה</Typography>
    <Typography variant="caption">גררו גוף מקטע להזזה וקצה לשינוי משך. Ctrl לבחירה מרובה, Shift לבחירת טווח. חפיפות נחסמות.</Typography>
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} alignItems="center">
      <Button startIcon={<UndoRounded />} onClick={onUndo} disabled={!canUndo || locked || dirty}>ביטול פעולה</Button>
      <Button startIcon={<RedoRounded />} onClick={onRedo} disabled={!canRedo || locked || dirty}>ביצוע חוזר</Button>
    </Stack>
    </>}
    {error && !expanded && <Alert severity="warning" onClose={() => setError(null)}>{error}</Alert>}
    <Stack direction="row" alignItems="center" gap={1}>
      <IconButton aria-label={isPlaying ? "השהה" : "נגן"} onClick={onPlayPause}>{isPlaying ? <PauseRounded /> : <PlayArrowRounded />}</IconButton>
      <Button size="small" aria-label="פריים אחורה" onClick={() => seek(time - 1 / fps)}>−1F</Button>
      <Typography variant="body2" dir="ltr" data-testid="playhead-timecode" sx={{ whiteSpace: "nowrap" }}>{formatTimecode(time, fps)}</Typography>
      <Button size="small" aria-label="פריים קדימה" onClick={() => seek(time + 1 / fps)}>+1F</Button>
      {(compactTiming || compactDesktop) && <>
        <IconButton size="small" aria-label="ביטול פעולה" onClick={onUndo} disabled={!canUndo || locked || dirty}><UndoRounded /></IconButton>
        <IconButton size="small" aria-label="ביצוע חוזר" onClick={onRedo} disabled={!canRedo || locked || dirty}><RedoRounded /></IconButton>
      </>}
      {compactDesktop && <Box dir="ltr" sx={{ flex: 1, px: 2 }}><VideoSeekBar currentTime={time} duration={total} fps={fps} mediaUrl={mediaUrl} onSeek={onRequestTimeChange} /></Box>}
    </Stack>
    {!compactDesktop && <Box dir="ltr" sx={{ px: 1 }}><VideoSeekBar currentTime={time} duration={total} fps={fps} mediaUrl={mediaUrl} onSeek={onRequestTimeChange} /></Box>}
    {!compactTiming && <AudioWaveform mediaUrl={mediaUrl} duration={total} currentTime={time} onSeek={seek} />}
    <Box data-testid="timeline-tracks" sx={{ minWidth: 0 }}>
    <Stack data-testid="main-timeline-zoom" direction="row" gap={1} alignItems="center" sx={{ height: compactTiming ? 36 : 40, px: 1, bgcolor: "action.hover", minWidth: 0 }}>
      {!compactTiming && <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>זום ציר ראשי</Typography>}
      <ThemeProvider theme={ltrTheme}><Box dir="ltr" sx={{ flex: 1, minWidth: 40, maxWidth: 240, px: 1 }}>
        <Slider size="small" aria-label="זום ציר ראשי" min={0} max={Math.max(200, Math.ceil(timelineZoomForWindow(total, 1)))} value={effectiveZoom}
          aria-valuetext={`כ־${Math.round(total / 2 ** (effectiveZoom / 25))} שניות בתצוגה`} onChange={(_, value) => setZoom(value as number)} />
      </Box></ThemeProvider>
      <Button size="small" aria-label="תצוגת 30 שניות" aria-pressed={zoom === null} variant={zoom === null ? "contained" : "text"} onClick={() => setZoom(null)} sx={{ whiteSpace: "nowrap", minWidth: 0 }}>30 שנ׳</Button>
      <Button size="small" aria-label="התאם את כל ההקלטה" aria-pressed={zoom === 0} onClick={() => { setZoom(0); scrollLeft.current = 0; timeline.current?.setScrollLeft(0); }} sx={{ whiteSpace: "nowrap", minWidth: 0 }}>הכול</Button>
      <CaptionSelectionToolbar count={selection.length} disabled={groupLocked} canMerge={canMergeCaptions(segments, selection)} canSplit={canSplitCaptionAtTime(selectedCaption, time)}
        canAdd={time < total} add={() => { if (isPlaying) onPlayPause?.(); onLoopChange(false); onAddSubtitle("הכנס טקסט כאן", time, Math.min(total, time + 0.5)); }}
        selectAll={() => applySelection(segments.map(s => s.id))} clear={clearSelection} merge={() => void runSelectionAction("merge")} split={() => void runSelectionAction("split")} remove={() => void runSelectionAction("delete")} move={nudge} />
    </Stack>
    <Box ref={container} data-testid="caption-track" {...scrubbing} sx={{ minWidth: 0, direction: "ltr", "& *": { direction: "ltr !important" } }}>
      <Timeline ref={timeline} editorData={rows} effects={effects} disableDrag={locked || dirty || movePreview !== null} gridSnap={false} dragLine
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
            void commitMove(next);
          } catch (e) { setError((e as Error).message); return false; }
        }}
        getActionRender={action => {
          // The timeline library retains the previous row for one render after split/undo.
          const segment = segments.find(s => String(s.id) === action.id);
          if (!segment) return null;
          return <Box className="subtitle-timeline-action" data-testid="subtitle-clip" role="button" tabIndex={0}
            aria-label={`עריכת כתובית: ${segment.text}`} aria-pressed={selection.includes(segment.id)} data-start={action.start} data-end={action.end}
            title={`${segment.text} · ${formatTimecode(segment.start, fps)} – ${formatTimecode(segment.end, fps)}. לחצו לעריכה; לחיצה כפולה או F2 לפתיחה בחלון. גררו להזזה.`}
            onMouseDown={e => e.stopPropagation()}
            onPointerDown={e => {
              if (groupLocked || e.button !== 0) return;
              e.preventDefault(); e.stopPropagation();
              suppressClick.current = false;
              if (e.ctrlKey || e.metaKey || e.shiftKey) return;
              const ids = selection.includes(segment.id) ? selection : [segment.id];
              if (!selection.includes(segment.id)) { applySelection(ids); selectionAnchor.current = segment.id; }
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = { x: e.clientX, scroll: scrollLeft.current, ids, source: segments, next: segments, moved: false };
            }}
            onPointerMove={e => {
              const drag = dragging.current;
              if (!drag) return;
              if (!drag.moved && Math.abs(e.clientX - drag.x) < 4) return;
              drag.moved = true; suppressClick.current = true;
              const rect = container.current?.getBoundingClientRect();
              if (rect && (e.clientX < rect.left + 24 || e.clientX > rect.right - 24)) {
                scrollLeft.current = Math.max(0, Math.min(total * pixelsPerSecond, scrollLeft.current + (e.clientX < rect.left + 24 ? -12 : 12)));
                timeline.current?.setScrollLeft(scrollLeft.current);
              }
              drag.next = moveCaptionSelection(drag.source, drag.ids, (e.clientX - drag.x + scrollLeft.current - drag.scroll) / pixelsPerSecond, total, fps);
              setMovePreview(drag.next);
            }}
            onPointerUp={e => {
              const drag = dragging.current;
              dragging.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
              setMovePreview(null);
              if (drag?.moved) void commitMove(drag.next);
            }}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={() => { if (dragging.current) cancelDrag(); }}
            onClick={e => { e.stopPropagation(); if (suppressClick.current) { suppressClick.current = false; return; } choose(segment.id, e); }}
            onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); openExpandedEditor(segment.id); }}
            onKeyDown={e => {
              if (locked) return;
              if (e.key === "F2") { e.preventDefault(); openExpandedEditor(segment.id); }
              else if (e.key === "Enter") { e.preventDefault(); choose(segment.id, e); }
            }}
            sx={{ touchAction: "none", userSelect: "none", bgcolor: selection.includes(segment.id) ? "primary.main" : "#9b5700", color: "white", height: "100%", px: 1, display: "flex", alignItems: "center", borderRadius: 1, overflow: "hidden" }}>
            <Typography noWrap variant="caption" sx={{ direction: `${preferences.direction} !important`, unicodeBidi: "plaintext" }}>{segment.text}</Typography>
          </Box>;
        }} style={{ height: compactTiming || compactDesktop ? 88 : 130, width: "100%" }} />
    </Box>
    {!compactTiming && draft && !disabled && <Box data-testid="segment-inspector">
        <WordTimeline compact={compactDesktop} enabled={activeWordEnabled} segment={draft.segment} words={draft.words} currentTime={time} disabled={locked} onSeek={seek}
          onDeleteWords={deleteWords}
          toolbarEditor={<TextField className="caption-text-editor" variant="standard" fullWidth value={draft.segment.text} disabled={locked}
          placeholder="טקסט המקטע" inputProps={{ dir: preferences.direction, "aria-label": "טקסט המקטע", title: draft.segment.text }}
          onBlur={() => { if (draft.segment.text.trim()) void commitDraft(draft); }}
          InputProps={{ disableUnderline: true,
            startAdornment: <InputAdornment position="start" sx={{ ml: .75, mr: 0, color: "primary.main", gap: .5 }}><EditOutlined sx={{ fontSize: 16 }} /><Typography component="span" variant="caption" sx={{ fontWeight: 700, color: "primary.main", display: { xs: "none", sm: "inline" } }}>ערכו כאן</Typography></InputAdornment>,
            endAdornment: <InputAdornment position="end" sx={{ ml: 0 }}><Tooltip title="פתח עריכה בחלון"><span><IconButton size="small" aria-label="פתח עריכה בחלון" disabled={locked} onClick={() => openExpandedEditor(draft.segment.id)}><OpenInFullRounded /></IconButton></span></Tooltip></InputAdornment>,
          }} onChange={e => changeText(e.target.value)} />}
          toolbarActions={<>
            <Tooltip title="נגן מתחילת המקטע"><span><IconButton size="small" aria-label="נגן מכאן" onClick={() => onPlayFrom(draft.segment.start)} disabled={locked}><PlayArrowRounded /></IconButton></span></Tooltip>
            <Tooltip title="נגן מקטע בלולאה"><IconButton size="small" aria-label="נגן מקטע בלולאה" aria-pressed={loopEnabled} color={loopEnabled ? "primary" : "default"} onClick={() => onLoopChange(!loopEnabled)}><RepeatRounded /></IconButton></Tooltip>
            <Tooltip title="פצל בגבול המילה הקרוב לסמן"><span><IconButton size="small" aria-label="פצל" disabled={locked || !canSplit} onClick={() => save(true)}><ContentCutRounded /></IconButton></span></Tooltip>
            <Tooltip title="ביטול טיוטת המקטע"><span><IconButton size="small" aria-label="ביטול טיוטה" disabled={locked || !drafts[String(draft.segment.id)]} onClick={() => clearDraft(draft.segment.id)}><RestartAltRounded /></IconButton></span></Tooltip>
          </>}
          toolbarPrimary={null}
          toolbarClose={<Tooltip title="סגור עורך"><span><IconButton size="small" aria-label="סגור עורך" onClick={() => onSegmentSelect(null)} disabled={saving}><CloseRounded /></IconButton></span></Tooltip>}
          onWordsChange={nextWords => setDraft({ segment: { ...draft.segment, text: nextWords.map(w => w.word).join(" ") }, words: nextWords })} />
    </Box>}
    </Box>
    <Dialog open={expanded} onClose={() => { if (!locked) setExpandedSegmentId(null); }} fullWidth maxWidth="sm" aria-labelledby="caption-text-dialog-title">
      <DialogTitle id="caption-text-dialog-title">עריכת הכתובית</DialogTitle>
      <DialogContent>
        {draft && <TextField autoFocus fullWidth multiline minRows={4} maxRows={10} label="טקסט הכתובית" value={draft.segment.text} disabled={locked}
          inputProps={{ dir: preferences.direction }} sx={{ mt: 1 }} onChange={e => changeText(e.target.value)}
          onBlur={() => { if (draft.segment.text.trim()) void commitDraft(draft); }}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (draft.segment.text.trim()) void commitDraft(draft); setExpandedSegmentId(null); } }}
          helperText="הזמנים נקבעים בציר הראשי." />}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button disabled={locked} onClick={() => setExpandedSegmentId(null)}>חזרה לציר</Button>
      </DialogActions>
    </Dialog>
  </Stack>;
}
