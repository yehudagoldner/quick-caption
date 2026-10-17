import { Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, IconButton, Stack, Typography } from "@mui/material";
import { PauseRounded, PlayArrowRounded } from "@mui/icons-material";
import type { Segment, Word } from "../types";
import { useActiveWord } from "../hooks/useActiveWord";
import { escapeAssText, wordPopCues, wordPopScale, type CaptionMotion, type PopIntensity } from "../../captionMotion.js";
import { CaptionAppearanceContext } from '../contexts/CaptionAppearanceContext';
import { sanitizeCaptionOverrides } from '../../captionOverrides.js';
import { useCaptionTransform } from '../hooks/useCaptionTransform';
import { useCaptionLivePatch } from '../hooks/useCaptionLivePreview';
import { CaptionSelectionFrame, CaptionTransformGuides } from './CaptionTransformControls';
import { WordAppearanceContext } from '../contexts/WordAppearanceContext';
import { WordAppearanceToolbar } from './WordAppearanceToolbar';
import { sanitizeWordOverrides, type WordDelta } from '../../wordOverrides.js';
import { useWordDrag } from '../hooks/useWordDrag';
import { AudiogramContext } from '../contexts/AudiogramContext';
import { AudiogramBackdrop } from './AudiogramBackdrop';
import { VideoVersionContext } from '../contexts/VideoVersionContext';
import { VideoCropFrame } from './VideoCropFrame';
import { cropRectangle } from '../../videoVersions.js';

type VideoPlayerProps = {
  compact?: boolean;
  size?: "full" | "mid" | "mini";
  fill?: boolean;
  hideMeta?: boolean;
  mediaUrl: string | null;
  activeSegmentText: string | null;
  activeSegmentId: Segment["id"] | null;
  segments?: Segment[];
  previewStyle: React.CSSProperties;
  words?: Word[];
  currentTime: number;
  activeWordEnabled: boolean;
  activeWordColor?: string;
  captionMotion?: CaptionMotion;
  popIntensity?: PopIntensity;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (dimensions: { width: number; height: number }, duration: number) => void;
  onResize?: (dimensions: { width: number; height: number }) => void;
};

const SIZE_DVH = { full: 48, mid: 28, mini: 16 } as const;
const PLAY_BAR_HEIGHT = 36;

// Native audio controls would cover the bottom of an audiogram frame, where captions sit.
function AudiogramPlayBar({ media, currentTime, width }: { media: React.RefObject<HTMLVideoElement | null>; currentTime: number; width: string | { xs: string; sm: string } }) {
  const [state, setState] = useState({ playing: false, duration: 0 });
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    const sync = () => setState({ playing: !element.paused, duration: Number.isFinite(element.duration) ? element.duration : 0 });
    const events = ["play", "pause", "ended", "durationchange", "loadedmetadata"];
    events.forEach(name => element.addEventListener(name, sync));
    sync();
    return () => events.forEach(name => element.removeEventListener(name, sync));
  }, [media]);
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return <Stack direction="row" alignItems="center" spacing={.5} sx={{ width, height: PLAY_BAR_HEIGHT, flexShrink: 0, maxWidth: "100%" }}>
    <IconButton size="small" aria-label={state.playing ? "השהיית האודיו" : "ניגון האודיו"}
      onClick={() => { const element = media.current; if (!element) return; if (element.paused) void element.play().catch(() => {}); else element.pause(); }}>
      {state.playing ? <PauseRounded /> : <PlayArrowRounded />}
    </IconButton>
    <Typography variant="caption" color="text.secondary" dir="ltr">{clock(currentTime)} / {clock(state.duration)}</Typography>
  </Stack>;
}
const VIDEO_PLAYER_CHANGED = "quickcaption:video-player-changed";

function CaptionPreview({ activeSegmentText, activeSegmentId, words, currentTime, activeWordEnabled, activeWordColor = "#ffd700", captionMotion = "none", popIntensity = "gentle", selected = [], selectWord, moveWord, rotation = 0 }: Pick<VideoPlayerProps,
  "activeSegmentText" | "activeSegmentId" | "words" | "currentTime" | "activeWordEnabled" | "activeWordColor" | "captionMotion" | "popIntensity"> & {
    selected?: number[]; selectWord?: (index: number, multiple: boolean) => void;
    moveWord?: (indexes: number[], delta: WordDelta) => void; rotation?: number;
  }) {
  const wordEditor = useContext(WordAppearanceContext);
  const drag = useWordDrag({ selected, disabled: !moveWord || !selectWord || Boolean(wordEditor?.disabled), rotation, move: (indexes, delta) => moveWord?.(indexes, delta) });
  const captionWords = useMemo(() => words?.filter(w => w.segmentId === activeSegmentId) ?? [], [words, activeSegmentId]);
  const activeWord = useActiveWord({ words: captionWords, currentTime, enabled: activeWordEnabled });
  const popWords = useMemo(() => wordPopCues(captionWords), [captionWords]);
  const popWord = captionMotion === "pop" ? popWords.find(word => currentTime >= word.start && currentTime < word.end) : null;
  const captionParts = useMemo(() => {
    let wordIndex = 0;
    return (activeSegmentText ?? "").split(/(\s+)/).map(text => ({ text, wordIndex: text.trim() ? wordIndex++ : undefined }));
  }, [activeSegmentText]);
  if (!activeSegmentText || captionMotion === "pop" && !popWord) return null;
  const renderWord = (text: string, index: number, pop = false) => {
    const saved = sanitizeWordOverrides(captionWords.find(word => word.wordIndex === index)?.style);
    const own = sanitizeWordOverrides(drag.live?.indexes.includes(index) ? { ...saved, offsetX: (saved.offsetX ?? 0) + drag.live.delta.x, offsetY: (saved.offsetY ?? 0) + drag.live.delta.y } : saved);
    const active = !pop && activeWordEnabled && activeWord?.wordIndex === index;
    const chosen = selected.includes(index);
    return <span key={index} {...drag.handlers(index)} data-testid={pop ? 'caption-pop-word' : undefined} data-word-index={index}
      data-active-word={active ? 'true' : undefined} data-word-editable={selectWord ? 'true' : undefined}
      role={selectWord ? 'button' : undefined} tabIndex={selectWord ? 0 : undefined}
      aria-label={selectWord ? `עיצוב המילה ${text}` : undefined} aria-pressed={selectWord ? chosen : undefined}
      onClick={event => { if (selectWord) { event.stopPropagation(); if (!drag.consumeClick()) selectWord(index, event.ctrlKey || event.metaKey); } }}
      onKeyDown={event => { if (selectWord && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); selectWord(index, event.ctrlKey || event.metaKey); } }}
      style={{ color: active ? activeWordColor : own.fontColor ?? 'inherit', fontSize: own.fontScale ? `${own.fontScale * 100}%` : undefined,
        fontWeight: own.bold ? 900 : undefined,
        position: 'relative', left: `${(own.offsetX ?? 0) / (own.fontScale ?? 1)}em`, top: `${(own.offsetY ?? 0) / (own.fontScale ?? 1)}em`,
        ...(selectWord ? { cursor: chosen ? drag.live ? 'grabbing' : 'grab' : 'pointer', zIndex: chosen ? 2 : undefined, outline: chosen ? '2px solid #38bdf8' : undefined, outlineOffset: 2, borderRadius: 2 } : {}),
        ...(pop ? { display: 'inline-block', whiteSpace: 'nowrap', transformOrigin: '50% 100%', transform: `scale(${wordPopScale(popWord!, currentTime, popIntensity)})` } : {}) }}>
      {pop ? escapeAssText(text) : text}
    </span>;
  };
  return <Box data-testid="subtitle-overlay" data-segment-id={activeSegmentId}>
    {captionMotion === 'pop' && popWord ? renderWord(popWord.word, popWord.wordIndex!, true)
      : captionParts.map((part, index) => part.wordIndex === undefined ? <Fragment key={`space-${index}`}>{part.text}</Fragment> : renderWord(part.text, part.wordIndex))}
  </Box>;
}

export function VideoPlayer({ compact, size, fill, hideMeta, mediaUrl, activeSegmentText, activeSegmentId, segments, previewStyle, words, currentTime, activeWordEnabled, activeWordColor = "#ffd700", captionMotion = "none", popIntensity = "gentle", onTimeUpdate, onLoadedMetadata, onResize }: VideoPlayerProps) {
  const appearance = useContext(CaptionAppearanceContext);
  const wordEditor = useContext(WordAppearanceContext);
  const [selectedWords, setSelectedWords] = useState<number[]>([]);
  const [failedMove, setFailedMove] = useState<{ indexes: number[]; delta: WordDelta } | null>(null);
  const version = useContext(VideoVersionContext);
  const crop = version?.crop;
  const cropStageRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 16, height: 9 });
  const [isAudio, setIsAudio] = useState(false);
  const [error, setError] = useState(false);
  const audiogram = useContext(AudiogramContext);
  // Audio with an audiogram frame behaves like a video of that size.
  const canvas = isAudio ? audiogram : null;
  const audioOnly = isAudio && !canvas;
  const frame = canvas ? canvas.dimensions : dimensions;
  const hasCanvas = Boolean(canvas);
  const activeCaption = useMemo(() => segments
    ? segments.find(segment => segment.text && currentTime >= segment.start && currentTime < segment.end)
    : activeSegmentText ? { id: activeSegmentId, text: activeSegmentText } : null, [segments, currentTime, activeSegmentText, activeSegmentId]);
  const appearanceSelected = Boolean(appearance?.segment && appearance.segment.id === activeCaption?.id);
  useEffect(() => { setSelectedWords([]); setFailedMove(null); }, [activeCaption?.id, activeCaption?.text, appearanceSelected, wordEditor?.versionId]);
  const moveWord = async (indexes: number[], delta: WordDelta) => {
    if (!wordEditor || activeCaption?.id == null) return;
    setFailedMove(null);
    try { await wordEditor.move(activeCaption.id, indexes, delta); }
    catch { setFailedMove({ indexes, delta }); }
  };
  const selectedCaptionWords = (words ?? []).filter(word => word.segmentId === activeCaption?.id && selectedWords.includes(word.wordIndex!));
  const highlight = appearanceSelected ? appearance!.values.activeWordColor
    : sanitizeCaptionOverrides(segments?.find(segment => segment.id === activeCaption?.id)?.style).activeWordColor ?? activeWordColor;
  const committedValues = { positionXPercent: 50, offsetYPercent: 20, rotation: 0, fontSize: 105, ...appearance?.values,
    ...(!appearanceSelected ? sanitizeCaptionOverrides(segments?.find(segment => segment.id === activeCaption?.id)?.style) : {}) };
  const livePatch = useCaptionLivePatch(appearance?.live);
  const live = appearanceSelected ? livePatch : null;
  const transformValues = live ? { ...committedValues, ...live } : committedValues;
  const { mode: transformMode, ...transformEvents } = useCaptionTransform({ stage: crop ? cropStageRef : stageRef, caption: captionRef,
    segmentId: activeCaption?.id ?? null, selected: appearanceSelected, disabled: !appearance || appearance.disabled || audioOnly,
    values: transformValues,
    select: () => { if (activeCaption?.id != null) appearance?.select(activeCaption.id, { deferControls: true }); },
    preview: patch => appearance?.live.set(patch), commit: patch => appearance?.commit(patch), showControls: () => appearance?.showControls(),
  });
  const basePreviewFontSize = parseFloat(String(previewStyle.fontSize));
  const liveCaptionStyle = live ? {
    left: `${transformValues.positionXPercent}%`, bottom: `${transformValues.offsetYPercent}%`,
    transform: `translate(-50%, 0) rotate(${transformValues.rotation}deg)`,
    ...(live.fontSize != null && Number.isFinite(basePreviewFontSize) ? { fontSize: `${basePreviewFontSize * live.fontSize / committedValues.fontSize}px` } : {}),
  } : undefined;
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
    window.dispatchEvent(new Event(VIDEO_PLAYER_CHANGED));
    return () => {
      if ((window as any).__videoPlayerRef !== video) return;
      (window as any).__videoPlayerRef = null;
      window.dispatchEvent(new Event(VIDEO_PLAYER_CHANGED));
    };
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
    // An audio element is only a control bar; captions are laid out on the stage.
    const target = hasCanvas && stageRef.current ? stageRef.current : video;
    const resize = () => {
      const rect = target.getBoundingClientRect();
      if (rect.width && rect.height) onResize?.({ width: rect.width, height: rect.height });
    };
    update(); resize();
    video.addEventListener("loadedmetadata", update);
    const observer = new ResizeObserver(resize);
    observer.observe(target);
    return () => { video.removeEventListener("loadedmetadata", update); observer.disconnect(); };
  }, [mediaUrl, onLoadedMetadata, onResize, hasCanvas]);

  const ratio = frame.width / frame.height;
  const cropRect = crop ? cropRectangle(dimensions, crop, currentTime) : null;
  const heightDvh = size ? SIZE_DVH[size] : compact ? 22 : 48;
  const availableHeight = canvas ? `(100cqh - ${PLAY_BAR_HEIGHT}px)` : "100cqh";
  const stageSize = fill
    ? {
        width: audioOnly ? "100%" : `min(100cqw, calc(${availableHeight} * ${ratio}))`,
        height: audioOnly ? "100%" : `min(calc(${availableHeight}), calc(100cqw / ${ratio}))`,
        maxWidth: "100%",
        maxHeight: "100%",
      }
    : {
        width: audioOnly ? "100%" : { xs: `min(100%, ${Math.min(640, 500 * ratio)}px, calc(${heightDvh}dvh * ${ratio}))`, sm: `min(100%, ${Math.min(640, 500 * ratio)}px, calc(${size ? SIZE_DVH[size] : 48}dvh * ${ratio}))` },
      };
  return <Stack spacing={fill ? 0 : 1} alignItems="center" justifyContent="center" sx={{
    position: "relative",
    width: "100%",
    minWidth: 0,
    minHeight: 0,
    height: fill ? "100%" : undefined,
    ...(fill ? { containerType: "size" } : {}),
  }}>
    {wordEditor && appearanceSelected && activeCaption?.id != null && selectedCaptionWords.length > 0 && <WordAppearanceToolbar
      key={`${wordEditor.versionId}:${activeCaption.id}:${selectedWords.join(',')}`} segmentId={activeCaption.id} words={selectedCaptionWords} close={() => setSelectedWords([])} />}
    {failedMove && <Alert severity="error" sx={{ position: 'absolute', bottom: 40, zIndex: 6 }} action={<Button disabled={wordEditor?.disabled} onClick={() => void moveWord(failedMove.indexes, failedMove.delta)}>נסו שוב</Button>}>הזזת המילה לא נשמרה. אפשר לנסות שוב.</Alert>}
    {audioOnly && !hideMeta && <Typography variant="subtitle2">אודיו בלבד — תצוגה מקדימה של הכתוביות</Typography>}
    {error && <Alert severity="error" sx={fill ? { position: "absolute", zIndex: 2, mx: 1 } : undefined}>לא ניתן לנגן את המדיה. בדקו שהקובץ זמין ובפורמט שנתמך בדפדפן.</Alert>}
    <Box ref={stageRef} data-testid="media-stage" {...transformEvents} sx={{ position: "relative", bgcolor: "common.black", color: "white", borderRadius: 2, overflow: "hidden", mx: "auto", flexShrink: 0,
      ...(appearance && !appearance.disabled ? { touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTapHighlightColor: 'transparent' } : {}),
      cursor: appearanceSelected ? transformMode === 'move' ? 'grabbing' : 'move' : undefined,
      ...stageSize,
      aspectRatio: audioOnly || fill ? undefined : `${frame.width} / ${frame.height}`, minHeight: audioOnly && !fill ? 180 : undefined }}>
      {mediaUrl ? <>
        {canvas && <AudiogramBackdrop settings={canvas.settings} imageUrl={canvas.imageUrl} currentTime={currentTime} />}
        <Box component="video" ref={videoRef} controls={!appearance?.segment && !canvas && !crop} controlsList="nofullscreen" playsInline preload="metadata" src={mediaUrl}
          onSeeking={e => onTimeUpdate?.(e.currentTarget.currentTime)}
          onTimeUpdate={e => onTimeUpdate?.(e.currentTarget.currentTime)} onError={() => setError(true)}
          sx={canvas ? { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }
            : { width: "100%", height: isAudio ? 54 : "100%", display: "block", objectFit: "contain", ...(isAudio ? { position: "absolute", bottom: 0 } : {}) }} />
        {crop && <VideoCropFrame key={version?.activeId} dimensions={dimensions} time={currentTime} />}
        <Box ref={cropStageRef} data-testid="version-caption-stage" sx={cropRect ? { position: 'absolute', zIndex: 2, pointerEvents: 'none', overflow: 'hidden',
          left: `${cropRect.x / dimensions.width * 100}%`, top: `${cropRect.y / dimensions.height * 100}%`, width: `${cropRect.width / dimensions.width * 100}%`, height: `${cropRect.height / dimensions.height * 100}%` } : { display: 'contents' }}>
        {activeCaption && <Box ref={captionRef} data-testid="caption-position" role={appearance ? 'button' : undefined}
          tabIndex={appearance && !appearance.disabled ? 0 : undefined} aria-label={appearance ? 'עריכת עיצוב הכתובית בתצוגה' : undefined}
          aria-pressed={appearance ? appearanceSelected : undefined}
          onClick={() => { if (appearance && !appearance.disabled && activeCaption.id != null) appearance.select(activeCaption.id); }}
          onKeyDown={event => {
            if ((event.key === 'Enter' || event.key === ' ') && appearance && !appearance.disabled && activeCaption.id != null) {
              event.preventDefault(); event.stopPropagation(); appearance.select(activeCaption.id);
            }
          }}
          style={liveCaptionStyle}
          sx={{ ...previewStyle, ...(audioOnly ? { fontSize: 24, bottom: 75, width: "90%" } : {}),
            ...(appearance ? { width: 'max-content', maxWidth: 'none', pointerEvents: 'auto', cursor: appearance.disabled ? 'default' : transformMode === 'move' ? 'grabbing' : 'move', touchAction: 'none', userSelect: 'none',
              borderRadius: '4px', transition: 'box-shadow .15s',
              ...(!appearanceSelected && !appearance.disabled ? { '@media (hover: hover)': { '&:hover': { boxShadow: '0 0 0 1.5px rgba(255, 255, 255, .7)' } } } : {}),
              // Enlarge the touch target without changing caption layout or export geometry.
              '&::after': { content: '""', position: 'absolute', inset: '-12px', touchAction: 'none', pointerEvents: wordEditor && appearanceSelected ? 'none' : undefined },
              '&:focus-visible': { outline: '2px solid #38bdf8', outlineOffset: 8 } } : {}),
            ...(crop ? { whiteSpace: 'pre-wrap', width: previewStyle.width, maxWidth: previewStyle.maxWidth } : {}) }}>
          <CaptionPreview key={activeCaption.id} activeSegmentId={activeCaption.id} activeSegmentText={activeCaption.text}
            words={words} currentTime={currentTime} activeWordEnabled={activeWordEnabled} activeWordColor={highlight}
            captionMotion={captionMotion} popIntensity={popIntensity} selected={selectedWords}
            rotation={transformValues.rotation} moveWord={(indexes, delta) => void moveWord(indexes, delta)}
            selectWord={wordEditor && appearanceSelected ? (index, multiple) => {
              if (wordEditor.disabled) return;
              videoRef.current?.pause();
              setSelectedWords(previous => multiple ? previous.includes(index) ? previous.filter(value => value !== index) : [...previous, index] : [index]);
            } : undefined} />
          {appearanceSelected && !audioOnly && !appearance?.disabled && <CaptionSelectionFrame mode={transformMode} />}
        </Box>}
        {appearanceSelected && !audioOnly && <CaptionTransformGuides mode={transformMode} values={transformValues} />}
        </Box>
      </> : <Typography sx={{ p: 3 }}>אין תצוגה זמינה לקובץ הנוכחי.</Typography>}
    </Box>
    {canvas && mediaUrl && <AudiogramPlayBar media={videoRef} currentTime={currentTime} width={stageSize.width} />}
    {!audioOnly && !hideMeta && <Typography variant="caption" color="text.secondary" dir="ltr">{frame.width} × {frame.height} · {ratio === 1 ? "וידאו מרובע" : ratio < 1 ? "וידאו אנכי" : "וידאו אופקי"}</Typography>}
  </Stack>;
}

export function useVideoPlayer() {
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    const update = () => setElement((window as any).__videoPlayerRef ?? null);
    // Switching mobile modes mounts a new player. Publish it immediately so
    // the first word tap cannot seek the detached player from the old mode.
    window.addEventListener(VIDEO_PLAYER_CHANGED, update);
    update();
    return () => window.removeEventListener(VIDEO_PLAYER_CHANGED, update);
  }, []);
  return element;
}
