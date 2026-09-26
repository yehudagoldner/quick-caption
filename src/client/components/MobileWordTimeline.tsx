import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Box, Button, IconButton, Stack, Typography } from "@mui/material";
import { RedoRounded, UndoRounded } from "@mui/icons-material";
import type { Segment, Word } from "../types";
import { placeMobileWord } from "../../timelineEditing.js";
import { formatTimecode } from "../utils/timecode";
import { useActiveWord } from "../hooks/useActiveWord";
import { CompactTimelineZoom } from "./CompactTimelineZoom";

type DragMode = "move" | "start" | "end";
export function MobileWordTimeline({ segment, words, fps, currentTime, activeWordEnabled, disabled, saving,
  onChange, onSeek, onInteract, onUndo, onRedo, canUndo, canRedo,
}: {
  segment: Segment; words: Word[]; fps: number; currentTime: number; activeWordEnabled: boolean;
  disabled: boolean; saving: boolean; onChange: (words: Word[]) => void; onSeek: (time: number) => void;
  onInteract: () => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const zoomAnchor = useRef<{ seconds: number; x: number } | null>(null);
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState<Word[] | null>(null);
  const drag = useRef<{ id: number; index: number; mode: DragMode; x: number; scroll: number; words: Word[]; moved: boolean; next: Word[] } | null>(null);
  const suppressClick = useRef(false);
  const duration = Math.max(.001, segment.end - segment.start);
  const trackWidth = Math.max(width - 24, words.length * 90, duration * 100) * zoom;
  const pps = trackWidth / duration;
  const view = preview ?? words;
  const chosen = view[selected];
  const activeWord = useActiveWord({ words: view, currentTime, enabled: activeWordEnabled });
  const changeZoom = (next: number) => {
    const el = scroller.current;
    if (el) {
      const playheadX = 12 + (currentTime - segment.start) * pps - el.scrollLeft;
      const x = playheadX >= 0 && playheadX <= el.clientWidth ? playheadX : el.clientWidth / 2;
      zoomAnchor.current = { seconds: (el.scrollLeft + x - 12) / pps, x };
    }
    setZoom(next);
  };
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    if (anchor && scroller.current) scroller.current.scrollLeft = 12 + anchor.seconds * pps - anchor.x;
    zoomAnchor.current = null;
  }, [pps]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (selected >= words.length) setSelected(0); }, [words.length, selected]);
  const seek = (index: number) => {
    const word = words[index];
    if (!word) return;
    setSelected(index);
    onSeek(word.start + Math.min(.001, (word.end - word.start) / 2));
  };
  const begin = (event: ReactPointerEvent, index: number, mode: DragMode) => {
    if (disabled || event.button !== 0 || drag.current) return;
    onInteract();
    setSelected(index);
    suppressClick.current = false;
    drag.current = { id: event.pointerId, index, mode, x: event.clientX, scroll: scroller.current?.scrollLeft ?? 0, words, moved: false, next: words };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const pixels = event.clientX - current.x + (scroller.current?.scrollLeft ?? 0) - current.scroll;
    if (!current.moved && Math.abs(pixels) < 4) return;
    current.moved = true;
    current.next = placeMobileWord(current.words, current.index, segment, pixels / pps, current.mode, fps);
    setPreview(current.next);
  };
  const end = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    setPreview(null);
    suppressClick.current = current.moved;
    if (event.type === "pointercancel" || event.type === "lostpointercapture") return;
    if (current.next !== current.words) onChange(current.next);
  };
  const nudge = (delta: number, mode: DragMode = "move") => {
    if (disabled || !chosen) return;
    onInteract();
    const next = placeMobileWord(words, selected, segment, delta, mode, fps);
    if (next !== words) onChange(next);
  };
  const step = [.1, .25, .5, 1, 2, 5, 10].find(value => value * pps >= 50) ?? 10;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, index) => index * step);
  const pointerProps = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end };

  return <Stack data-testid="mobile-word-timeline" spacing={0.5} sx={{ minWidth: 0, flexShrink: 0 }}>
    <Stack direction="row" alignItems="center" gap={0.25}>
      <Typography variant="body2" fontWeight={600} sx={{ flex: 1, fontSize: 13, whiteSpace: "nowrap" }}>תזמון מילים</Typography>
      <Typography variant="caption" color="text.secondary" role="status" sx={{ fontSize: 10, whiteSpace: "nowrap" }}>{saving ? "שומר..." : "שמירה אוטומטית"}</Typography>
      <IconButton size="small" aria-label="ביטול תזמון מילה" disabled={disabled || !canUndo} onClick={onUndo}><UndoRounded fontSize="small" /></IconButton>
      <IconButton size="small" aria-label="ביצוע חוזר של תזמון מילה" disabled={disabled || !canRedo} onClick={onRedo}><RedoRounded fontSize="small" /></IconButton>
      <Box sx={{ width: 72, flexShrink: 0 }}>
        <CompactTimelineZoom label="זום ציר המילים" value={zoom} min={1} max={4} step={0.01}
          valueText={`פי ${Number(zoom.toFixed(2))}`} onChange={changeZoom} />
      </Box>
    </Stack>
    <Typography variant="caption" color="text.secondary">גררו מילה או את קצותיה, ללא חפיפה למילים אחרות. החליקו על הסרגל לגלילה.</Typography>
    <Box ref={scroller} data-testid="mobile-word-scroll" aria-label="מילים במקטע" dir="ltr" sx={{ overflowX: "auto", overflowY: "hidden", border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "#f3f6fa", touchAction: "pan-x", overscrollBehaviorX: "contain" }}>
      <Box data-testid="mobile-word-track" sx={{ position: "relative", height: 112, width: trackWidth + 24, userSelect: "none" }} onClick={event => {
        if ((event.target as HTMLElement).closest("[data-word-control]")) return;
        onInteract();
        const x = event.clientX - event.currentTarget.getBoundingClientRect().left - 12;
        onSeek(Math.min(segment.end, Math.max(segment.start, segment.start + x / pps)));
      }}>
        {ticks.map(tick => <Box key={tick} sx={{ position: "absolute", left: 12 + tick * pps, top: 0, bottom: 0, borderLeft: "1px solid #dce3ec", pointerEvents: "none" }}>
          <Typography sx={{ fontSize: 10, color: "text.secondary", pl: .5 }}>{Number(tick.toFixed(2))}s</Typography>
        </Box>)}
        <Box sx={{ position: "absolute", right: 12, top: 0, bottom: 0, borderLeft: "2px solid #90a4ae", pointerEvents: "none" }} />
        {view.map((word, index) => {
          const left = 12 + (word.start - segment.start) * pps;
          const right = 12 + (word.end - segment.start) * pps;
          const focused = selected === index;
          const active = activeWord === word;
          return <Box key={index}>
            <Button data-word-control data-testid="mobile-word-clip" data-start={word.start} data-end={word.end} aria-label={word.word} aria-pressed={active} title={word.word}
              onPointerDown={event => begin(event, index, "move")} {...pointerProps}
              onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } seek(index); }}
              onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setSelected(index); const next = placeMobileWord(words, index, segment, (event.key === "ArrowRight" ? 1 : -1) / fps, "move", fps); if (!disabled && next !== words) { onInteract(); onChange(next); } } }}
              sx={{ position: "absolute", top: 26, left, width: Math.max(2, right - left), minWidth: 0, height: 44, px: .5, overflow: "hidden", whiteSpace: "nowrap", touchAction: disabled ? "pan-x" : "none", borderRadius: 1,
                bgcolor: active ? "primary.main" : "#9b5700", color: "#fff", outline: focused ? "2px solid #1976d2" : "none", outlineOffset: 2, "&:hover": { bgcolor: active ? "primary.dark" : "#7a4500" } }}>
              <Box component="span" dir="auto" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>{word.word}</Box>
            </Button>
            {focused && (["start", "end"] as const).map(edge => <Box key={edge} data-word-control role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
              aria-label={edge === "start" ? "תחילת המילה" : "סיום המילה"} aria-valuemin={segment.start} aria-valuemax={segment.end} aria-valuenow={word[edge]} aria-valuetext={formatTimecode(word[edge], fps)}
              onPointerDown={event => begin(event, index, edge)} {...pointerProps}
              onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); nudge((event.key === "ArrowRight" ? 1 : -1) / fps, edge); } }}
              sx={{ position: "absolute", left: (edge === "start" ? left : right) - 12, top: 70, width: 24, height: 40, touchAction: "none", display: "flex", justifyContent: "center", alignItems: "center", color: "primary.main", cursor: "ew-resize" }}>
              <Box sx={{ width: 8, height: 24, borderRadius: 99, bgcolor: disabled ? "action.disabled" : "primary.main" }} />
            </Box>)}
          </Box>;
        })}
        {currentTime >= segment.start && currentTime <= segment.end && <Box sx={{ position: "absolute", top: 16, bottom: 40, left: 12 + (currentTime - segment.start) * pps, width: 2, bgcolor: "#e53935", pointerEvents: "none" }} />}
      </Box>
    </Box>
    <Stack direction="row" dir="ltr" alignItems="center" justifyContent="space-between" gap={0.5}>
      <Button size="small" aria-label="הזזת מילה פריים אחורה" disabled={disabled || !chosen} onClick={() => nudge(-1 / fps)} sx={{ minWidth: 40 }} dir="ltr">−1F</Button>
      <Typography variant="caption" dir="ltr" sx={{ fontVariantNumeric: "tabular-nums", fontSize: 11 }}>{chosen ? `${formatTimecode(chosen.start, fps)} – ${formatTimecode(chosen.end, fps)}` : ""}</Typography>
      <Button size="small" aria-label="הזזת מילה פריים קדימה" disabled={disabled || !chosen} onClick={() => nudge(1 / fps)} sx={{ minWidth: 40 }} dir="ltr">+1F</Button>
    </Stack>
  </Stack>;
}
