import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  AccessTimeRounded,
  AddRounded,
  AutoFixHighRounded,
  CheckRounded,
  ChevronLeftRounded,
  ChevronRightRounded,
  CloseRounded,
  ContentCutRounded,
  DownloadRounded,
  EditOutlined,
  MenuRounded,
  MovieFilterRounded,
  RepeatRounded,
  SettingsRounded,
  ShareRounded,
  UndoRounded,
  SubtitlesRounded,
} from "@mui/icons-material";
import type { Segment, Word } from "../types";
import { wordsForSegment } from "../../timelineEditing.js";
import { synchronizeWords } from "../../wordAlignment.js";
import { formatTimecode } from "../utils/timecode";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { useActiveWord } from "../hooks/useActiveWord";
import { VideoPlayer } from "./VideoPlayer";
import { SubtitleTimeline, type CaptionDraft, type SubtitleTimelineProps } from "./SubtitleTimeline";

type SaveState = "idle" | "saving" | "success" | "error";
type MobileMode = "watch" | "edit" | "timing" | "style";

type BurnedVideo = { url: string; name: string };

export type MobileCaptionEditorProps = {
  timelineEditing: Pick<SubtitleTimelineProps, "onSaveSegment" | "onUndo" | "onRedo" | "canUndo" | "canRedo" | "onPlayFrom" | "loopEnabled" | "onLoopChange" | "onDraftStateChange">;
  editorSettings: ReactNode;
  mediaUrl: string | null;
  activeSegmentText: string | null;
  previewStyle: React.CSSProperties;
  editableSegments: Segment[];
  words?: Word[];
  isEditable: boolean;
  videoDuration: number | null;
  currentTime: number;
  selectedSegmentId: Segment["id"] | null;
  activeSegmentId: Segment["id"] | null;
  fontSize: number;
  fontColor: string;
  outlineColor: string;
  offsetYPercent: number;
  marginPercent: number;
  isBurning: boolean;
  burnError: string | null;
  burnedVideo: BurnedVideo | null;
  saveState: SaveState;
  downloadUrl: string | null;
  downloadName: string;
  activeWordEnabled: boolean;
  hasTimelineDrafts: boolean;
  canBurn: boolean;
  showSubtitles: boolean;
  onShowSubtitlesChange: (checked: boolean) => void;
  onVideoTimeUpdate: (nextTime: number) => void;
  onVideoLoadedMetadata: (dimensions: { width: number; height: number }, duration: number) => void;
  onVideoResize: (dimensions: { width: number; height: number }) => void;
  onTimelineSegmentsChange: (segments: Segment[]) => void;
  onTimelineTimeChange: (time: number) => void;
  onSegmentSelect: (segmentId: Segment["id"] | null) => void;
  onFontSizeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFontColorChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOutlineColorChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOffsetYChange: (event: Event, value: number | number[]) => void;
  onMarginChange: (event: Event, value: number | number[]) => void;
  onBurnVideo: (options?: { download?: boolean; reuse?: boolean }) => Promise<{ url: string; name: string } | null | void>;
  onAddSubtitle: (text: string, startTime: number, endTime: number) => void;
  onSplitSegment: (segmentId: Segment["id"], splitTime: number, draft?: CaptionDraft) => Promise<void>;
  onUndoSplit: () => Promise<void>;
  canUndoSplit: boolean;
  onToggleActiveWord: () => void;
  onAIEdit?: (instructions: string) => Promise<void>;
  isPlaying?: boolean;
  onPlayPause?: () => void;
  onBack?: () => void;
  backDisabled?: boolean;
};

export function MobileCaptionEditor({
  timelineEditing,
  editorSettings,
  mediaUrl,
  activeSegmentText,
  previewStyle,
  editableSegments,
  words = [],
  isEditable,
  videoDuration,
  currentTime,
  selectedSegmentId,
  activeSegmentId,
  fontSize,
  fontColor,
  outlineColor,
  offsetYPercent,
  marginPercent,
  isBurning,
  burnError,
  burnedVideo,
  saveState,
  downloadUrl,
  downloadName,
  activeWordEnabled,
  hasTimelineDrafts,
  canBurn,
  showSubtitles,
  onShowSubtitlesChange,
  onVideoTimeUpdate,
  onVideoLoadedMetadata,
  onVideoResize,
  onTimelineSegmentsChange,
  onTimelineTimeChange,
  onSegmentSelect,
  onFontSizeChange,
  onFontColorChange,
  onOutlineColorChange,
  onOffsetYChange,
  onMarginChange,
  onBurnVideo,
  onAddSubtitle,
  onSplitSegment,
  onUndoSplit,
  canUndoSplit,
  onToggleActiveWord,
  onAIEdit,
  isPlaying,
  onPlayPause,
  onBack,
  backDisabled,
}: MobileCaptionEditorProps) {
  const { preferences } = useEditorPreferences();
  const [mode, setMode] = useState<MobileMode>("watch");
  const [moreOpen, setMoreOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [readyToShare, setReadyToShare] = useState<{ url: string; name: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [newText, setNewText] = useState("");
  const [newStart, setNewStart] = useState(0);
  const [newEnd, setNewEnd] = useState(0);
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);
  const [chromeTop, setChromeTop] = useState(56);
  const captionStripRef = useRef<HTMLDivElement | null>(null);
  const captionCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const captionScrollTimer = useRef(0);
  const captionScrollFromCode = useRef(false);
  const captionScrollFromUser = useRef(false);
  const draftTextRef = useRef("");
  const savedTextRef = useRef("");
  const saveFlight = useRef<string | null>(null);
  const lastPersisted = useRef<string | null>(null);
  const saveQueued = useRef<{ segment: Segment; text: string; words: Word[] } | null>(null);

  const duration = videoDuration && Number.isFinite(videoDuration) ? videoDuration : Math.max(1, ...editableSegments.map(s => s.end), 1);
  const selectedIndex = editableSegments.findIndex(s => s.id === selectedSegmentId);
  const selected = selectedIndex >= 0 ? editableSegments[selectedIndex] : null;
  const captionWords = useMemo(() => selected ? wordsForSegment(words, selected) : [], [words, selected]);
  const activeWord = useActiveWord({ words: captionWords, currentTime, enabled: activeWordEnabled });
  draftTextRef.current = draftText;

  useEffect(() => {
    if (!selected) {
      setDraftText("");
      savedTextRef.current = "";
      return;
    }
    setDraftText(selected.text);
    savedTextRef.current = selected.text;
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) return;
    setDraftText(current => current.trim() === savedTextRef.current ? selected.text : current);
    savedTextRef.current = selected.text;
    const savedKey = `${selected.id}:${selected.text.trim()}`;
    if (lastPersisted.current?.startsWith(`${selected.id}:`) && lastPersisted.current !== savedKey) lastPersisted.current = savedKey;
  }, [selected?.text]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, []);

  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".MuiAppBar-root");
    const update = () => {
      const bottom = bar?.getBoundingClientRect().bottom;
      setChromeTop(bottom && bottom > 0 ? Math.round(bottom) : 56);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const goMode = (next: MobileMode) => {
    setMoreOpen(false);
    if (next === mode) {
      setMode("watch");
      return;
    }
    if (next === "edit") {
      const target = selectedSegmentId ?? activeSegmentId ?? editableSegments[0]?.id ?? null;
      if (target != null) onSegmentSelect(target);
    }
    setMode(next);
  };

  const persistCaption = async (segment: Segment, text: string, segmentWords: Word[]) => {
    const nextText = text.trim();
    if (!segment || !nextText || nextText === segment.text.trim() || !isEditable) return;
    const flightKey = `${segment.id}:${nextText}`;
    if (saveFlight.current === flightKey || lastPersisted.current === flightKey) return;
    if (saveFlight.current) {
      saveQueued.current = { segment, text: nextText, words: segmentWords };
      return;
    }
    saveFlight.current = flightKey;
    setSaving(true);
    try {
      await timelineEditing.onSaveSegment({ ...segment, text: nextText }, synchronizeWords([{ ...segment, text: nextText }], segmentWords));
      lastPersisted.current = flightKey;
    } catch {
      // The editor already shows the save error and keeps the draft.
    } finally {
      saveFlight.current = null;
      setSaving(false);
      const queued = saveQueued.current;
      saveQueued.current = null;
      if (queued && `${queued.segment.id}:${queued.text}` !== flightKey) void persistCaption(queued.segment, queued.text, queued.words);
    }
  };

  useEffect(() => {
    if (mode !== "edit" || !selected || !isEditable) return;
    const segment = selected;
    const text = draftText;
    const segmentWords = captionWords;
    if (!text.trim() || text.trim() === segment.text.trim()) return;
    const timer = window.setTimeout(() => {
      void persistCaption(segment, text, segmentWords);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [draftText, selected?.id, selected?.text, mode, isEditable]);

  useEffect(() => {
    const segment = selected;
    const segmentWords = captionWords;
    return () => {
      const text = draftTextRef.current;
      if (!segment || !text.trim() || text.trim() === segment.text.trim()) return;
      void persistCaption(segment, text, segmentWords);
    };
  }, [selected?.id]);

  const focusedSegment = editableSegments.find(segment => currentTime >= segment.start && currentTime < segment.end)
    ?? editableSegments.find(segment => segment.id === (selectedSegmentId ?? activeSegmentId))
    ?? null;

  useEffect(() => {
    if (mode !== "watch" || !focusedSegment || captionScrollFromUser.current) return;
    const card = captionCardRefs.current.get(String(focusedSegment.id));
    if (!card) return;
    captionScrollFromCode.current = true;
    card.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    const timer = window.setTimeout(() => { captionScrollFromCode.current = false; }, 700);
    return () => window.clearTimeout(timer);
  }, [mode, focusedSegment?.id]);

  const chooseCaptionFromStrip = () => {
    const strip = captionStripRef.current;
    if (!strip || captionScrollFromCode.current) return;
    const midpoint = strip.getBoundingClientRect().left + strip.getBoundingClientRect().width / 2;
    let nearest: Segment | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const segment of editableSegments) {
      const card = captionCardRefs.current.get(String(segment.id));
      if (!card) continue;
      const rect = card.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - midpoint);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = segment;
      }
    }
    if (!nearest || nearest.id === focusedSegment?.id) return;
    onSegmentSelect(nearest.id);
    onTimelineTimeChange(nearest.start);
  };

  const player = (
    <VideoPlayer
      fill
      hideMeta
      mediaUrl={mediaUrl}
      activeSegmentText={showSubtitles ? activeSegmentText : null}
      activeSegmentId={activeSegmentId}
      previewStyle={previewStyle}
      words={words}
      currentTime={currentTime}
      activeWordEnabled={activeWordEnabled}
      onTimeUpdate={onVideoTimeUpdate}
      onLoadedMetadata={onVideoLoadedMetadata}
      onResize={onVideoResize}
    />
  );

  const playerSlot = (kind: "watch" | "compact" | "edit") => (
    <Box sx={{
      flex: kind === "compact" ? "0 0 auto" : 1,
      minHeight: kind === "edit" ? 180 : 0,
      width: "100%",
      height: kind === "compact" ? "min(22dvh, 148px)" : undefined,
      maxHeight: kind === "compact" ? "min(22dvh, 148px)" : "100%",
      display: "flex",
      overflow: "hidden",
    }}>
      {player}
    </Box>
  );

  const canExport = Boolean(downloadUrl) && !hasTimelineDrafts;
  const canShareVideo = canBurn && Boolean(mediaUrl) && !hasTimelineDrafts && !isBurning && !sharing;

  const shareBurnedFile = async (file: { url: string; name: string }) => {
    const blob = await fetch(file.url).then(result => result.blob());
    const name = file.name || "video-with-captions.mp4";
    const video = new File([blob], name, { type: name.endsWith(".mp4") ? "video/mp4" : blob.type || "video/mp4" });
    if (navigator.share && navigator.canShare?.({ files: [video] })) {
      await navigator.share({ files: [video], title: "סרטון עם כתוביות" });
      return true;
    }
    return false;
  };

  const shareVideo = async () => {
    if (!canBurn || !mediaUrl || hasTimelineDrafts || isBurning || sharing) return;
    setSharing(true);
    try {
      const burned = await onBurnVideo({ download: false, reuse: true });
      if (!burned) return;
      try {
        const shared = await shareBurnedFile(burned);
        if (!shared) setReadyToShare(burned);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setReadyToShare(burned);
      }
    } finally {
      setSharing(false);
    }
  };

  const shareReadyVideo = async () => {
    if (!readyToShare) return;
    try {
      const shared = await shareBurnedFile(readyToShare);
      if (shared) {
        setReadyToShare(null);
        return;
      }
      const link = document.createElement("a");
      link.href = readyToShare.url;
      link.download = readyToShare.name;
      link.click();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  };

  return (
    <Box data-testid="mobile-caption-editor" sx={{
      position: "fixed",
      left: 0,
      right: 0,
      bottom: 0,
      top: chromeTop,
      bgcolor: "#ffffff",
      display: "flex",
      flexDirection: "column",
      width: "100%",
      minWidth: 0,
      overflow: "hidden",
      zIndex: 2,
      pb: "env(safe-area-inset-bottom, 0px)",
    }}>
      <Stack direction="row" alignItems="center" sx={{ flexShrink: 0, px: 0.5, py: 0.25, minHeight: 56, borderBottom: 1, borderColor: "#e8edf3", bgcolor: "#ffffff" }}>
        <IconButton size="small" aria-label="חזרה לצפייה" onClick={() => setMode("watch")}><ChevronRightRounded /></IconButton>
        <Typography sx={{ flex: 1, fontWeight: 500, fontSize: 15 }}>עורך כתוביות</Typography>
        <IconButton aria-label="שיתוף סרטון עם כתוביות" disabled={!canShareVideo} onClick={() => { void shareVideo(); }} sx={{ width: 48, height: 48, bgcolor: "primary.main", color: "#fff", "&:hover": { bgcolor: "primary.dark" }, "&.Mui-disabled": { bgcolor: "action.disabledBackground", color: "action.disabled" } }}>
          {isBurning || sharing ? <CircularProgress size={26} sx={{ color: "inherit" }} /> : <ShareRounded sx={{ fontSize: 30 }} />}
        </IconButton>
        <IconButton size="small" aria-label="הורדה" disabled={!canExport} {...(canExport ? { component: "a" as const, href: downloadUrl ?? undefined, download: downloadName } : {})}><DownloadRounded /></IconButton>
        <IconButton size="small" aria-label="תפריט" onClick={() => setMoreOpen(true)}><MenuRounded /></IconButton>
      </Stack>

      {burnError && <Alert severity="error" sx={{ flexShrink: 0, mx: 1.5, mt: 1 }}>{burnError}</Alert>}
      {isBurning && <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0, px: 2, py: 1 }}><CircularProgress size={18} /><Typography variant="caption">יוצר וידאו...</Typography></Stack>}

      <Box sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        boxSizing: "border-box",
        px: 1.5,
        pt: 1,
        pb: 0.5,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {mode === "watch" && (
          <Stack spacing={1} alignItems="center" sx={{ flex: 1, minHeight: 0, height: "100%" }}>
            {playerSlot("watch")}
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{formatTimecode(currentTime, preferences.fps)}</Typography>
            <Box
              dir="ltr"
              role="slider"
              aria-label="מיקום בהקלטה"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
              onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                onTimelineTimeChange(Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration)));
              }}
              sx={{ flexShrink: 0, position: "relative", width: "100%", height: 28, cursor: "pointer", display: "flex", alignItems: "center" }}
            >
              <Box sx={{ position: "relative", width: "100%", height: 6, bgcolor: "#e8edf3", borderRadius: 999 }}>
                <Box sx={{ position: "absolute", top: 0, bottom: 0, width: `${(currentTime / duration) * 100}%`, bgcolor: "primary.main", borderRadius: 999 }} />
                <Box sx={{ position: "absolute", top: "50%", width: 14, height: 14, borderRadius: "50%", bgcolor: "primary.main", transform: "translate(-50%, -50%)", left: `${(currentTime / duration) * 100}%` }} />
              </Box>
            </Box>
            {editableSegments.length > 0 && (
              <Box
                ref={captionStripRef}
                dir={preferences.direction}
                aria-label="מקטעי כתוביות"
                onScroll={() => {
                  if (captionScrollFromCode.current) return;
                  captionScrollFromUser.current = true;
                  window.clearTimeout(captionScrollTimer.current);
                  captionScrollTimer.current = window.setTimeout(() => {
                    chooseCaptionFromStrip();
                    captionScrollFromUser.current = false;
                  }, 140);
                }}
                sx={{
                  flexShrink: 0,
                  width: "100%",
                  display: "flex",
                  gap: 1,
                  overflowX: "auto",
                  scrollSnapType: "x mandatory",
                  px: 3,
                  py: 0.5,
                  touchAction: "pan-x",
                  "&::-webkit-scrollbar": { display: "none" },
                  scrollbarWidth: "none",
                }}
              >
                {editableSegments.map(segment => {
                  const active = segment.id === focusedSegment?.id;
                  return (
                    <Button
                      key={String(segment.id)}
                      ref={node => {
                        const key = String(segment.id);
                        if (node) captionCardRefs.current.set(key, node);
                        else captionCardRefs.current.delete(key);
                      }}
                      aria-pressed={active}
                      aria-label={`כתובית: ${segment.text}`}
                      onClick={() => {
                        onSegmentSelect(segment.id);
                        onTimelineTimeChange(segment.start);
                        if (segment.id === focusedSegment?.id) setMode("edit");
                      }}
                      sx={{
                        scrollSnapAlign: "center",
                        flex: "0 0 78%",
                        minHeight: 72,
                        px: 1.5,
                        py: 1,
                        borderRadius: 2,
                        border: 1,
                        borderColor: active ? "primary.main" : "#e0e4ea",
                        bgcolor: active ? "#f3f7ff" : "#ffffff",
                        color: "text.primary",
                        textTransform: "none",
                        justifyContent: "flex-start",
                        alignItems: "stretch",
                        textAlign: "start",
                        "&:hover": { bgcolor: active ? "#f3f7ff" : "#f8fafc" },
                      }}
                    >
                      <Stack spacing={0.25} sx={{ width: "100%", minWidth: 0 }}>
                        <Typography variant="caption" color="text.secondary" dir="ltr" sx={{ textAlign: "start" }}>{formatTimecode(segment.start, preferences.fps)}</Typography>
                        <Typography sx={{
                          fontSize: 16,
                          fontWeight: 500,
                          lineHeight: 1.35,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          direction: preferences.direction,
                        }}>{segment.text}</Typography>
                      </Stack>
                    </Button>
                  );
                })}
              </Box>
            )}
          </Stack>
        )}

        {mode === "edit" && (
          <Stack spacing={1} sx={{ minWidth: 0, width: "100%", flex: 1, minHeight: 0, height: "100%", overflow: "hidden" }}>
            {playerSlot("edit")}
            {selected && <Stack spacing={1} sx={{ flexShrink: 0, minHeight: 0, maxHeight: "48%", overflow: "auto" }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexShrink: 0 }}>
              <IconButton aria-label="המקטע הקודם" disabled={selectedIndex <= 0} onClick={() => onSegmentSelect(editableSegments[selectedIndex - 1].id)}><ChevronLeftRounded /></IconButton>
              <Typography variant="body2" color="text.secondary">מקטע {selectedIndex + 1} מתוך {editableSegments.length}</Typography>
              <IconButton aria-label="המקטע הבא" disabled={selectedIndex >= editableSegments.length - 1} onClick={() => onSegmentSelect(editableSegments[selectedIndex + 1].id)}><ChevronRightRounded /></IconButton>
            </Stack>
            <TextField
              label="טקסט המקטע"
              multiline
              minRows={1}
              maxRows={3}
              fullWidth
              value={draftText}
              disabled={!isEditable}
              onBlur={() => { if (selected) void persistCaption(selected, draftText, captionWords); }}
              onChange={event => setDraftText(event.target.value)}
              inputProps={{ dir: preferences.direction, "aria-label": "טקסט המקטע" }}
              sx={{ maxWidth: "100%" }}
            />
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="caption" color="text.secondary" dir="ltr">{formatTimecode(selected.start, preferences.fps)}</Typography>
              <Typography variant="caption" color="text.secondary" dir="ltr">{formatTimecode(selected.end, preferences.fps)}</Typography>
            </Stack>
            {captionWords.length > 0 && (
              <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75} aria-label="מילים במקטע">
                {captionWords.map((word, index) => {
                  const active = Boolean(activeWord && Math.abs(activeWord.start - word.start) < 0.001);
                  return (
                    <Button key={`${word.start}-${index}`} size="small" onClick={() => onTimelineTimeChange(word.start)}
                      sx={{ minWidth: 0, bgcolor: active ? "primary.main" : "#9b5700", color: "#fff", borderRadius: 999, px: 1.25, "&:hover": { bgcolor: active ? "primary.dark" : "#7a4500" } }}>
                      {word.word}
                    </Button>
                  );
                })}
              </Stack>
            )}
            <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
              <Button variant="contained" onClick={() => void persistCaption(selected, draftText, captionWords)} disabled={!isEditable || saving || saveState === "saving" || !draftText.trim() || draftText.trim() === selected.text.trim()}>{saving || saveState === "saving" ? "שומר…" : draftText.trim() === selected.text.trim() ? "נשמר" : "שמור"}</Button>
              <Button variant="outlined" startIcon={<RepeatRounded />} aria-pressed={timelineEditing.loopEnabled} onClick={() => timelineEditing.onLoopChange(!timelineEditing.loopEnabled)}>נגן בלולאה</Button>
              <Button variant="outlined" startIcon={<ContentCutRounded />} disabled={!isEditable || saveState === "saving" || draftText.trim().split(/\s+/).length < 2 || currentTime <= selected.start || currentTime >= selected.end} onClick={() => { void persistCaption(selected, draftText, captionWords).then(() => onSplitSegment(selected.id, currentTime)); }}>פצל</Button>
              {canUndoSplit && <Button variant="outlined" startIcon={<UndoRounded />} disabled={!isEditable || saveState === "saving"} onClick={() => void onUndoSplit()}>בטל פיצול</Button>}
            </Stack>
            </Stack>}
            {!selected && <Typography color="text.secondary" sx={{ flexShrink: 0 }}>אין מקטעים לעריכה.</Typography>}
          </Stack>
        )}

        {mode === "timing" && (
          <Stack spacing={1} sx={{ flex: 1, minHeight: 0, height: "100%" }}>
            {playerSlot("compact")}
            <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <SubtitleTimeline
                layout="timing"
                activeWordEnabled={activeWordEnabled}
                {...timelineEditing}
                mediaUrl={mediaUrl}
                busy={saveState === "saving"}
                segments={editableSegments}
                disabled={!isEditable}
                duration={videoDuration}
                currentTime={currentTime}
                onRequestTimeChange={onTimelineTimeChange}
                onSegmentsChange={onTimelineSegmentsChange}
                selectedSegmentId={selectedSegmentId}
                onSegmentSelect={onSegmentSelect}
                onSplitSegment={onSplitSegment}
                isPlaying={isPlaying}
                onPlayPause={onPlayPause}
                words={words}
              />
            </Box>
          </Stack>
        )}

        {mode === "style" && (
          <Stack spacing={1} sx={{ flex: 1, minHeight: 0, height: "100%" }}>
            {playerSlot("compact")}
            <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1.5, pb: 2, border: 1, borderColor: "#e0e4ea", borderRadius: 2, bgcolor: "#ffffff" }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography fontWeight={500}>עיצוב כתוביות</Typography>
                <IconButton aria-label="סגירת עיצוב" onClick={() => setMode("watch")}><CheckRounded /></IconButton>
              </Stack>
              <FormControl fullWidth size="small" sx={{ my: 1.5 }}>
                <InputLabel>גודל פונט</InputLabel>
                <Select value={fontSize} label="גודל פונט" onChange={event => onFontSizeChange({ target: { value: String(event.target.value) } } as ChangeEvent<HTMLInputElement>)}>
                  {[24, 32, 40, 48, 56, 64, 72, 80, 96].map(size => <MenuItem key={size} value={size}>{size}</MenuItem>)}
                </Select>
              </FormControl>
              <Stack direction="row" spacing={1} sx={{ my: 1.5 }}>
                <TextField label="צבע טקסט" type="color" value={fontColor} onChange={onFontColorChange} fullWidth size="small" InputLabelProps={{ shrink: true }} />
                <TextField label="צבע מסגרת" type="color" value={outlineColor} onChange={onOutlineColorChange} fullWidth size="small" InputLabelProps={{ shrink: true }} />
              </Stack>
              <Typography variant="body2" sx={{ mt: 1 }}>מיקום</Typography>
              <Slider value={offsetYPercent} onChange={onOffsetYChange} min={0} max={100} valueLabelDisplay="auto" />
              <Typography variant="body2">שוליים</Typography>
              <Slider value={marginPercent} onChange={onMarginChange} min={0} max={40} valueLabelDisplay="auto" />
              <FormControlLabel control={<Switch checked={activeWordEnabled} onChange={onToggleActiveWord} />} label="מילה אקטיבית" />
              <FormControlLabel control={<Switch checked={showSubtitles} onChange={(_, checked) => onShowSubtitlesChange(checked)} />} label="הצג כתוביות בתצוגה המקדימה" />
            </Box>
          </Stack>
        )}
      </Box>

      <Stack direction="row" component="nav" aria-label="מצבי עריכה" sx={{ flexShrink: 0, borderTop: 1, borderColor: "#e8edf3", bgcolor: "#ffffff", pb: 0.75, pt: 0.5, zIndex: 8, position: "relative" }}>
        {[
          { id: "timing" as const, label: "תזמון", icon: <AccessTimeRounded /> },
          { id: "style" as const, label: "עיצוב", icon: <SettingsRounded /> },
          { id: "edit" as const, label: "עריכה", icon: <EditOutlined /> },
        ].map(item => (
          <Button key={item.id} onClick={() => goMode(item.id)} sx={{ flex: 1, flexDirection: "column", color: mode === item.id ? "primary.main" : "text.secondary", minHeight: 48, fontSize: 12 }}>
            {item.icon}
            {item.label}
          </Button>
        ))}
        <Button onClick={() => setMoreOpen(true)} sx={{ flex: 1, flexDirection: "column", color: "text.secondary", minHeight: 48, fontSize: 12 }}>
          <AddRounded />
          עוד
        </Button>
      </Stack>

      <Drawer anchor="bottom" open={moreOpen} onClose={() => setMoreOpen(false)} slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, bgcolor: "#ffffff" } } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, pt: 1.5 }}>
          <Typography fontWeight={500}>עוד פעולות</Typography>
          <IconButton aria-label="סגירה" onClick={() => setMoreOpen(false)}><CloseRounded /></IconButton>
        </Stack>
        <List>
          <ListItemButton disabled={!canShareVideo} onClick={() => { setMoreOpen(false); void shareVideo(); }}>
            <ListItemIcon><ShareRounded /></ListItemIcon>
            <ListItemText primary="שתף סרטון עם כתוביות" secondary={canBurn ? "וואטסאפ, מסנג'ר, הודעות ועוד" : "צריבה זמינה לקובץ וידאו בלבד"} />
          </ListItemButton>
          <ListItemButton component="a" href={downloadUrl ?? undefined} download={downloadName} disabled={!downloadUrl || hasTimelineDrafts} onClick={() => setMoreOpen(false)}>
            <ListItemIcon><SubtitlesRounded /></ListItemIcon>
            <ListItemText primary="הורד קובץ כתוביות" />
          </ListItemButton>
          <ListItemButton disabled={isBurning || !mediaUrl || !canBurn || hasTimelineDrafts} onClick={() => { setMoreOpen(false); onBurnVideo(); }}>
            <ListItemIcon><MovieFilterRounded /></ListItemIcon>
            <ListItemText primary={canBurn ? "הורד סרטון עם כתוביות" : "צריבה זמינה לקובץ וידאו בלבד"} />
          </ListItemButton>
          {burnedVideo && (
            <ListItemButton component="a" href={burnedVideo.url} download={burnedVideo.name} onClick={() => setMoreOpen(false)}>
              <ListItemIcon><DownloadRounded /></ListItemIcon>
              <ListItemText primary="הורד סרטון צרוב מוכן" />
            </ListItemButton>
          )}
          <ListItemButton disabled={hasTimelineDrafts} onClick={() => { setMoreOpen(false); setNewText(""); setNewStart(currentTime); setNewEnd(currentTime + 2); setAddOpen(true); }}>
            <ListItemIcon><AddRounded /></ListItemIcon>
            <ListItemText primary="הוסף כתובית" />
          </ListItemButton>
          {onAIEdit && (
            <ListItemButton disabled={hasTimelineDrafts} onClick={() => { setMoreOpen(false); setAiOpen(true); }}>
              <ListItemIcon><AutoFixHighRounded /></ListItemIcon>
              <ListItemText primary="עריכה עם AI" />
            </ListItemButton>
          )}
          <ListItemButton onClick={() => { setMoreOpen(false); setSettingsOpen(true); }}>
            <ListItemIcon><SettingsRounded /></ListItemIcon>
            <ListItemText primary="הגדרות כתוביות" />
          </ListItemButton>
          {onBack && (
            <ListItemButton disabled={backDisabled} onClick={() => { setMoreOpen(false); onBack(); }}>
              <ListItemIcon><ChevronRightRounded /></ListItemIcon>
              <ListItemText primary="העלאת סרטון או אודיו אחר" />
            </ListItemButton>
          )}
        </List>
      </Drawer>

      <Dialog open={Boolean(readyToShare)} onClose={() => setReadyToShare(null)} fullWidth>
        <DialogTitle>הסרטון מוכן לשיתוף</DialogTitle>
        <DialogContent>
          <Typography>אפשר לשלוח אותו לוואטסאפ, למסנג'ר, להודעות ולשאר האפליקציות בטלפון.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReadyToShare(null)}>סגור</Button>
          <Button variant="contained" size="large" startIcon={<ShareRounded />} onClick={() => void shareReadyVideo()}>שתף</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth>
        <DialogTitle>הגדרות כתוביות</DialogTitle>
        <DialogContent>{editorSettings}</DialogContent>
        <DialogActions><Button onClick={() => setSettingsOpen(false)}>סגור</Button></DialogActions>
      </Dialog>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth>
        <DialogTitle>הוסף כתובית חדשה</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="טקסט הכתובית" multiline rows={3} value={newText} onChange={event => setNewText(event.target.value)} fullWidth autoFocus />
            <TextField label="זמן התחלה (שניות)" type="number" value={newStart} onChange={event => setNewStart(Number(event.target.value))} inputProps={{ min: 0, step: 0.1 }} />
            <TextField label="זמן סיום (שניות)" type="number" value={newEnd} onChange={event => setNewEnd(Number(event.target.value))} inputProps={{ min: 0, step: 0.1 }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>ביטול</Button>
          <Button variant="contained" disabled={!newText.trim() || newEnd <= newStart} onClick={() => { onAddSubtitle(newText.trim(), newStart, newEnd); setAddOpen(false); }}>הוסף</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={aiOpen} onClose={() => setAiOpen(false)} fullWidth>
        <DialogTitle>עריכת כתוביות עם AI</DialogTitle>
        <DialogContent>
          <TextField label="מה לעשות?" multiline rows={4} value={aiInstructions} onChange={event => setAiInstructions(event.target.value)} fullWidth sx={{ mt: 1 }} placeholder="לדוגמה: תפצל כתוביות ארוכות, תתקן שגיאות כתיב" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiOpen(false)}>ביטול</Button>
          <Button variant="contained" disabled={aiBusy || !aiInstructions.trim() || !onAIEdit} onClick={async () => {
            if (!onAIEdit) return;
            setAiBusy(true);
            try { await onAIEdit(aiInstructions.trim()); setAiOpen(false); setAiInstructions(""); }
            finally { setAiBusy(false); }
          }}>{aiBusy ? "AI מעבד..." : "בצע עריכה"}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
