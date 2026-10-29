import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, IconButton } from "@mui/material";
import { CloseRounded } from "@mui/icons-material";

export function AudioWaveform({ mediaUrl, duration, currentTime, onSeek }: {
  mediaUrl: string | null; duration: number; currentTime: number; onSeek: (time: number) => void;
}) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [visible, setVisible] = useState(true);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const request = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const waveformPath = useMemo(() => peaks.map((v, i) => `M${i},${32 - v * 30}v${Math.max(1, v * 60)}`).join(" "), [peaks]);
  const load = useCallback(async () => {
    if (!mediaUrl) return;
    const id = ++request.current;
    abort.current?.abort(); abort.current = new AbortController();
    setStatus("loading");
    let audio: AudioContext | undefined;
    try {
      // Guard memory use for large recordings when decoding automatically.
      if (duration > 1200) throw new Error("Recording too long for local decoding");
      const response = await fetch(mediaUrl, { signal: abort.current.signal });
      if (!response.ok) throw new Error("Media unavailable");
      if (Number(response.headers.get("content-length")) > 100 * 1024 * 1024) throw new Error("Media too large for local decoding");
      const blob = await response.blob();
      if (blob.size > 100 * 1024 * 1024) throw new Error("Media too large for local decoding");
      audio = new AudioContext();
      const decoded = await audio.decodeAudioData(await blob.arrayBuffer());
      const samples = decoded.getChannelData(0);
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
      const count = 1600, stride = Math.max(1, Math.floor(samples.length / 8_000_000));
      const result = Array.from({ length: count }, (_, i) => {
        let peak = 0;
        for (let j = Math.floor(i * samples.length / count); j < Math.floor((i + 1) * samples.length / count); j += stride) {
          for (const channel of channels) peak = Math.max(peak, Math.abs(channel[j]));
        }
        return peak;
      });
      if (id === request.current) { setPeaks(result); setStatus("ready"); }
    } catch { if (id === request.current) setStatus("error"); }
    finally { if (audio) await audio.close(); }
  }, [mediaUrl, duration]);
  useEffect(() => {
    setPeaks([]);
    setStatus("idle");
    void load();
    return () => { request.current++; abort.current?.abort(); };
  }, [load]);
  const closeButton = <IconButton size="small" aria-label="סגור גל קול" title="סגור גל קול" onClick={() => setVisible(false)} sx={{ width: 32, height: 32, flexShrink: 0 }}><CloseRounded fontSize="small" /></IconButton>;
  if (!visible) return <Box><Button size="small" onClick={() => setVisible(true)}>הצג גל קול</Button></Box>;
  if (status !== "ready") return <Box>
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Button size="small" disabled={!mediaUrl || status === "loading"} onClick={load}>{status === "loading" ? "טוען גל קול…" : "הצג גל קול"}</Button>
      {closeButton}
    </Box>
    {status === "error" && <Alert severity="info">גל הקול אינו זמין לקובץ הזה. הפענוח המקומי מוגבל ל־100MB ול־20 דקות ותלוי בפורמט; אפשר להמשיך לערוך ולנגן כרגיל.</Alert>}
  </Box>;
  return <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
    <Box component="svg" role="slider" aria-label="מיקום בגל הקול" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} tabIndex={0}
      viewBox="0 0 1600 64" preserveAspectRatio="none" data-testid="audio-waveform"
      onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); onSeek((event.clientX - rect.left) / rect.width * duration); }}
      onKeyDown={e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onSeek(Math.max(0, Math.min(duration, currentTime + (e.key === "ArrowRight" ? .1 : -.1)))); } }}
      sx={{ flex: 1, minWidth: 0, height: 32, display: "block", bgcolor: "action.hover", cursor: "crosshair", borderRadius: 1 }}>
      <path d={waveformPath} stroke="#3d91c8" strokeWidth="1" />
      <line x1={currentTime / duration * 1600} x2={currentTime / duration * 1600} y1="0" y2="64" stroke="#e65100" strokeWidth="3" />
    </Box>
    {closeButton}
  </Box>;
}
