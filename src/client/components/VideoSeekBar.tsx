import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Box } from "@mui/material";
import { useVideoPlayer } from "./VideoPlayer";
import { formatTimecode } from "../utils/timecode";

type Props = {
  currentTime: number;
  duration: number;
  fps: number;
  mediaUrl: string | null;
  onSeek: (time: number) => void;
  compact?: boolean;
  allowPageScroll?: boolean;
};

// Keep the thumb under the pointer while decoding catches up. Preview seeks are
// limited to 10 per second; release always applies the exact final position.
export function VideoSeekBar({ currentTime, duration, fps, mediaUrl, onSeek, compact, allowPageScroll = false }: Props) {
  const player = useVideoPlayer();
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{ id: number; time: number; player: HTMLVideoElement | null; resume: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeek = useRef(-Infinity);
  const latest = useRef({ onSeek, duration, fps });
  latest.current = { onSeek, duration, fps };
  const cancelPending = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    drag.current = null;
    setPreview(null);
    lastSeek.current = -Infinity;
    return () => { cancelPending(); drag.current = null; };
  }, [mediaUrl, player]);
  const bounded = (time: number) => Math.max(0, Math.min(latest.current.duration, time));
  const timeAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const seconds = bounded((event.clientX - rect.left) / Math.max(1, rect.width) * latest.current.duration);
    return bounded(Math.round(seconds * latest.current.fps) / latest.current.fps);
  };
  const apply = (time: number) => {
    lastSeek.current = performance.now();
    latest.current.onSeek(time);
  };
  const flushPreview = () => {
    timer.current = null;
    if (!drag.current) return;
    // Let an in-flight decode finish instead of repeatedly restarting it.
    if (drag.current.player?.seeking) {
      timer.current = setTimeout(flushPreview, 25);
      return;
    }
    apply(drag.current.time);
  };
  const move = (time: number) => {
    if (!drag.current) return;
    drag.current.time = time;
    setPreview(time);
    if (timer.current !== null) return;
    const remaining = 100 - (performance.now() - lastSeek.current);
    if (remaining <= 0 && !drag.current.player?.seeking) apply(time);
    else timer.current = setTimeout(flushPreview, Math.max(25, remaining));
  };
  const finish = (event?: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || (event && event.pointerId !== active.id)) return;
    cancelPending();
    // Cancellation/blur commits the last preview without leaving a stuck drag.
    const time = event?.type === "pointerup" ? timeAt(event) : active.time;
    drag.current = null;
    apply(time);
    setPreview(null);
    if (event?.currentTarget.hasPointerCapture(active.id)) event.currentTarget.releasePointerCapture(active.id);
    if (active.resume && active.player?.isConnected && time < latest.current.duration) {
      void active.player.play().catch(() => { /* Source changes can interrupt play. */ });
    }
  };
  const time = Math.max(0, Math.min(duration, preview ?? currentTime));
  const percent = duration > 0 ? time / duration * 100 : 0;
  return <Box
    dir="ltr" role="slider" tabIndex={0} aria-label="מיקום בהקלטה"
    aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time}
    aria-valuetext={formatTimecode(time, fps)}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      const resume = !!player && !player.paused && !player.ended;
      if (resume) player.pause();
      drag.current = { id: event.pointerId, time: timeAt(event), player, resume };
      event.currentTarget.setPointerCapture(event.pointerId);
      move(timeAt(event));
    }}
    onPointerMove={event => {
      if (drag.current?.id !== event.pointerId) return;
      event.preventDefault();
      move(timeAt(event));
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onBlur={() => finish()}
    onKeyDown={event => {
      if (drag.current || event.ctrlKey || event.metaKey || event.altKey) return;
      const frame = (event.shiftKey ? 10 : 1) / fps;
      const next = event.key === "Home" ? 0 : event.key === "End" ? duration
        : event.key === "ArrowLeft" || event.key === "ArrowDown" ? time - frame
        : event.key === "ArrowRight" || event.key === "ArrowUp" ? time + frame
        : event.key === "PageDown" ? time - 10 : event.key === "PageUp" ? time + 10 : null;
      if (next === null) return;
      event.preventDefault();
      latest.current.onSeek(bounded(next));
    }}
    sx={{ width: "100%", height: compact ? 28 : 40, position: "relative", display: "flex", alignItems: "center",
      flexShrink: 0, cursor: "pointer", touchAction: allowPageScroll ? "pan-y" : "none", userSelect: "none", outline: "none",
      "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2, borderRadius: 1 } }}
  >
    <Box sx={{ position: "relative", width: "100%", height: compact ? 6 : 4, bgcolor: compact ? "#e8edf3" : "primary.main", opacity: 1, borderRadius: 999 }}>
      {!compact && <Box sx={{ position: "absolute", inset: 0, bgcolor: "background.paper", opacity: .62, borderRadius: 999 }} />}
      <Box sx={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${percent}%`, bgcolor: "primary.main", borderRadius: 999 }} />
      <Box sx={{ position: "absolute", top: "50%", left: `${percent}%`, width: compact ? 14 : 20, height: compact ? 14 : 20,
        bgcolor: "primary.main", borderRadius: "50%", transform: "translate(-50%, -50%)", boxShadow: compact ? undefined : 1 }} />
    </Box>
  </Box>;
}
