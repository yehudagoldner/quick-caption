import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Alert, Box, Button, Checkbox, IconButton, Stack, Typography } from "@mui/material";
import { SwapHorizRounded, PauseRounded, PlayArrowRounded, RedoRounded, UndoRounded, EditRounded } from "@mui/icons-material";
import type { Segment, Word } from "../types";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { formatTimecode } from "../utils/timecode";
import { mobileTimelineWindowSeconds, placeMobileCaption } from "../../timelineEditing.js";
import { CompactTimelineZoom } from "./CompactTimelineZoom";

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds + 1e-4));
  const tenths = Math.round((Math.max(0, seconds) - whole) * 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}${tenths > 0 && tenths < 10 ? `.${tenths}` : ""}`;
}

type DragMode = "move" | "start" | "end";
type Preview = Segment[];
type Drag = { pointerId: number; originX: number; lastX: number; originScroll: number; edgeSince: number | null; mode: DragMode; segment: Segment };

const LONG_PRESS_MS = 350;
const PRESS_SLOP_PX = 8;
const EDGE_ZONE_PX = 32;
const EDGE_DWELL_MS = 300;
const CARD_CONTROLS = "[data-timing-handle], [data-word-timing-button], [data-caption-checkbox]";

export function MobileTimingTimeline({
  segments, words = [], disabled, duration, currentTime = 0, mediaUrl,
  selectedSegmentId, onSegmentSelect, onRequestTimeChange, onSegmentsChange,
  isPlaying, onPlayPause, onUndo, onRedo, canUndo, canRedo, onEditCaption,
  checkedIds, onToggleChecked,
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
  onEditCaption: (id: Segment["id"]) => void;
  checkedIds: Segment["id"][];
  onToggleChecked: (id: Segment["id"]) => void;
}) {
  const { preferences } = useEditorPreferences();
  const fps = preferences.fps;
  const selecting = checkedIds.length > 0;
  const total = duration && Number.isFinite(duration) && duration > 0 ? duration : Math.max(1, ...segments.map(segment => segment.end), 1);
  const time = Math.max(0, Math.min(total, currentTime ?? 0));
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const programmatic = useRef(false);
  const fromScroll = useRef<{ time: number; at: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pressRef = useRef<{ pointerId: number; x: number; y: number; lastX: number; timer: number } | null>(null);
  const suppressClickRef = useRef(false);
  const frameRef = useRef(0);
  const pinchingRef = useRef(false);
  const previewRef = useRef<Preview | null>(null);
  const [width, setWidth] = useState(0);
  const [manualWindow, setManualWindow] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragging, setDragging] = useState<{ id: Segment["id"]; mode: DragMode } | null>(null);
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
  const latest = useRef({ segments, words, pps, total, fps, onSegmentsChange, onRequestTimeChange, windowSeconds, selectedSegmentId });
  latest.current = { segments, words, pps, total, fps, onSegmentsChange, onRequestTimeChange, windowSeconds, selectedSegmentId };

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
      if (event.touches.length < 2) return;
      event.preventDefault();
      pinch = { distance: Math.max(1, distance(event.touches)), window: latest.current.windowSeconds };
      pinchingRef.current = true;
      fromScroll.current = null;
      // A second finger turns a handle drag into zoom, without saving its preview.
      if (pressRef.current) window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      dragRef.current = null;
      previewRef.current = null;
      setPreview(null);
      setDragging(null);
    };
    const move = (event: TouchEvent) => {
      if (!pinch) {
        // A long-pressed caption owns the gesture; the track must not pan underneath it.
        if (dragRef.current && event.cancelable) event.preventDefault();
        return;
      }
      if (event.touches.length < 2) return;
      event.preventDefault();
      const next = pinch.window / (Math.max(1, distance(event.touches)) / pinch.distance);
      setManualWindow(Math.min(latest.current.total, Math.max(0.5, next)));
    };
    const end = (event: TouchEvent) => {
      if (pinch) event.preventDefault();
      if (event.touches.length < 2) { pinch = null; pinchingRef.current = false; }
    };
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", end, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, []);
  useEffect(() => () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    cancelAnimationFrame(frameRef.current);
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
    if (pinchingRef.current) return;
    const next = Math.max(0, Math.min(latest.current.total, el.scrollLeft / latest.current.pps));
    fromScroll.current = { time: next, at: performance.now() };
    latest.current.onRequestTimeChange(next);
  };

  const showPreview = (next: Preview | null) => { previewRef.current = next; setPreview(next); };
  const updatePreview = () => {
    const drag = dragRef.current;
    if (!drag || latest.current.pps <= 0) return;
    const scrolled = (scrollerRef.current?.scrollLeft ?? drag.originScroll) - drag.originScroll;
    const delta = (drag.lastX - drag.originX + scrolled) / latest.current.pps;
    showPreview(placeMobileCaption(drag.segment, latest.current.segments, latest.current.total, delta, drag.mode, latest.current.fps));
  };
  // Holding a drag at the track border keeps scrolling, so edits can reach off-screen time.
  // Passing through the border briefly does not scroll.
  const autoScroll = () => {
    frameRef.current = 0;
    const drag = dragRef.current;
    const el = scrollerRef.current;
    if (!drag || !el) return;
    const rect = el.getBoundingClientRect();
    const depth = drag.lastX < rect.left + EDGE_ZONE_PX ? drag.lastX - rect.left - EDGE_ZONE_PX
      : drag.lastX > rect.right - EDGE_ZONE_PX ? drag.lastX - rect.right + EDGE_ZONE_PX : 0;
    const now = performance.now();
    if (!depth) drag.edgeSince = null;
    else if (drag.edgeSince == null) drag.edgeSince = now;
    if (depth && now - (drag.edgeSince ?? now) >= EDGE_DWELL_MS) {
      const before = el.scrollLeft;
      el.scrollLeft = before + Math.sign(depth) * Math.max(1, Math.round(Math.min(EDGE_ZONE_PX, Math.abs(depth)) / 3));
      if (el.scrollLeft !== before) updatePreview();
    }
    frameRef.current = requestAnimationFrame(autoScroll);
  };
  const cancelPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };
  const startDrag = (target: Element, pointerId: number, clientX: number, segment: Segment, mode: DragMode) => {
    dragRef.current = { pointerId, originX: clientX, lastX: clientX, originScroll: scrollerRef.current?.scrollLeft ?? 0, edgeSince: null, mode, segment: { ...segment } };
    setDragging({ id: segment.id, mode });
    // Pin the caption so seeking during auto-scroll cannot move the focus to a neighbour.
    if (segment.id !== latest.current.selectedSegmentId) onSegmentSelect(segment.id);
    try { target.setPointerCapture(pointerId); } catch { /* The pointer is already owned by the gesture. */ }
    if (!frameRef.current) frameRef.current = requestAnimationFrame(autoScroll);
  };
  const beginDrag = (event: ReactPointerEvent, segment: Segment, mode: DragMode) => {
    if (disabled || pinchingRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    cancelPress();
    startDrag(event.currentTarget, event.pointerId, event.clientX, segment, mode);
  };
  // A short touch on a card still pans the track; holding it still picks the caption up.
  const pressCard = (event: ReactPointerEvent<HTMLElement>, segment: Segment) => {
    suppressClickRef.current = false;
    if (disabled || isPlaying || selecting || pinchingRef.current || dragRef.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest(CARD_CONTROLS)) return;
    cancelPress();
    const target = event.currentTarget;
    const { pointerId } = event;
    const timer = window.setTimeout(() => {
      const press = pressRef.current;
      pressRef.current = null;
      if (!press || pinchingRef.current) return;
      suppressClickRef.current = true;
      startDrag(target, pointerId, press.lastX, segment, "move");
      navigator.vibrate?.(15);
    }, LONG_PRESS_MS);
    pressRef.current = { pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, timer };
  };
  const moveDrag = (event: ReactPointerEvent) => {
    const press = pressRef.current;
    if (press && event.pointerId === press.pointerId) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS_SLOP_PX) cancelPress();
      else press.lastX = event.clientX;
    }
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.lastX = event.clientX;
    updatePreview();
  };
  const endDrag = (event: ReactPointerEvent) => {
    if (pressRef.current?.pointerId === event.pointerId) cancelPress();
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    setDragging(null);
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
  const draggedSegment = dragging ? view.find(segment => segment.id === dragging.id) : undefined;
  const readout = !dragging || !draggedSegment ? null
    : dragging.mode === "move" ? `${formatTimecode(draggedSegment.start, fps)} – ${formatTimecode(draggedSegment.end, fps)}`
    : `${dragging.mode === "start" ? "התחלה" : "סיום"} ${formatTimecode(dragging.mode === "start" ? draggedSegment.start : draggedSegment.end, fps)} · ${(draggedSegment.end - draggedSegment.start).toFixed(1)} שנ׳`;
  const choose = (segment: Segment) => {
    if (selecting) { onToggleChecked(segment.id); return; }
    onSegmentSelect(segment.id);
    if (time < segment.start || time >= segment.end) onRequestTimeChange(segment.start);
  };

  return <Stack spacing={0.5} data-testid="mobile-timing-editor" data-window-seconds={windowSeconds.toFixed(2)} sx={{ flex: "1 1 auto", minWidth: 0, minHeight: 0, width: "100%", maxWidth: "100%", height: "100%", overflow: "hidden", userSelect: "none" }}>
    <Stack direction="row" alignItems="center" dir="ltr" sx={{ flexShrink: 0, minHeight: 40 }}>
      <IconButton aria-label={isPlaying ? "השהה" : "נגן"} disabled={selecting || disabled} onClick={onPlayPause}>{isPlaying ? <PauseRounded /> : <PlayArrowRounded />}</IconButton>
      <Button size="small" aria-label="פריים אחורה" onClick={() => onRequestTimeChange(Math.max(0, time - 1 / fps))} sx={{ minWidth: 40, px: 0.5 }}>−1F</Button>
      <Typography variant="body2" dir="ltr" data-testid="playhead-timecode" sx={{ flex: 1, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{formatTimecode(time, fps)}</Typography>
      <Button size="small" aria-label="פריים קדימה" onClick={() => onRequestTimeChange(Math.min(total, time + 1 / fps))} sx={{ minWidth: 40, px: 0.5 }}>+1F</Button>
      <IconButton size="small" aria-label="ביטול פעולה" onClick={onUndo} disabled={!canUndo || disabled || selecting}><UndoRounded /></IconButton>
      <IconButton size="small" aria-label="ביצוע חוזר" onClick={onRedo} disabled={!canRedo || disabled || selecting}><RedoRounded /></IconButton>
      <Button size="small" aria-label="התאמת זום לעריכה" aria-pressed={manualWindow == null} onClick={() => setManualWindow(null)} sx={{ minWidth: 0, px: 0.75, fontSize: 11, whiteSpace: "nowrap", color: manualWindow == null ? "primary.main" : "text.secondary" }}>
        {manualWindow == null ? "אוטומטי" : "התאם"}
      </Button>
    </Stack>
    <Box data-testid="mobile-timing-zoom-control" sx={{ width: "100%", px: 0.5, boxSizing: "border-box", flexShrink: 0 }}>
      <CompactTimelineZoom label="זום ציר התזמון" value={zoomValue} min={0} max={100} step={0.1}
        valueText={`${Number(windowSeconds.toFixed(2))} שניות בתצוגה`} disabled={zoomRange === 0}
        onChange={value => { fromScroll.current = null; setManualWindow(total / Math.exp(value / 100 * zoomRange)); }} />
    </Box>
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
            const checked = checkedIds.includes(segment.id);
            const showChrome = focused && !disabled && !isPlaying && !selecting;
            const left = pad + segment.start * pps + 2;
            const cardWidth = Math.max(8, (segment.end - segment.start) * pps - 4);
            const dragMode = dragging?.id === segment.id ? dragging.mode : null;
            const tab = Math.min(16, Math.max(8, cardWidth * 0.15));
            const reach = Math.max(0, Math.min(24, cardWidth / 2 - tab - 22));
            return <Box key={segment.id} data-testid="mobile-timing-clip" data-start={segment.start} data-end={segment.end} role="button" tabIndex={0}
              aria-label={`כתובית: ${segment.text}`} aria-pressed={selecting ? checked : focused}
              onPointerDown={event => pressCard(event, segments.find(item => item.id === segment.id) ?? segment)}
              onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
              onContextMenu={event => event.preventDefault()}
              onClick={event => {
                if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                if ((event.target as HTMLElement).closest(CARD_CONTROLS)) return;
                choose(segments.find(item => item.id === segment.id) ?? segment);
              }}
              onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(segment); } }}
              sx={{
                position: "absolute", top: 22, bottom: 8, left, width: cardWidth, borderRadius: "8px", bgcolor: checked ? "#e8f1fc" : "#fff",
                border: 1, borderColor: (selecting ? checked : focused) ? "primary.main" : "#e4e8ee", boxShadow: (selecting ? checked : focused) ? "0 0 0 1px #1976d2" : "none",
                overflow: "hidden", zIndex: focused ? 2 : 1, touchAction: "pan-x", WebkitTouchCallout: "none",
                transition: "transform 120ms ease, box-shadow 120ms ease",
                ...(dragMode === "move" && { transform: "translateY(-3px)", boxShadow: "0 0 0 1px #1976d2, 0 8px 18px rgba(25,118,210,0.35)" }),
              }}>
              <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 44, px: showChrome ? `${tab}px` : 0, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 3 }}>
              <Checkbox data-caption-checkbox checked={checked} disabled={disabled} size="small"
                slotProps={{ input: { "aria-label": `בחירת כתובית: ${segment.text}` } }}
                onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
                onChange={() => onToggleChecked(segment.id)}
                sx={{ width: "min(44px, 50%)", height: 44, p: 0, "& .MuiSvgIcon-root": { fontSize: Math.min(24, cardWidth / 2 - 2) } }} />
              {!selecting && <IconButton data-word-timing-button size="small" aria-label={`עריכת כתובית: ${segment.text}`} title="עריכת טקסט ותזמון" disabled={disabled}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); onEditCaption(segment.id); }}
                sx={{ width: "min(32px, 50%)", height: 32, p: 0, color: "primary.main", bgcolor: "#e8f1fc", "&:hover": { bgcolor: "#d7e8fc" } }}>
                <EditRounded sx={{ fontSize: Math.min(20, cardWidth / 2 - 2) }} />
              </IconButton>}
              </Box>
              <Box sx={{ height: "100%", px: showChrome ? `${tab + 6}px` : 1.5, display: "flex", flexDirection: "column", justifyContent: "center", pt: "44px", pb: showChrome ? "32px" : 0.5, overflow: "hidden" }}>
                <Typography data-testid="mobile-timing-caption-text" dir={preferences.direction} title={segment.text} sx={{ flexShrink: 0, fontSize: 13, fontWeight: 600, lineHeight: 1.3, maxHeight: "2.6em", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{segment.text}</Typography>
              </Box>
              {(showChrome || dragMode) && <>
                <Handle label="הזזת התחלה" edge="start" width={tab} reach={reach} active={dragMode === "start"}
                  valueMax={Math.round(total * 1000)} valueNow={Math.round(segment.start * 1000)} onDown={event => beginDrag(event, segment, "start")} />
                <Box data-timing-handle role="slider" aria-label="הזזת המקטע" title="גררו כאן, או החזיקו את הכתובית וגררו"
                  aria-valuemin={0} aria-valuemax={Math.round(total * 1000)} aria-valuenow={Math.round(segment.start * 1000)}
                  onPointerDown={event => beginDrag(event, segment, "move")}
                  sx={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", minWidth: 44, height: 28, px: 1, boxSizing: "border-box", gap: 0.5,
                    display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", borderRadius: 99, cursor: "grab", zIndex: 3,
                    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                    color: dragMode === "move" ? "#fff" : "primary.main", bgcolor: dragMode === "move" ? "primary.main" : "#e8f1fc" }}>
                  <SwapHorizRounded sx={{ fontSize: 18 }} />
                  {cardWidth - 2 * tab >= 110 && "הזזה"}
                </Box>
                <Handle label="הזזת סיום" edge="end" width={tab} reach={reach} active={dragMode === "end"}
                  valueMax={Math.round(total * 1000)} valueNow={Math.round(segment.end * 1000)} onDown={event => beginDrag(event, segment, "end")} />
              </>}
            </Box>;
          })}
          {segments.length === 0 && <Typography color="text.secondary" sx={{ position: "absolute", top: "50%", left: pad, transform: "translateY(-50%)" }}>אין כתוביות על הציר</Typography>}
        </Box>
      </Box>
      <Box data-testid="mobile-timing-playhead" aria-hidden sx={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, bgcolor: "primary.main", transform: "translateX(-1px)", zIndex: 3, pointerEvents: "none" }}>
        <Box sx={{ width: 11, height: 11, borderRadius: "50%", bgcolor: "primary.main", transform: "translate(-4.5px, 0)" }} />
      </Box>
      {readout && <Box role="status" data-testid="mobile-timing-readout" dir={dragging?.mode === "move" ? "ltr" : "rtl"} sx={{
        position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)", zIndex: 6, px: 1.25, py: 0.25, borderRadius: 99,
        bgcolor: "primary.main", color: "#fff", fontSize: 12, fontWeight: 600, lineHeight: 1.4, whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums", pointerEvents: "none", boxShadow: 2,
      }}>{readout}</Box>}
    </Box>
  </Stack>;
}

function Handle({ label, edge, width, reach, active, valueNow, valueMax, onDown }: {
  label: string;
  edge: "start" | "end";
  width: number;
  reach: number;
  active: boolean;
  valueNow: number;
  valueMax: number;
  onDown: (event: ReactPointerEvent) => void;
}) {
  const side = edge === "start" ? "left" : "right";
  return <Box data-timing-handle role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={valueMax} aria-valuenow={valueNow} onPointerDown={onDown}
    sx={{ position: "absolute", top: 0, bottom: 0, [side]: 0, width, display: "flex", alignItems: "center", justifyContent: "center",
      bgcolor: active ? "primary.dark" : "primary.main", borderRadius: edge === "start" ? "7px 0 0 7px" : "0 7px 7px 0",
      touchAction: "none", cursor: "ew-resize", zIndex: 4 }}>
    <Box sx={{ width: Math.max(4, width - 10), height: 20, boxSizing: "border-box", borderLeft: "2px solid #fff", borderRight: "2px solid #fff", pointerEvents: "none" }} />
    {/* Widens the touch target into the card, below its top controls. */}
    {reach > 0 && <Box sx={{ position: "absolute", top: 44, bottom: 0, [side]: "100%", width: reach }} />}
  </Box>;
}
