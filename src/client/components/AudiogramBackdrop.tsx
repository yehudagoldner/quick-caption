import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { AUDIOGRAM_WAVE, type AudiogramSettings } from "../../audiogram.js";

// The export draws the real waveform with FFmpeg. Routing the player through
// Web Audio could silence media without CORS, so the preview animates a stand-in.
function drawWave(canvas: HTMLCanvasElement, color: string, time: number) {
  const { width, height } = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = color;
  const middle = canvas.height / 2, envelope = .55 + .45 * Math.sin(time * 2.1) ** 2;
  const step = Math.max(1, Math.round(2 * ratio));
  for (let x = 0; x < canvas.width; x += step) {
    const column = x / ratio;
    const amplitude = middle * envelope * (.2 + .8 * Math.abs(Math.sin(column * .09 + time * 13) * Math.sin(column * .023 - time * 5.3)));
    context.fillRect(x, middle - amplitude, step, Math.max(ratio, amplitude * 2));
  }
}

export function AudiogramBackdrop({ settings, imageUrl, currentTime }: { settings: AudiogramSettings; imageUrl: string | null; currentTime: number }) {
  const wave = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (wave.current) drawWave(wave.current, settings.waveColor, currentTime); }, [settings.waveform, settings.waveColor, currentTime]);
  return <Box data-testid="audiogram-backdrop" aria-hidden sx={{ position: "absolute", inset: 0, bgcolor: settings.background, pointerEvents: "none" }}>
    {imageUrl && <Box component="img" data-testid="audiogram-image" src={imageUrl} alt=""
      sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: settings.imageFit, display: "block" }} />}
    {settings.waveform && <Box component="canvas" ref={wave} data-testid="audiogram-wave"
      sx={{ position: "absolute", left: 0, width: "100%", top: `${AUDIOGRAM_WAVE.topPercent}%`, height: `${AUDIOGRAM_WAVE.heightPercent}%`, display: "block" }} />}
  </Box>;
}
