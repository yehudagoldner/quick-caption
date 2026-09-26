import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Alert, Box, Button, IconButton, Stack, Typography } from "@mui/material";
import { DragIndicator, PauseRounded, PlayArrowRounded, RedoRounded, UndoRounded, TuneRounded } from "@mui/icons-material";
import type { Segment, Word } from "../types";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { formatTimecode } from "../utils/timecode";
import { mobileTimelineWindowSeconds, placeMobileCaption } from "../../timelineEditing.js";
import { CompactTimelineZoom } from "./CompactTimelineZoom";

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds + 1e-4));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

type DragMode = "move" | "start" | "end";
type Preview = Segment[];

export function MobileTimingTimeline({
  segments, words = [], disabled, duration, currentTime = 0, mediaUrl,
  selectedSegmentId, onSegmentSelect, onRequestTimeChange, onSegmentsChange,
  isPlaying, onPlayPause, onUndo, onRedo, canUndo, canRedo, onEditWords,
}: {
  segments: Segment[];
  words?: Word[];
  disabled?: boolean;
  duration?: number | null;
  currentTime?: number | null;
  mediaUrl: string | null;
  selectedSegmentId?: Segment["id"] | null;
  onSegmentSelect: (id: Segment["id"] | null) => void;
  onRequestTimeChange: (time: number) => void;
  onSegmentsChange: (segments: Segment[], options?: { fitWords?: boolean }) => void | Promise<void>;
  isPlaying?: boolean;
  onPlayPause?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onEditWords: (id: Segment["id"]) => void;
}) {
  const { preferences } = useEditorPreferences();
  const fps = preferences.fps;
  const total = duration && Number.isFinite(duration) && duration > 0 ? duration : Math.max(1, ...segments.map(segment => segment.end), 1);
  const time = Math.max(0, Math.min(total, currentTime ?? 0));
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const programmatic = useRef(false);
  const fromScroll = useRef<{ time: number; at: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; originX: number; mode: DragMode; segment: Segment } | null>(null);
  const previewRef = useRef<Preview | null>(null);
  const [width, setWidth] = useState(0);
  const [manualWindow, setManualWindow] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fittedRef = useRef({ key: "", seconds: 6 });
  const fitKey = `${mediaUrl ?? ""}:${segments.length}:${Math.round(width)}:${Math.round(total * 10)}`;
  if (width >= 40 && fittedRef.current.key !== fitKey) {
    fittedRef.current = { key: fitKey, seconds: mobileTimelineWindowSeconds(segments, width, total) };
  }
  const windowSeconds = Math.min(total, Math.max(0.5, manualWindow ?? fittedRef.current.seconds));
  const zoomRange = Math.log(total / Math.min(0.5, total));
  const zoomValue = zoomRange > 0 ? 100 * Math.log(total / windowSeconds) / zoomRange : 0;
  const pps = width >= 40 ? width / windowSeconds : 0;
  const latest = useRef({ segments, words, pps, total, fps, onSegmentsChange, onRequestTimeChange, windowSeconds });
  latest.current = { segments, words, pps, total, fps, onSegmentsChange, onRequestTimeChange, windowSeconds };

  useEffect(() => { setManualWindow(null); setPreview(null); setError(null); }, [mediaUrl]);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    let pinch: { distance: number; window: number } | null = null;
    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) pinch = { distance: distance(event.touches), window: latest.current.windowSeconds };
    };
    const move = (event: TouchEvent) => {
      if (!pinch || event.touches.length < 2) return;
      event.preventDefault();
      const next = pinch.window / (distance(event.touches) / pinch.distance);
      setManualWindow(Math.min(latest.current.total, Math.max(0.5, next)));
    };
    const end = () => { pinch = null; };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || pps <= 0 || dragRef.current) return;
    const pending = fromScroll.current;
    if (pending && performance.now() - pending.at < 280 && Math.abs(time - pending.time) > 0.08) return;
    fromScroll.current = null;
    const target = time * pps;
    if (Math.abs(el.scrollLeft - target) < 1) return;
    programmatic.current = true;
    el.scrollLeft = target;
  }, [time, pps]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || latest.current.pps <= 0) return;
    if (programmatic.current) { programmatic.current = false; return; }
    const next = Math.max(0, Math.min(latest.current.total, el.scrollLeft / latest.current.pps));
    fromScroll.current = { time: next, at: performance.now() };
    latest.current.onRequestTimeChange(next);
  };

  const showPreview = (next: Preview | null) => { previewRef.current = next; setPreview(next); };
  const beginDrag = (event: ReactPointerEvent, segment: Segment, mode: DragMode) => {
    if (disabled) return;
    event.stopPropagation();
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, originX: event.clientX, mode, segment: { ...segment } };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* The pointer is already owned by the gesture. */ }
  };
  const moveDrag = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = (event.clientX - drag.originX) / latest.current.pps;
    const placed = placeMobileCaption(drag.segment, latest.current.segments, latest.current.total, delta, drag.mode, latest.current.fps);
    showPreview(placed);
  };
  const endDrag = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    const current = previewRef.current;
    showPreview(null);
    if (event.type === "pointercancel") return;
    if (!current || current.every((item, index) => item.start === latest.current.segments[index].start && item.end === latest.current.segments[index].end)) return;
    Promise.resolve(latest.current.onSegmentsChange(current, { fitWords: true })).then(() => setError(null)).catch(reason => {
      setError(reason instanceof Error ? reason.message : "השינוי נחסם");
    });
  };

  const live = segments.find(segment => time >= segment.start - 0.001 && time < segment.end - 0.001);
  const focusedId = selectedSegmentId ?? live?.id ?? null;
  const step = [0.5, 1, 2, 5, 10, 15, 30].find(value => value * pps >= 64) ?? 30;
  const ticks = pps > 0 ? Array.from({ length: Math.floor(total / step) + 1 }, (_, index) => index * step) : [];
  const pad = width / 2;
  const view = preview ?? segments;
  const choose = (segment: Segment) => {
    onSegmentSelect(segment.id);
    if (time < segment.start || time >= segment.end) onRequestTimeChange(segment.start);
  };
  const jump = (clientX: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    fromScroll.current = null;
    onRequestTimeChange(ratio * total);
  };

  return <Stack spacing={0.5} data-testid="mobile-timing-editor" data-window-seconds={windowSeconds.toFixed(2)} sx={{ flex: "1 1 auto", minWidth: 0, minHeight: 0, width: "100%", maxWidth: "100%", height: "100%", overflow: "hidden", userSelect: "none" }}>
    <Stack direction="row" alignItems="center" dir="ltr" sx={{ flexShrink: 0, minHeight: 40 }}>
      <IconButton aria-label={isPlaying ? "השהה" : "נגן"} onClick={onPlayPause}>{isPlaying ? <PauseRounded /> : <PlayArrowRounded />}</IconButton>
      <Button size="small" aria-label="פריים אחורה" onClick={() => onRequestTimeChange(Math.max(0, time - 1 / fps))} sx={{ minWidth: 40, px: 0.5 }}>−1F</Button>
      <Typography variant="body2" dir="ltr" data-testid="playhead-timecode" sx={{ flex: 1, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{formatTimecode(time, fps)}</Typography>
      <Button size="small" aria-label="פריים קדימה" onClick={() => onRequestTimeChange(Math.min(total, time + 1 / fps))} sx={{ minWidth: 40, px: 0.5 }}>+1F</Button>
      <IconButton size="small" aria-label="ביטול פעולה" onClick={onUndo} disabled={!canUndo || disabled}><UndoRounded /></IconButton>
      <IconButton size="small" aria-label="ביצוע חוזר" onClick={onRedo} disabled={!canRedo || disabled}><RedoRounded /></IconButton>
      <Button size="small" aria-label="התאמת זום לעריכה" aria-pressed={manualWindow == null} onClick={() => setManualWindow(null)} sx={{ minWidth: 0, px: 0.75, fontSize: 11, whiteSpace: "nowrap", color: manualWindow == null ? "primary.main" : "text.secondary" }}>
        {manualWindow == null ? "אוטומטי" : "התאם"}
      </Button>
    </Stack>
    <Stack gap={0.5} sx={{ flexShrink: 0, minWidth: 0 }}>
    <Box dir="ltr" role="slider" aria-label="מיקום בהקלטה" aria-valuemin={0} aria-valuemax={Math.round(total * 1000)} aria-valuenow={Math.round(time * 1000)}
      sx={{ flexShrink: 0, width: "100%", minWidth: 0, position: "relative", height: 16, borderRadius: 99, bgcolor: "#e6ebf1", touchAction: "none", overflow: "hidden" }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); jump(event.clientX, event.currentTarget); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) jump(event.clientX, event.currentTarget); }}>
      <Box sx={{ position: "absolute", top: 4, bottom: 4, borderRadius: 99, bgcolor: "primary.main", opacity: 0.35,
        left: `${Math.max(0, (time - windowSeconds / 2) / total) * 100}%`, right: `${Math.max(0, 1 - (time + windowSeconds / 2) / total) * 100}%` }} />
      <Box sx={{ position: "absolute", top: 1, bottom: 1, width: 3, borderRadius: 99, bgcolor: "primary.main", left: `calc(${time / total * 100}% - ${time / total * 3}px)` }} />
    </Box>
    <Box sx={{ width: "100%", px: 0.5, boxSizing: "border-box", flexShrink: 0 }}>
      <CompactTimelineZoom label="זום ציר התזמון" value={zoomValue} min={0} max={100} step={0.1}
        valueText={`${Number(windowSeconds.toFixed(2))} שניות בתצוגה`} disabled={zoomRange === 0}
        onChange={value => { fromScroll.current = null; setManualWindow(total / Math.exp(value / 100 * zoomRange)); }} />
    </Box>
    </Stack>
    <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
      {error && <Alert severity="warning" onClose={() => setError(null)} sx={{ position: "absolute", top: 26, left: 8, right: 8, zIndex: 5, py: 0 }}>{error}</Alert>}
      <Box ref={scrollerRef} data-testid="mobile-timing-track" dir="ltr" onScroll={onScroll} sx={{
        height: "100%", width: "100%", maxWidth: "100%", overflowX: "auto", overflowY: "hidden", touchAction: "pan-x", overscrollBehaviorX: "contain",
        scrollbarWidth: "none", bgcolor: "#f3f5f8", borderRadius: "12px", border: 1, borderColor: "#e4e8ee",
        "&::-webkit-scrollbar": { display: "none" },
      }}>
        <Box sx={{ position: "relative", height: "100%", width: Math.max(width, pad + total * pps + pad) }}>
          {ticks.map(tick => <Box key={tick} sx={{ position: "absolute", left: pad + tick * pps, top: 0, bottom: 0, width: "1px", bgcolor: "rgba(15,23,42,0.08)", pointerEvents: "none" }}>
            <Typography component="span" dir="ltr" sx={{ position: "absolute", top: 2, left: 4, fontSize: 10, color: "#8b93a0", lineHeight: 1 }}>{clock(tick)}</Typography>
          </Box>)}
          {pps > 0 && view.map(segment => {
            const focused = segment.id === focusedId;
            const showChrome = focused && !disabled && !isPlaying;
            const left = pad + segment.start * pps + 2;
            const cardWidth = Math.max(8, (segment.end - segment.start) * pps - 4);
            return <Box key={segment.id} data-testid="mobile-timing-clip" data-start={segment.start} data-end={segment.end} role="button" tabIndex={0}
              aria-label={`כתובית: ${segment.text}`} aria-pressed={focused}
              onClick={event => { if ((event.target as HTMLElement).closest("[data-timing-handle], [data-word-timing-button]")) return; choose(segments.find(item => item.id === segment.id) ?? segment); }}
              onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(segment); } }}
              sx={{
                position: "absolute", top: 22, bottom: 8, left, width: cardWidth, borderRadius: "8px", bgcolor: "#fff",
                border: 1, borderColor: focused ? "primary.main" : "#e4e8ee", boxShadow: focused ? "0 0 0 1px #1976d2" : "none",
                overflow: "hidden", zIndex: focused ? 2 : 1, touchAction: "pan-x",
              }}>
              <IconButton data-word-timing-button size="small" aria-label={`תזמון מילים: ${segment.text}`} title="תזמון מילים" disabled={disabled}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); onEditWords(segment.id); }}
                sx={{ position: "absolute", top: 2, right: 2, width: 32, height: 32, zIndex: 3, color: "primary.main", bgcolor: "#e8f1fc", "&:hover": { bgcolor: "#d7e8fc" } }}>
                <TuneRounded sx={{ fontSize: 18 }} />
              </IconButton>
              <Box sx={{ height: "100%", px: showChrome ? 4.5 : 1.5, display: "flex", flexDirection: "column", justifyContent: "center", pt: 4.5, pb: showChrome ? "40px" : 0.5, overflow: "hidden" }}>
                <Typography dir={preferences.direction} sx={{ flexShrink: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.3, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{segment.text}</Typography>
                <Typography dir="ltr" variant="caption" color="text.secondary" sx={{ flexShrink: 0, mt: 0.25, textAlign: preferences.direction === "rtl" ? "right" : "left" }}>{formatTimecode(segment.start, fps)}–{formatTimecode(segment.end, fps)}</Typography>
              </Box>
              {showChrome && <>
                <Handle label="הזזת התחלה" edge="start" onDown={event => beginDrag(event, segment, "start")} onMove={moveDrag} onUp={endDrag} />
                <Box data-timing-handle role="slider" aria-label="הזזת המקטע" aria-valuemin={0} aria-valuemax={Math.round(total * 1000)} aria-valuenow={Math.round(segment.start * 1000)}
                  onPointerDown={event => beginDrag(event, segment, "move")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                  sx={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", width: 44, height: 28, display: "flex", alignItems: "center", justifyContent: "center", color: "primary.main", touchAction: "none", borderRadius: 99, bgcolor: "#e8f1fc" }}>
                  <DragIndicator sx={{ fontSize: 18 }} />
                </Box>
                <Handle label="הזזת סיום" edge="end" onDown={event => beginDrag(event, segment, "end")} onMove={moveDrag} onUp={endDrag} />
              </>}
            </Box>;
          })}
          {segments.length === 0 && <Typography color="text.secondary" sx={{ position: "absolute", top: "50%", left: pad, transform: "translateY(-50%)" }}>אין כתוביות על הציר</Typography>}
        </Box>
      </Box>
      <Box data-testid="mobile-timing-playhead" aria-hidden sx={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, bgcolor: "primary.main", transform: "translateX(-1px)", zIndex: 3, pointerEvents: "none" }}>
        <Box sx={{ width: 11, height: 11, borderRadius: "50%", bgcolor: "primary.main", transform: "translate(-4.5px, 0)" }} />
      </Box>
    </Box>
  </Stack>;
}

function Handle({ label, edge, onDown, onMove, onUp }: {
  label: string;
  edge: "start" | "end";
  onDown: (event: ReactPointerEvent) => void;
  onMove: (event: ReactPointerEvent) => void;
  onUp: (event: ReactPointerEvent) => void;
}) {
  return <Box data-timing-handle role="slider" aria-label={label} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
    sx={{ position: "absolute", top: "50%", [edge === "start" ? "left" : "right"]: 0, transform: "translateY(-50%)", width: "min(36px, 50%)", height: 72, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", zIndex: 2 }}>
    <Box sx={{ width: 6, height: 36, borderRadius: 99, bgcolor: "primary.main" }} />
  </Box>;
}
