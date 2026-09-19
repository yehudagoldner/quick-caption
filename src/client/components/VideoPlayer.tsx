import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Stack, Typography } from "@mui/material";
import type { Segment, Word } from "../types";
import { useActiveWord } from "../hooks/useActiveWord";

type VideoPlayerProps = {
  mediaUrl: string | null;
  activeSegmentText: string | null;
  activeSegmentId: Segment["id"] | null;
  previewStyle: React.CSSProperties;
  words?: Word[];
  currentTime: number;
  activeWordEnabled: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (dimensions: { width: number; height: number }, duration: number) => void;
  onResize?: (dimensions: { width: number; height: number }) => void;
};

export function VideoPlayer({ mediaUrl, activeSegmentText, activeSegmentId, previewStyle, words, currentTime, activeWordEnabled, onTimeUpdate, onLoadedMetadata, onResize }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 16, height: 9 });
  const [isAudio, setIsAudio] = useState(false);
  const [error, setError] = useState(false);
  const captionWords = useMemo(() => words?.filter(w => w.segmentId === activeSegmentId) ?? [], [words, activeSegmentId]);
  const activeWord = useActiveWord({ words: captionWords, currentTime, enabled: activeWordEnabled });
  const captionParts = useMemo(() => {
    let wordIndex = 0;
    return (activeSegmentText ?? "").split(/(\s+)/).map(text => ({ text, wordIndex: text.trim() ? wordIndex++ : undefined }));
  }, [activeSegmentText]);
  const timeUpdateRef = useRef(onTimeUpdate);
  useEffect(() => { timeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const tick = () => {
      timeUpdateRef.current?.(video.currentTime);
      if (!video.paused && !video.ended) frame = requestAnimationFrame(tick);
    };
    const start = () => { cancelAnimationFrame(frame); tick(); };
    const stop = () => { cancelAnimationFrame(frame); timeUpdateRef.current?.(video.currentTime); };
    const seek = () => { if (video.paused) stop(); else start(); };
    video.addEventListener("play", start);
    video.addEventListener("pause", stop);
    video.addEventListener("ended", stop);
    video.addEventListener("seeked", seek);
    if (!video.paused) start();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("play", start); video.removeEventListener("pause", stop);
      video.removeEventListener("ended", stop); video.removeEventListener("seeked", seek);
    };
  }, [mediaUrl]);

  useEffect(() => { setError(false); setIsAudio(false); setDimensions({ width: 16, height: 9 }); }, [mediaUrl]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    (window as any).__videoPlayerRef = video;
    return () => { if ((window as any).__videoPlayerRef === video) (window as any).__videoPlayerRef = null; };
  }, [mediaUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      if (video.readyState < 1) return;
      const next = { width: video.videoWidth, height: video.videoHeight };
      setIsAudio(!next.width || !next.height);
      if (next.width && next.height) setDimensions(previous => previous.width === next.width && previous.height === next.height ? previous : next);
      onLoadedMetadata?.(next, Number.isFinite(video.duration) ? video.duration : 0);
    };
    const resize = () => {
      const rect = video.getBoundingClientRect();
      if (rect.width && rect.height) onResize?.({ width: rect.width, height: rect.height });
    };
    update(); resize();
    video.addEventListener("loadedmetadata", update);
    const observer = new ResizeObserver(resize);
    observer.observe(video);
    return () => { video.removeEventListener("loadedmetadata", update); observer.disconnect(); };
  }, [mediaUrl, onLoadedMetadata, onResize]);

  const ratio = dimensions.width / dimensions.height;
  return <Stack spacing={1} alignItems="center" sx={{ width: "100%", minWidth: 0 }}>
    {isAudio && <Typography variant="subtitle2">אודיו בלבד — תצוגה מקדימה של הכתוביות</Typography>}
    {error && <Alert severity="error">לא ניתן לנגן את המדיה. בדקו שהקובץ זמין ובפורמט שנתמך בדפדפן.</Alert>}
    <Box data-testid="media-stage" sx={{ position: "relative", bgcolor: "common.black", color: "white", borderRadius: 2, overflow: "hidden", mx: "auto",
      width: isAudio ? "100%" : `min(100%, ${Math.min(640, 500 * ratio)}px, calc(48dvh * ${ratio}))`,
      aspectRatio: isAudio ? undefined : `${dimensions.width} / ${dimensions.height}`, minHeight: isAudio ? 180 : undefined }}>
      {mediaUrl ? <>
        <Box component="video" ref={videoRef} controls playsInline preload="metadata" src={mediaUrl}
          onTimeUpdate={e => onTimeUpdate?.(e.currentTarget.currentTime)} onError={() => setError(true)}
          sx={{ width: "100%", height: isAudio ? 54 : "100%", display: "block", objectFit: "contain", ...(isAudio ? { position: "absolute", bottom: 0 } : {}) }} />
        {activeSegmentText && <Box data-testid="subtitle-overlay" sx={{ ...previewStyle, ...(isAudio ? { fontSize: 24, bottom: 75, width: "90%" } : {}) }}>
          {activeWordEnabled ? captionParts.map((part, index) => {
            const active = part.wordIndex !== undefined && activeWord?.wordIndex === part.wordIndex;
            return <span key={index} data-word-index={part.wordIndex} data-active-word={active ? "true" : undefined} style={{ color: active ? "#FFD700" : "inherit" }}>{part.text}</span>;
          }) : activeSegmentText}
        </Box>}
      </> : <Typography sx={{ p: 3 }}>אין תצוגה זמינה לקובץ הנוכחי.</Typography>}
    </Box>
    {!isAudio && <Typography variant="caption" color="text.secondary" dir="ltr">{dimensions.width} × {dimensions.height} · {ratio === 1 ? "וידאו מרובע" : ratio < 1 ? "וידאו אנכי" : "וידאו אופקי"}</Typography>}
  </Stack>;
}

export function useVideoPlayer() {
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    const update = () => setElement((window as any).__videoPlayerRef ?? null);
    update(); const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, []);
  return element;
}
