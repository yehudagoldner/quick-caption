import { useMemo } from "react";
import { Box, Button, Typography } from "@mui/material";
import type { useAudioWaveform } from "../hooks/useAudioWaveform";

// Render only the visible pixels of the full-duration timeline action. Its
// parent shares the caption row's ruler, scroll position, zoom and playhead.
export function AudioWaveform({ waveform, pixelsPerSecond, scrollLeft, viewportWidth, duration, currentTime, fps, onSeek }: {
  waveform: ReturnType<typeof useAudioWaveform>; pixelsPerSecond: number; scrollLeft: number; viewportWidth: number;
  duration: number; currentTime: number; fps: number; onSeek: (time: number) => void;
}) {
  const left = Math.max(0, scrollLeft - 20);
  const width = Math.max(1, Math.min(viewportWidth, duration * pixelsPerSecond - left));
  const path = useMemo(() => {
    const data = waveform.data;
    if (!data?.peaks.length) return "";
    const binsPerSecond = data.peaks.length / data.duration;
    const strokes: string[] = [];
    for (let x = 0; x < Math.ceil(width); x++) {
      const from = Math.floor((left + x) / pixelsPerSecond * binsPerSecond);
      const to = Math.min(data.peaks.length, Math.max(from + 1, Math.ceil((left + x + 1) / pixelsPerSecond * binsPerSecond)));
      let peak = 0;
      for (let i = from; i < to; i++) peak = Math.max(peak, data.peaks[i]);
      if (peak > 0) strokes.push(`M${x},${16 - peak * 15}v${Math.max(.5, peak * 30)}`);
    }
    return strokes.join(" ");
  }, [waveform.data, left, width, pixelsPerSecond]);
  return <Box data-testid="audio-waveform-track" sx={{ position: "absolute", left, width, height: 36, bgcolor: "#191b1d", display: "flex", alignItems: "center" }}>
    {waveform.status === "ready" ? <Box component="svg" data-testid="audio-waveform" role="slider" aria-label="מיקום בגל הקול"
      aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} tabIndex={0}
      viewBox={`0 0 ${width} 32`} preserveAspectRatio="none"
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); event.stopPropagation();
          onSeek(Math.max(0, Math.min(duration, currentTime + (event.key === "ArrowRight" ? 1 : -1) / fps)));
        }
      }}
      sx={{ width: "100%", height: 32, display: "block", cursor: "crosshair", outlineOffset: -2 }}>
      <line x1="0" x2={width} y1="16" y2="16" stroke="#3d91c8" strokeOpacity=".35" />
      <path d={path} stroke="#64b5f6" strokeWidth="1" />
    </Box> : <Box dir="rtl" sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, minWidth: 0 }}>
      <Typography variant="caption" noWrap sx={{ color: "#b9c7d5" }} title={waveform.status === "error" ? "הפענוח המקומי מוגבל ל־100MB ול־20 דקות ותלוי בפורמט; אפשר להמשיך לערוך ולנגן כרגיל." : undefined}>
        {waveform.status === "error" ? "גל הקול אינו זמין לקובץ הזה" : waveform.status === "loading" ? "טוען גל קול…" : "גל הקול יוצג לאחר טעינת המדיה"}
      </Typography>
      {waveform.status === "error" && <Button size="small" onClick={() => void waveform.retry()}>נסו שוב</Button>}
    </Box>}
  </Box>;
}
