import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  Avatar, Box, Button, ButtonBase, Card, CardContent, Chip, Divider, FormControlLabel, IconButton, InputAdornment,
  Slider, Stack, Switch, TextField, ThemeProvider, Typography, createTheme, useTheme,
} from "@mui/material";
import {
  AccessTimeRounded, AccountBalanceWalletRounded, AddRounded, ChevronLeftRounded, CloseRounded, ContentCutRounded,
  DeleteOutlineRounded, EditOutlined, FullscreenRounded, HomeRounded, MenuRounded, MoreVertRounded, MyLocationRounded,
  OpenInFullRounded, PauseRounded, PlayArrowRounded, RedoRounded, RepeatRounded, RestartAltRounded, SettingsRounded,
  ShareRounded, ShortTextRounded, UndoRounded, UploadFileOutlined, VideoLibraryRounded, VolumeOffRounded, ZoomInRounded,
} from "@mui/icons-material";
import type { Segment } from "../../types";
import { VideoToolbar } from "../VideoToolbar";
import { SubtitleEditor } from "../SubtitleEditor";
import { VideoSeekBar } from "../VideoSeekBar";
import { CaptionSelectionToolbar } from "../CaptionSelectionToolbar";
import { TimelineEditToolbar } from "../TimelineEditToolbar";
import { usePreviewStyle } from "../../hooks/usePreviewStyle";
import { useAutoCaptionFontSize } from "../../hooks/useAutoCaptionFontSize";
import { useEditorPreferences } from "../../contexts/EditorPreferences";
import { formatTimecode, snapToFrame } from "../../utils/timecode";
import { serializeSubtitles } from "../../utils/subtitleExport";
import { findSegment } from "../../utils/transcriptionUtils";
import { AUTO_CAPTION_FONT_SIZE } from "../../../captionStyle.js";
import { DEMO_IMAGE, DEMO_VIDEO, LOOK_PRESETS, activeWordIndex, useElementSize, type CaptionDemo, type CaptionLook } from "./captionDemo";
import "../SubtitleTimeline.css";

const RATIO = DEMO_VIDEO.width / DEMO_VIDEO.height;
const DESKTOP = { width: 1366, height: 768 };
const PHONE = { width: 390, height: 800 };

/** Renders a fixed-size app screen and scales it to the available width. */
function Scaled({ width, height, className, children }: { width: number; height: number; className?: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = outer.current;
    if (!element) return;
    const update = (available: number) => setScale(Math.min(1, available / width));
    update(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  return <div ref={outer} className={`qc-scaled ${className ?? ""}`} style={{ height: height * scale }}>
    <div className="qc-scaled-inner" style={{ width, height, transform: `scale(${scale})` }}>{children}</div>
  </div>;
}

/** Mirrors VideoPlayer's subtitle overlay, including the active-word color. */
export function CaptionOverlay({ look, segments, segment, time, render, testId }: {
  look: CaptionLook; segments: Segment[]; segment: Segment | null; time: number; render: { width: number; height: number } | null; testId?: string;
}) {
  const autoFontSize = useAutoCaptionFontSize({ segments, videoDimensions: DEMO_VIDEO, marginPercent: look.marginPercent, offsetYPercent: look.offsetYPercent });
  const style = usePreviewStyle({
    fontColor: look.fontColor,
    fontSize: look.fontSize === AUTO_CAPTION_FONT_SIZE ? autoFontSize : look.fontSize,
    offsetYPercent: look.offsetYPercent,
    outlineColor: look.outlineColor,
    marginPercent: look.marginPercent,
    videoDimensions: DEMO_VIDEO,
    renderDimensions: render,
  });
  if (!segment || !render) return null;
  const active = look.activeWord ? activeWordIndex(segment, time) : -1;
  let wordIndex = 0;
  return <Box data-testid={testId} sx={style}>
    {look.activeWord ? segment.text.split(/(\s+)/).map((text, index) => {
      const current = text.trim() ? wordIndex++ : undefined;
      const on = current !== undefined && current === active;
      return <span key={index} data-active-word={on ? "true" : undefined} style={{ color: on ? "#FFD700" : "inherit" }}>{text}</span>;
    }) : segment.text}
  </Box>;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function DemoStage({ demo, compactControls, captionTestId }: { demo: CaptionDemo; compactControls?: boolean; captionTestId?: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const render = useElementSize(stage);
  const segment = demo.showCaptions ? findSegment(demo.segments, demo.time) ?? null : null;
  return <Box sx={{ position: "relative", width: "100%", height: "100%", minHeight: 0, containerType: "size", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <Box ref={stage} data-testid="demo-stage" onClick={() => demo.setPlaying(value => !value)} sx={{
      position: "relative", bgcolor: "common.black", color: "white", borderRadius: 2, overflow: "hidden", cursor: "pointer", flexShrink: 0,
      width: `min(100cqw, calc(100cqh * ${RATIO}))`, height: `min(100cqh, calc(100cqw / ${RATIO}))`,
    }}>
      <img className="qc-stage-image" src={DEMO_IMAGE} alt="סרטון לדוגמה בעורך" width={DEMO_VIDEO.width} height={DEMO_VIDEO.height} />
      <CaptionOverlay testId={captionTestId} look={demo.look} segments={demo.segments} segment={segment} time={demo.time} render={render} />
      <div className={`qc-native-controls ${compactControls ? "is-compact" : ""} ${demo.playing ? "is-playing" : ""}`} aria-hidden="true">
        <div className="qc-native-row">
          {demo.playing ? <PauseRounded /> : <PlayArrowRounded />}
          <span>{clock(demo.time)} / {clock(demo.duration)}</span>
          <i />
          <VolumeOffRounded className="is-dim" /><FullscreenRounded /><MoreVertRounded />
        </div>
        <div className="qc-native-progress"><span style={{ width: `${demo.time / demo.duration * 100}%` }} /></div>
      </div>
    </Box>
  </Box>;
}

type Clip = { id: Segment["id"]; start: number; end: number; label: string };

/** Same geometry and colors as the react-timeline-editor track used in the editor. */
function Track({ clips, duration, pixelsPerSecond, time, fps, height, color, selectedId, onClip, onSeek, testId, label }: {
  clips: Clip[]; duration: number; pixelsPerSecond: number; time: number; fps: number; height: number; color: string;
  selectedId?: Segment["id"] | null; onClip: (clip: Clip) => void; onSeek: (time: number) => void; testId: string; label: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const view = useElementSize(scroller);
  const scale = Math.max(1, Math.ceil(100 / pixelsPerSecond));
  const scaleWidth = pixelsPerSecond * scale;
  const content = Math.max(view?.width ?? 0, 40 + duration * pixelsPerSecond);
  const majors = Math.max(2, Math.ceil(content / scaleWidth) + 1);
  const cursor = 20 + Math.max(0, Math.min(duration, time)) * pixelsPerSecond;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (cursor < element.scrollLeft + 20 || cursor > element.scrollLeft + element.clientWidth - 20) element.scrollLeft = cursor - 40;
  }, [cursor]);
  const seekFrom = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - rect.left) / rect.width * content - 20) / pixelsPerSecond);
  };
  return <div ref={scroller} className="qc-track" style={{ height }} data-testid={testId} aria-label={label}>
    <div className="qc-track-content" style={{ width: content }}>
      <div className="qc-track-time" onClick={seekFrom}>
        {Array.from({ length: majors * 4 }, (_, index) => <span key={index} className={`qc-track-unit ${index % 4 === 0 ? "is-big" : ""}`} style={{ left: 20 + index * scaleWidth / 4 }}>
          {index % 4 === 0 && <span className="qc-track-label">{formatTimecode(index / 4 * scale, fps)}</span>}
        </span>)}
      </div>
      <div className="qc-track-row" style={{ backgroundSize: `${scaleWidth}px 100%`, backgroundPosition: "20px 0" }} onClick={seekFrom}>
        {clips.map(clip => <Box key={String(clip.id)} role="button" tabIndex={0} data-testid={`${testId}-clip`}
          aria-label={`${label}: ${clip.label}`} aria-pressed={selectedId === clip.id}
          onClick={event => { event.stopPropagation(); onClip(clip); }}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClip(clip); } }}
          className="qc-clip" sx={{ left: 20 + clip.start * pixelsPerSecond, width: Math.max(2, (clip.end - clip.start) * pixelsPerSecond), bgcolor: selectedId === clip.id ? "primary.main" : color }}>
          <span className="qc-clip-stretch is-left" /><span className="qc-clip-stretch is-right" />
          <Typography noWrap variant="caption" sx={{ direction: "rtl", unicodeBidi: "plaintext", fontWeight: 600, letterSpacing: ".2px" }}>{clip.label}</Typography>
        </Box>)}
      </div>
      <div className="qc-track-cursor" style={{ left: cursor }}><span /></div>
    </div>
  </div>;
}

function wordClips(segment: Segment): Clip[] {
  const words = segment.text.trim().split(/\s+/).filter(Boolean);
  const step = (segment.end - segment.start) / Math.max(1, words.length);
  return words.map((word, index) => ({ id: index, start: index * step, end: (index + 1) * step - 0.04, label: word }));
}

function speechPeaks(segments: Segment[], duration: number) {
  return Array.from({ length: 1600 }, (_, index) => {
    const time = index / 1600 * duration;
    const segment = findSegment(segments, time);
    if (!segment) return 0.03;
    const words = Math.max(1, segment.text.split(/\s+/).length);
    const phase = ((time - segment.start) / (segment.end - segment.start)) * words % 1;
    const envelope = Math.sin(Math.PI * Math.min(1, phase * 1.15));
    return Math.min(0.95, 0.08 + envelope * (0.45 + 0.4 * Math.abs(Math.sin(time * 37.1) * Math.cos(time * 11.3))));
  });
}

function DemoTimeline({ demo, fps, selectedId, onSelect }: { demo: CaptionDemo; fps: number; selectedId: Segment["id"] | null; onSelect: (id: Segment["id"] | null) => void }) {
  const theme = useTheme();
  const ltrTheme = useMemo(() => createTheme(theme, { direction: "ltr" }), [theme]);
  const { preferences } = useEditorPreferences();
  const [zoom, setZoom] = useState<number | null>(null);
  const [wordZoom, setWordZoom] = useState(160);
  const [waveform, setWaveform] = useState(false);
  const [loop, setLoop] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const width = useElementSize(area)?.width ?? 900;
  const { time, duration, segments, seek: setTime, playing, setPlaying } = demo;
  const pixelsPerSecond = Math.max(0.01, (width - 40) / duration) * 2 ** ((zoom ?? 0) / 25);
  const selected = segments.find(segment => segment.id === selectedId) ?? null;
  const seek = (value: number) => setTime(snapToFrame(Math.max(0, Math.min(duration, value)), fps));
  const resume = useRef(false);
  const peaks = useMemo(() => speechPeaks(segments, duration), [segments, duration]);
  const path = useMemo(() => peaks.map((value, index) => `M${index},${32 - value * 30}v${Math.max(1, value * 60)}`).join(" "), [peaks]);
  useEffect(() => {
    if (loop && selected && (time >= selected.end || time < selected.start)) setTime(selected.start);
  }, [loop, selected, time, setTime]);
  useEffect(() => { if (!selected) setLoop(false); }, [selected]);

  return <Stack spacing={0.75} className="subtitle-timeline" sx={{ width: "100%", minWidth: 0, flexShrink: 0 }}>
    <Stack direction="row" alignItems="center" gap={1}>
      <IconButton aria-label={playing ? "השהה" : "נגן"} onClick={() => setPlaying(value => !value)}>{playing ? <PauseRounded /> : <PlayArrowRounded />}</IconButton>
      <Button size="small" aria-label="פריים אחורה" onClick={() => seek(time - 1 / fps)}>−1F</Button>
      <Typography variant="body2" dir="ltr" data-testid="demo-timecode" sx={{ whiteSpace: "nowrap" }}>{formatTimecode(time, fps)}</Typography>
      <Button size="small" aria-label="פריים קדימה" onClick={() => seek(time + 1 / fps)}>+1F</Button>
      <IconButton size="small" aria-label="ביטול פעולה" disabled><UndoRounded /></IconButton>
      <IconButton size="small" aria-label="ביצוע חוזר" disabled><RedoRounded /></IconButton>
      <Box dir="ltr" sx={{ flex: 1, px: 2 }}
        onPointerDownCapture={() => { resume.current = playing; setPlaying(false); }}
        onPointerUpCapture={() => { if (resume.current) setPlaying(true); resume.current = false; }}>
        <VideoSeekBar currentTime={time} duration={duration} fps={fps} mediaUrl={null} onSeek={seek} />
      </Box>
    </Stack>
    {waveform ? <Box>
      <Typography variant="caption">גל קול — כל ההקלטה. לחצו להאזנה ממיקום מדויק.</Typography>
      <Box component="svg" viewBox="0 0 1600 64" preserveAspectRatio="none" aria-hidden="true"
        onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); seek((event.clientX - rect.left) / rect.width * duration); }}
        sx={{ width: "100%", height: 64, display: "block", bgcolor: "action.hover", cursor: "crosshair", borderRadius: 1 }}>
        <path d={path} stroke="#3d91c8" strokeWidth="1" />
        <line x1={time / duration * 1600} x2={time / duration * 1600} y1="0" y2="64" stroke="#e65100" strokeWidth="3" />
      </Box>
    </Box> : <Box><Button size="small" onClick={() => setWaveform(true)}>הצג גל קול</Button></Box>}
    <Box ref={area} sx={{ minWidth: 0 }}>
      <Stack direction="row" gap={1} alignItems="center" sx={{ height: 40, px: 1, bgcolor: "action.hover", minWidth: 0 }}>
        <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>זום ציר ראשי</Typography>
        <ThemeProvider theme={ltrTheme}><Box dir="ltr" sx={{ flex: 1, minWidth: 40, maxWidth: 240, px: 1 }}>
          <Slider size="small" aria-label="זום ציר ראשי" min={0} max={200} value={zoom ?? 0} onChange={(_, value) => setZoom(value as number)} />
        </Box></ThemeProvider>
        <Button size="small" aria-label="תצוגת 30 שניות" aria-pressed={zoom === null} variant={zoom === null ? "contained" : "text"} onClick={() => setZoom(null)} sx={{ whiteSpace: "nowrap", minWidth: 0 }}>30 שנ׳</Button>
        <Button size="small" aria-label="התאם את כל ההקלטה" aria-pressed={zoom === 0} onClick={() => setZoom(0)} sx={{ whiteSpace: "nowrap", minWidth: 0 }}>הכול</Button>
        <CaptionSelectionToolbar count={selected ? 1 : 0} disabled canAdd={false} canMerge={false} canSplit={false}
          add={() => {}} selectAll={() => {}} clear={() => onSelect(null)} merge={() => {}} split={() => {}} remove={() => {}} move={() => {}} />
      </Stack>
      <Track testId="demo-caption-track" label="עריכת כתובית" clips={segments.map(segment => ({ id: segment.id, start: segment.start, end: segment.end, label: segment.text }))}
        duration={duration} pixelsPerSecond={pixelsPerSecond} time={time} fps={fps} height={88} color="#9b5700" selectedId={selectedId}
        onClip={clip => { onSelect(clip.id); seek(clip.start); }} onSeek={seek} />
      {selected && <Box data-testid="demo-inspector">
        <TimelineEditToolbar
          editor={<TextField className="caption-text-editor" variant="standard" fullWidth value={selected.text} placeholder="טקסט המקטע"
            onChange={event => demo.editText(selected.id, event.target.value)}
            inputProps={{ dir: preferences.direction, "aria-label": "טקסט המקטע" }}
            InputProps={{
              disableUnderline: true,
              startAdornment: <InputAdornment position="start" sx={{ ml: .75, mr: 0, color: "primary.main", gap: .5 }}><EditOutlined sx={{ fontSize: 16 }} /><Typography component="span" variant="caption" sx={{ fontWeight: 700, color: "primary.main" }}>ערכו כאן</Typography></InputAdornment>,
              endAdornment: <InputAdornment position="end" sx={{ ml: 0 }}><IconButton size="small" aria-label="פתח עריכה בחלון" disabled><OpenInFullRounded /></IconButton></InputAdornment>,
            }} />}
          actions={<>
            <IconButton size="small" aria-label="נגן מכאן" onClick={() => { setTime(selected.start); setPlaying(true); }}><PlayArrowRounded /></IconButton>
            <IconButton size="small" aria-label="נגן מקטע בלולאה" aria-pressed={loop} color={loop ? "primary" : "default"} onClick={() => setLoop(value => !value)}><RepeatRounded /></IconButton>
            <IconButton size="small" aria-label="פצל" disabled><ContentCutRounded /></IconButton>
            <IconButton size="small" aria-label="ביטול טיוטה" disabled><RestartAltRounded /></IconButton>
            <Box className="timeline-toolbar-divider" />
            <Box component="span" sx={{ display: "flex", alignItems: "center", color: "text.secondary", gap: .25 }}><ShortTextRounded fontSize="small" /><Typography variant="caption">מילים</Typography></Box>
            <IconButton size="small" aria-label="ערוך מילה ותזמון" disabled><EditOutlined /></IconButton>
            <IconButton size="small" aria-label="עבור למיקום המילה" disabled><MyLocationRounded /></IconButton>
            <IconButton size="small" aria-label="מחק מילים מסומנות" color="error" disabled><DeleteOutlineRounded /></IconButton>
            <Box className="timeline-toolbar-divider" />
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: 110, px: 1 }}>
              <ZoomInRounded fontSize="small" color="action" />
              <Slider size="small" aria-label="זום מילים" min={80} max={640} value={wordZoom} onChange={(_, value) => setWordZoom(value as number)} />
            </Box>
          </>}
          primary={null}
          close={<IconButton size="small" aria-label="סגור עורך" onClick={() => onSelect(null)}><CloseRounded /></IconButton>} />
        {demo.look.activeWord && <Track testId="demo-word-track" label="עריכת מילה" clips={wordClips(selected)} duration={selected.end - selected.start}
          pixelsPerSecond={wordZoom} time={time - selected.start} fps={fps} height={88} color="#1b5e20"
          onClip={clip => seek(selected.start + clip.start)} onSeek={value => seek(selected.start + value)} />}
      </Box>}
    </Box>
  </Stack>;
}

function useSubtitleFile(segments: Segment[], direction: "rtl" | "ltr") {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([serializeSubtitles(segments, ".srt", direction)], { type: "text/plain;charset=utf-8" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [segments, direction]);
  return url;
}

function DemoAppBar({ onStart }: { onStart: () => void }) {
  return <Box aria-hidden="true" sx={{ height: 64, flexShrink: 0, display: "flex", alignItems: "center", px: 3, bgcolor: "grey.100", borderBottom: 1, borderColor: "divider" }}>
    <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 2 }}>
      <Box component="img" src="/quickcaption-logo.svg" alt="" sx={{ height: 32 }} />
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button tabIndex={-1} startIcon={<HomeRounded />} variant="outlined" size="small">דף הבית</Button>
        <Button tabIndex={-1} startIcon={<VideoLibraryRounded />} variant="contained" size="small">היסטוריית סרטונים</Button>
        <Button tabIndex={-1} startIcon={<UploadFileOutlined />} variant="outlined" size="small" onClick={onStart}>סרטון חדש</Button>
      </Box>
    </Box>
    <Chip icon={<AccountBalanceWalletRounded />} label="50 קרדיטים" color="success" size="small" sx={{ ml: 2, fontWeight: "bold" }} />
    <IconButton tabIndex={-1} size="small" sx={{ ml: 1 }}><Avatar sx={{ width: 38, height: 38 }} /></IconButton>
  </Box>;
}

export function DesktopEditorDemo({ demo, onStart }: { demo: CaptionDemo; onStart: () => void }) {
  const { preferences } = useEditorPreferences();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<Segment["id"] | null>(null);
  const downloadUrl = useSubtitleFile(demo.segments, preferences.direction);
  const { look, updateLook, autoFontSize, showCaptions, setShowCaptions, segments, editText, remove } = demo;
  const activeId = findSegment(segments, demo.time)?.id ?? null;
  useEffect(() => { if (selectedId !== null && !segments.some(segment => segment.id === selectedId)) setSelectedId(null); }, [segments, selectedId]);

  const toolbar = useMemo(() => <VideoToolbar
    editorSettings={<Box sx={{ p: 2 }}>
      <FormControlLabel control={<Switch checked={showCaptions} onChange={(_, checked) => setShowCaptions(checked)} />} label="הצג כתוביות בתצוגה המקדימה" />
      <Typography variant="caption" display="block" color="text.secondary">בעורך המלא יש כאן גם קצב פריימים, כיוון טקסט, אורך שורה ופורמט הורדה.</Typography>
    </Box>}
    fontSize={look.fontSize} autoFontSize={autoFontSize} fontColor={look.fontColor} outlineColor={look.outlineColor}
    offsetYPercent={look.offsetYPercent} marginPercent={look.marginPercent}
    isBurning={false} burnError={null} burnedVideo={null} mediaUrl={DEMO_IMAGE} downloadUrl={downloadUrl} downloadName="quick-caption-demo.srt"
    sidebarOpen={sidebarOpen} activeWordEnabled={look.activeWord}
    onFontSizeChange={event => updateLook({ fontSize: event.target.value === AUTO_CAPTION_FONT_SIZE ? AUTO_CAPTION_FONT_SIZE : Number(event.target.value) })}
    onFontColorChange={event => updateLook({ fontColor: event.target.value })}
    onOutlineColorChange={event => updateLook({ outlineColor: event.target.value })}
    onOffsetYChange={(_, value) => updateLook({ offsetYPercent: value as number })}
    onMarginChange={(_, value) => updateLook({ marginPercent: value as number })}
    onBurnVideo={onStart}
    onToggleSidebar={() => setSidebarOpen(open => !open)}
    onToggleActiveWord={() => updateLook({ activeWord: !look.activeWord })}
    onAIEdit={async () => onStart()} />,
  [look, autoFontSize, showCaptions, setShowCaptions, sidebarOpen, downloadUrl, onStart, updateLook]);

  const sidebar = useMemo(() => <SubtitleEditor segments={segments} isEditable saveState="idle" saveError={null} activeSegmentId={activeId}
    onSegmentTextChange={editText} onSegmentBlur={async () => {}} onDeleteSegment={remove} />, [segments, activeId, editText, remove]);

  return <Scaled width={DESKTOP.width} height={DESKTOP.height} className="qc-window-screen">
    <Box className="qc-app" dir="ltr" sx={{ width: DESKTOP.width, height: DESKTOP.height, display: "flex", flexDirection: "column" }}>
      <DemoAppBar onStart={onStart} />
      <Box sx={{ px: 3, py: 1, flex: 1, minHeight: 0 }}>
        <Card elevation={3} sx={{ height: "100%" }}>
          <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 }, height: "100%" }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ width: "100%", minWidth: 0, height: "100%" }}>
              <Stack className="preview-wrapper" spacing={1} sx={{ flex: 1, minWidth: 0, width: "100%", height: "100%" }}>
                <Stack direction="column" alignItems="center" sx={{ width: "100%", minWidth: 0 }}>{toolbar}</Stack>
                <Box sx={{ minWidth: 0, width: "100%", flex: 1, minHeight: 96, borderRadius: 2 }}><DemoStage demo={demo} captionTestId="demo-caption" /></Box>
                <DemoTimeline demo={demo} fps={preferences.fps} selectedId={selectedId} onSelect={setSelectedId} />
              </Stack>
              {sidebarOpen && <>
                <Divider orientation="vertical" flexItem />
                <Stack spacing={2} sx={{ width: 310, flexShrink: 0, minWidth: 0, maxHeight: "100%", overflowY: "auto" }}>{sidebar}</Stack>
              </>}
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Box>
  </Scaled>;
}

/** The mobile caption editor in watch mode, inside a phone frame. */
export function PhoneEditorDemo({ demo, onStart, decorative = false }: { demo: CaptionDemo; onStart: () => void; decorative?: boolean }) {
  const { preferences } = useEditorPreferences();
  const { segments, time } = demo;
  const active = findSegment(segments, time);
  const focused = active ? segments.indexOf(active) : Math.max(0, segments.findIndex(segment => segment.start > time) - 1);
  const nextLook = () => {
    const index = LOOK_PRESETS.findIndex(preset => preset.look.outlineColor === demo.look.outlineColor && preset.look.fontColor === demo.look.fontColor && preset.look.activeWord === demo.look.activeWord);
    demo.setLook(LOOK_PRESETS[(index + 1) % LOOK_PRESETS.length].look);
  };
  const decor = decorative ? { tabIndex: -1 } : {};
  return <div className={`qc-phone ${decorative ? "is-decorative" : ""}`} aria-hidden={decorative || undefined}>
    <div className="qc-phone-island" aria-hidden="true" />
    <Scaled width={PHONE.width} height={PHONE.height} className="qc-phone-screen">
      <Box className="qc-app" dir="ltr" sx={{ width: PHONE.width, height: PHONE.height, display: "flex", flexDirection: "column", bgcolor: "#fff" }}>
        <div className="qc-phone-status" aria-hidden="true"><b>9:41</b><span><i /><i /><i /></span></div>
        <Box aria-hidden="true" sx={{ minHeight: 48, display: "flex", alignItems: "center", px: 1, bgcolor: "grey.100", borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
          <Box sx={{ flexGrow: 1, display: "flex" }}><Box component="img" src="/quickcaption-logo.svg" alt="" sx={{ height: 24 }} /></Box>
          <Chip icon={<AccountBalanceWalletRounded />} label="50 קרדיטים" color="success" size="small" sx={{ ml: .5, fontWeight: "bold" }} />
          <IconButton tabIndex={-1} size="small" sx={{ ml: 1 }}><Avatar sx={{ width: 38, height: 38 }} /></IconButton>
        </Box>
        <Stack direction="row" alignItems="center" sx={{ flexShrink: 0, px: 0.5, py: 0.25, minHeight: 56, borderBottom: 1, borderColor: "#e8edf3", bgcolor: "#ffffff" }}>
          <ButtonBase tabIndex={-1} aria-hidden="true" sx={{ flex: 1, minHeight: 44, justifyContent: "flex-start", fontWeight: 500, fontSize: 15, color: "text.primary", minWidth: 0 }}>
            <ChevronLeftRounded sx={{ width: 44, height: 44, p: 1.25, flexShrink: 0 }} />לסרטונים שלי
          </ButtonBase>
          <IconButton {...decor} size="small" aria-label="שיתוף סרטון עם כתוביות" onClick={onStart} sx={{ width: 44, height: 44, bgcolor: "primary.main", color: "#fff", "&:hover": { bgcolor: "primary.dark" } }}><ShareRounded /></IconButton>
          <IconButton tabIndex={-1} aria-hidden="true" size="small" sx={{ width: 44, height: 44 }}><MenuRounded /></IconButton>
        </Stack>
        <Box sx={{ flex: 1, minHeight: 0, px: 1.5, pt: 1, pb: 0.5, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Stack spacing={1} alignItems="center" sx={{ flex: 1, minHeight: 0, height: "100%" }}>
            <Box sx={{ flex: 1, minHeight: 0, width: "100%" }}><DemoStage demo={demo} compactControls captionTestId={decorative ? undefined : "demo-caption"} /></Box>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{formatTimecode(time, preferences.fps)}</Typography>
            <Box sx={{ width: "100%" }} {...(decorative ? { "aria-hidden": true } : {})}>
              <VideoSeekBar compact currentTime={time} duration={demo.duration} fps={preferences.fps} mediaUrl={null} onSeek={demo.seek} />
            </Box>
            <Box dir={preferences.direction} aria-label="מקטעי כתוביות" sx={{ flexShrink: 0, width: "100%", overflow: "hidden", px: 3, py: 0.5 }}>
              <Box sx={{ display: "flex", gap: 1, transition: "transform .35s ease", transform: `translateX(calc(${focused} * (78% + 8px) - ${focused > 0 ? "11%" : "0px"}))` }}>
                {segments.map((segment, index) => {
                  const current = index === focused;
                  return <Button key={String(segment.id)} {...decor} aria-pressed={current} aria-label={`כתובית: ${segment.text}`} onClick={() => demo.seek(segment.start)} sx={{
                    flex: "0 0 78%", minHeight: 72, px: 1.5, py: 1, borderRadius: 2, border: 1,
                    borderColor: current ? "primary.main" : "#e0e4ea", bgcolor: current ? "#f3f7ff" : "#ffffff", color: "text.primary",
                    textTransform: "none", justifyContent: "flex-start", alignItems: "stretch", textAlign: "start",
                    "&:hover": { bgcolor: current ? "#f3f7ff" : "#f8fafc" },
                  }}>
                    <Stack spacing={0.25} sx={{ width: "100%", minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" dir="ltr" sx={{ textAlign: "start" }}>{formatTimecode(segment.start, preferences.fps)}</Typography>
                      <Typography sx={{ fontSize: 16, fontWeight: 500, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: preferences.direction }}>{segment.text}</Typography>
                    </Stack>
                  </Button>;
                })}
              </Box>
            </Box>
          </Stack>
        </Box>
        <Stack direction="row" component="nav" aria-label="מצבי עריכה" sx={{ flexShrink: 0, borderTop: 1, borderColor: "#e8edf3", bgcolor: "#ffffff", pb: 0.75, pt: 0.5 }}>
          {[
            { label: "תזמון", icon: <AccessTimeRounded />, action: undefined },
            { label: "עיצוב", icon: <SettingsRounded />, action: nextLook },
            { label: "עריכה", icon: <EditOutlined />, action: undefined },
            { label: "עוד", icon: <AddRounded />, action: undefined },
          ].map(item => <Button key={item.label} tabIndex={item.action && !decorative ? 0 : -1} aria-label={item.action ? "החלפת סגנון כתוביות" : undefined}
            onClick={item.action} sx={{ flex: 1, flexDirection: "column", color: "text.secondary", minHeight: 48, fontSize: 12 }}>{item.icon}{item.label}</Button>)}
        </Stack>
        <div className="qc-phone-home" aria-hidden="true" />
      </Box>
    </Scaled>
  </div>;
}
