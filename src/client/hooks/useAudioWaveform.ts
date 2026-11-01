import { useCallback, useEffect, useRef, useState } from "react";

export function useAudioWaveform(mediaUrl: string | null, duration: number) {
  const [data, setData] = useState<{ peaks: Float32Array; duration: number } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const request = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!mediaUrl) return;
    const id = ++request.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStatus("loading");
    let audio: AudioContext | undefined;
    try {
      if (duration > 1200) throw new Error("Recording too long for local decoding");
      const response = await fetch(mediaUrl, { signal: controller.signal });
      if (!response.ok) throw new Error("Media unavailable");
      if (Number(response.headers.get("content-length")) > 100 * 1024 * 1024) throw new Error("Media too large for local decoding");
      const blob = await response.blob();
      if (blob.size > 100 * 1024 * 1024) throw new Error("Media too large for local decoding");
      if (id !== request.current) return;
      audio = new AudioContext();
      const decoded = await audio.decodeAudioData(await blob.arrayBuffer());
      if (id !== request.current) return;
      if (decoded.duration > 1200) throw new Error("Recording too long for local decoding");
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
      // Five-millisecond bins retain speech detail when zooming into the track.
      const count = Math.min(decoded.length, Math.ceil(decoded.duration * 200));
      const stride = Math.max(1, Math.floor(decoded.length / 8_000_000));
      const peaks = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        for (let j = Math.floor(i * decoded.length / count); j < Math.floor((i + 1) * decoded.length / count); j += stride) {
          for (const channel of channels) peaks[i] = Math.max(peaks[i], Math.abs(channel[j]));
        }
      }
      if (id === request.current) { setData({ peaks, duration: decoded.duration }); setStatus("ready"); }
    } catch { if (id === request.current) setStatus("error"); }
    finally { if (audio) await audio.close(); }
  }, [mediaUrl, duration]);
  useEffect(() => {
    setData(null); setStatus("idle");
    void load();
    return () => { request.current++; abort.current?.abort(); };
  }, [load]);
  return { data, status, retry: load };
}
