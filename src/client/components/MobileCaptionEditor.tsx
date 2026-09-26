import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
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
import { VideoPlayer } from "./VideoPlayer";
import { type CaptionDraft, type SubtitleTimelineProps } from "./SubtitleTimeline";
import { MobileTimingTimeline } from "./MobileTimingTimeline";
import { MobileWordTimeline } from "./MobileWordTimeline";
import { MobileWordTimelineDialog } from "./MobileWordTimelineDialog";

type SaveState = "idle" | "saving" | "success" | "error";
type MobileMode = "watch" | "edit" | "timing";

type BurnedVideo = { url: string; name: string };

const STYLE_DRAWER_HEIGHT = "min(36dvh, 306px)";

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
  onTimelineSegmentsChange: (segments: Segment[], options?: { fitWords?: boolean }) => void | Promise<void>;
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
  onMyVideos: () => void;
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
  onMyVideos,
  backDisabled,
}: MobileCaptionEditorProps) {
  const { preferences } = useEditorPreferences();
  const [mode, setMode] = useState<MobileMode>("watch");
  const [styleOpen, setStyleOpen] = useState(false);
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
  const [draftError, setDraftError] = useState<string | null>(null);
  const [wordDraft, setWordDraft] = useState<Word[] | null>(null);
  const [timingWordsId, setTimingWordsId] = useState<Segment["id"] | null>(null);
  const wordDraftRef = useRef<Word[] | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [chromeTop, setChromeTop] = useState(56);
  const captionStripRef = useRef<HTMLDivElement | null>(null);
  const captionCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const captionScrollTimer = useRef(0);
  const captionScrollFromCode = useRef(false);
  const captionScrollFromUser = useRef(false);
  const draftTextRef = useRef("");
  const savedTextRef = useRef("");
  const saveFlight = useRef<{ key: string; promise: Promise<boolean> } | null>(null);
  const saveSegmentRef = useRef(timelineEditing.onSaveSegment);
  saveSegmentRef.current = timelineEditing.onSaveSegment;
  const destinationsRef = useRef({ onMyVideos, onBack });
  destinationsRef.current = { onMyVideos, onBack };
  const splitSegmentRef = useRef(onSplitSegment);
  splitSegmentRef.current = onSplitSegment;
  const loopChangeRef = useRef(timelineEditing.onLoopChange);
  loopChangeRef.current = timelineEditing.onLoopChange;

  // A loop belongs only to this editing view, including across responsive
  // layout changes or replacing the loaded video.
  useEffect(() => () => loopChangeRef.current(false), [mode, mediaUrl]);
  useEffect(() => { setTimingWordsId(null); }, [mode, mediaUrl]);

  const duration = videoDuration && Number.isFinite(videoDuration) ? videoDuration : Math.max(1, ...editableSegments.map(s => s.end), 1);
  const selectedIndex = editableSegments.findIndex(s => s.id === selectedSegmentId);
  const selected = selectedIndex >= 0 ? editableSegments[selectedIndex] : null;
  const timingWordsSegment = editableSegments.find(segment => segment.id === timingWordsId);
  const captionWords = useMemo(() => selected ? wordsForSegment(words, selected) : [], [words, selected]);
  const editingWords = wordDraft ?? captionWords;
  draftTextRef.current = draftText;

  useEffect(() => {
    wordDraftRef.current = null;
    setWordDraft(null);
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
    // Optimistic parent updates and their rollback must not overwrite the local draft.
    if (saveFlight.current) return;
    setDraftText(current => current.trim() === savedTextRef.current ? selected.text : current);
    savedTextRef.current = selected.text;
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

  const goMode = async (next: MobileMode | "style") => {
    if (!await flushDraft()) return;
    setMoreOpen(false);
    if (next === "style") {
      setMode("watch");
      setStyleOpen(open => !open);
      return;
    }
    setStyleOpen(false);
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

  const persistCaption = async (segment: Segment, text: string, segmentWords: Word[]): Promise<boolean> => {
    const nextText = text.trim();
    if (!isEditable) return true;
    if (!nextText) { setDraftError("הכתובית ריקה. הקלידו טקסט לפני היציאה."); return false; }
    // Text saves regenerate word alignment optimistically. Only explicit timing
    // drafts belong in the key, so blur and navigation still await one save.
    const flightKey = `${segment.id}:${nextText}:${wordDraftRef.current ? JSON.stringify(segmentWords) : ""}`;
    while (saveFlight.current) {
      const flight = saveFlight.current;
      const saved = await flight.promise;
      if (flight.key === flightKey) return saved;
    }
    if (nextText === segment.text.trim() && !wordDraftRef.current && !draftError) return true;
    setSavingDraft(true);
    setDraftError(null);
    const promise = (async () => {
      try {
        await saveSegmentRef.current({ ...segment, text: nextText }, synchronizeWords([{ ...segment, text: nextText }], segmentWords));
        savedTextRef.current = nextText;
        if (wordDraftRef.current === segmentWords) { wordDraftRef.current = null; setWordDraft(null); }
        return true;
      } catch {
        setDraftError("שמירת הכתובית נכשלה. השינויים נשארו כאן; נסו לשמור שוב.");
        return false;
      } finally {
        saveFlight.current = null;
        setSavingDraft(false);
      }
    })();
    saveFlight.current = { key: flightKey, promise };
    return promise;
  };

  const flushDraft = () => mode === "edit" && selected
    ? persistCaption(selected, draftTextRef.current, wordDraftRef.current ?? captionWords)
    : Promise.resolve(true);
  const leave = async (destination: "onMyVideos" | "onBack") => {
    setLeaving(true);
    try { if (await flushDraft()) { loopChangeRef.current(false); destinationsRef.current[destination]?.(); } }
    finally { setLeaving(false); }
  };
  const selectCaption = async (id: Segment["id"]) => {
    if (await flushDraft()) onSegmentSelect(id);
  };
  const openMore = async () => {
    if (await flushDraft()) { loopChangeRef.current(false); setMoreOpen(true); }
  };

  useEffect(() => {
    if (mode !== "edit" || !selected || !isEditable || draftError) return;
    const segment = selected;
    const text = draftText;
    const segmentWords = wordDraftRef.current ?? captionWords;
    if (!text.trim() || text.trim() === segment.text.trim()) return;
    const timer = window.setTimeout(() => {
      void persistCaption(segment, text, segmentWords);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [draftText, selected?.id, selected?.text, mode, isEditable, draftError]);

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

  const playerSlot = (kind: "watch" | "edit") => (
    <Box sx={{
      flex: 1,
      minHeight: kind === "edit" ? 120 : 0,
      width: "100%",
      maxHeight: "100%",
      display: "flex",
      overflow: "hidden",
    }}>
      {player}
    </Box>
  );

  const hasCaptionDraft = mode === "edit" && selected !== null && (draftText.trim() !== selected.text.trim() || wordDraft !== null);
  const canShareVideo = canBurn && Boolean(mediaUrl) && !hasTimelineDrafts && !hasCaptionDraft && !savingDraft && !isBurning && !sharing;

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
        <ButtonBase onClick={() => void leave("onMyVideos")} disabled={backDisabled || leaving} sx={{ flex: 1, minHeight: 44, justifyContent: "flex-start", fontWeight: 500, fontSize: 15, color: "text.primary", minWidth: 0 }}>
          <ChevronLeftRounded data-testid="my-videos-back-arrow" sx={{ width: 44, height: 44, p: 1.25, flexShrink: 0 }} />
          לסרטונים שלי
        </ButtonBase>
        <IconButton size="small" aria-label="שיתוף סרטון עם כתוביות" disabled={!canShareVideo} onClick={() => { void shareVideo(); }} sx={{ width: 44, height: 44, bgcolor: "primary.main", color: "#fff", "&:hover": { bgcolor: "primary.dark" }, "&.Mui-disabled": { bgcolor: "action.disabledBackground", color: "action.disabled" } }}>
          {isBurning || sharing ? <CircularProgress size={20} sx={{ color: "inherit" }} /> : <ShareRounded />}
        </IconButton>
        <IconButton size="small" aria-label="תפריט" onClick={() => void openMore()} sx={{ width: 44, height: 44 }}><MenuRounded /></IconButton>
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
        pb: styleOpen ? `calc(${STYLE_DRAWER_HEIGHT} - 60px)` : 0.5,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {mode === "watch" && (
          <Stack spacing={1} alignItems="center" sx={{ flex: 1, minHeight: 0, height: "100%" }}>
            {playerSlot("watch")}
            {!styleOpen && <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{formatTimecode(currentTime, preferences.fps)}</Typography>}
            {!styleOpen && <>
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
            </>}
          </Stack>
        )}

        {mode === "edit" && (
          <Stack spacing={1} sx={{ minWidth: 0, width: "100%", flex: 1, minHeight: 0, height: "100%", overflow: "hidden" }}>
            {playerSlot("edit")}
            {selected && <Stack spacing={1} sx={{ flexShrink: 0, minHeight: 0, maxHeight: "64%", overflow: "auto" }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexShrink: 0 }}>
              <IconButton aria-label="המקטע הקודם" disabled={selectedIndex <= 0 || leaving} onClick={() => void selectCaption(editableSegments[selectedIndex - 1].id)}><ChevronLeftRounded /></IconButton>
              <Typography variant="body2" color="text.secondary">מקטע {selectedIndex + 1} מתוך {editableSegments.length}</Typography>
              <IconButton aria-label="המקטע הבא" disabled={selectedIndex >= editableSegments.length - 1 || leaving} onClick={() => void selectCaption(editableSegments[selectedIndex + 1].id)}><ChevronRightRounded /></IconButton>
            </Stack>
            <TextField
              label="טקסט המקטע"
              multiline
              minRows={1}
              maxRows={3}
              fullWidth
              value={draftText}
              disabled={!isEditable || leaving}
              onBlur={() => { if (selected) void persistCaption(selected, draftText, wordDraftRef.current ?? captionWords); }}
              onChange={event => { setDraftText(event.target.value); setDraftError(null); }}
              inputProps={{ dir: preferences.direction, "aria-label": "טקסט המקטע" }}
              sx={{ maxWidth: "100%" }}
            />
            {draftError && <Alert severity="error" action={<Button onClick={() => void flushDraft()}>שמירה חוזרת</Button>}>{draftError}</Alert>}
            {editingWords.length > 0 && <MobileWordTimeline key={selected.id}
              segment={selected} words={editingWords} fps={preferences.fps} currentTime={currentTime} activeWordEnabled={activeWordEnabled}
              disabled={!isEditable || leaving || savingDraft || saveState === "saving" || draftText.trim() !== selected.text.trim()} saving={savingDraft}
              onInteract={() => { loopChangeRef.current(false); if (isPlaying) onPlayPause?.(); }}
              onSeek={onTimelineTimeChange}
              onChange={nextWords => {
                wordDraftRef.current = nextWords;
                setWordDraft(nextWords);
                void persistCaption(selected, draftTextRef.current, nextWords);
              }}
              onUndo={timelineEditing.onUndo} onRedo={timelineEditing.onRedo}
              canUndo={timelineEditing.canUndo && !wordDraft} canRedo={timelineEditing.canRedo && !wordDraft}
            />}
            <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
              <Button variant={timelineEditing.loopEnabled ? "contained" : "outlined"} startIcon={<RepeatRounded />} aria-pressed={timelineEditing.loopEnabled} onClick={() => timelineEditing.onLoopChange(!timelineEditing.loopEnabled)}>{timelineEditing.loopEnabled ? "לולאה פעילה · כיבוי" : "לולאה כבויה · הפעלה"}</Button>
              <Button variant="outlined" startIcon={<ContentCutRounded />} disabled={!isEditable || savingDraft || saveState === "saving" || draftText.trim().split(/\s+/).length < 2 || currentTime <= selected.start || currentTime >= selected.end} onClick={() => { void flushDraft().then(saved => { if (saved) return splitSegmentRef.current(selected.id, currentTime); }); }}>פצל</Button>
              {canUndoSplit && <Button variant="outlined" startIcon={<UndoRounded />} disabled={!isEditable || saveState === "saving"} onClick={() => void onUndoSplit()}>בטל פיצול</Button>}
            </Stack>
            </Stack>}
            {!selected && <Typography color="text.secondary" sx={{ flexShrink: 0 }}>אין מקטעים לעריכה.</Typography>}
          </Stack>
        )}

        {mode === "timing" && (
          <Stack spacing={0.5} sx={{ flex: 1, minHeight: 0, height: "100%" }}>
            <Box sx={{ flex: "7 1 0", minWidth: 0, minHeight: 0, width: "100%", display: "flex", overflow: "hidden" }}>
              {player}
            </Box>
            {/* Keep room for four caption lines, timestamps, and touch handles. */}
            <Box sx={{ flex: "3 1 0", minWidth: 0, minHeight: 248, width: "100%", display: "flex", overflow: "hidden" }}>
            <MobileTimingTimeline
              mediaUrl={mediaUrl}
              segments={editableSegments}
              words={words}
              disabled={!isEditable}
              duration={videoDuration}
              currentTime={currentTime}
              onRequestTimeChange={onTimelineTimeChange}
              onSegmentsChange={onTimelineSegmentsChange}
              selectedSegmentId={selectedSegmentId}
              onSegmentSelect={onSegmentSelect}
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              onUndo={timelineEditing.onUndo}
              onRedo={timelineEditing.onRedo}
              canUndo={timelineEditing.canUndo}
              canRedo={timelineEditing.canRedo}
              onEditWords={id => {
                loopChangeRef.current(false);
                if (isPlaying) onPlayPause?.();
                onSegmentSelect(id);
                const segment = editableSegments.find(item => item.id === id);
                if (segment) onTimelineTimeChange(segment.start);
                setTimingWordsId(id);
              }}
            />
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
          <Button key={item.id} onClick={() => goMode(item.id)} sx={{ flex: 1, flexDirection: "column", color: (item.id === "style" ? styleOpen : mode === item.id) ? "primary.main" : "text.secondary", minHeight: 48, fontSize: 12 }}>
            {item.icon}
            {item.label}
          </Button>
        ))}
        <Button onClick={() => void openMore()} sx={{ flex: 1, flexDirection: "column", color: "text.secondary", minHeight: 48, fontSize: 12 }}>
          <AddRounded />
          עוד
        </Button>
      </Stack>

      {mode === "timing" && timingWordsSegment && <MobileWordTimelineDialog key={timingWordsSegment.id}
        segment={timingWordsSegment} words={wordsForSegment(words, timingWordsSegment)} fps={preferences.fps} currentTime={currentTime}
        activeWordEnabled={activeWordEnabled} disabled={!isEditable || saveState === "saving"}
        onSave={nextWords => saveSegmentRef.current(timingWordsSegment, nextWords)}
        onClose={() => setTimingWordsId(null)} onSeek={onTimelineTimeChange}
        onInteract={() => loopChangeRef.current(false)}
        onUndo={timelineEditing.onUndo} onRedo={timelineEditing.onRedo} canUndo={timelineEditing.canUndo} canRedo={timelineEditing.canRedo}
        onDraftStateChange={timelineEditing.onDraftStateChange}
      />}

      <Drawer
        variant="persistent"
        anchor="bottom"
        open={styleOpen}
        onClose={() => setStyleOpen(false)}
        slotProps={{ paper: { role: "region", "aria-label": "עיצוב כתוביות", dir: "rtl", sx: {
          height: STYLE_DRAWER_HEIGHT,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          bgcolor: "#ffffff",
          boxShadow: "0 -6px 24px rgba(15, 23, 42, 0.16)",
          overflow: "hidden",
          "& .MuiTypography-root, & .MuiInputBase-root, & .MuiInputLabel-root": { fontSize: "0.9rem" },
          "& .MuiTypography-body2": { fontSize: "0.7875rem" },
          "& .MuiOutlinedInput-root": { height: 36 },
          "& .MuiInputBase-input": { minWidth: 0, px: 1.575, py: "7.65px" },
          "& input[type=color]": { width: "100%", height: "100%", boxSizing: "border-box" },
          "& .MuiSlider-root": { height: 3.6, py: "11.7px" },
          "& .MuiSlider-thumb": { width: 18, height: 18 },
          "& .MuiSlider-valueLabel": { fontSize: "0.7875rem" },
          "& .MuiFormControlLabel-root": { minHeight: 36, ml: "-9.9px", mr: "14.4px" },
          "& .MuiSwitch-root": { width: 52.2, height: 34.2, p: "10.8px" },
          "& .MuiSwitch-switchBase": { p: "8.1px", "&.Mui-checked": { transform: "translateX(18px)" } },
          "& .MuiSwitch-thumb": { width: 18, height: 18 },
        } } }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.8, pt: 0.9, pb: 0.45, flexShrink: 0 }}>
          <Typography fontWeight={500}>עיצוב כתוביות</Typography>
          <IconButton aria-label="סגירת עיצוב" onClick={() => setStyleOpen(false)} sx={{ p: 0.9 }}><CheckRounded sx={{ fontSize: 21.6 }} /></IconButton>
        </Stack>
        <Box sx={{ px: 1.8, pb: "max(14.4px, env(safe-area-inset-bottom, 0px))", overflowY: "auto", minHeight: 0 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 0.9, my: 1.35, "& > *": { minWidth: 0 } }}>
            <FormControl fullWidth size="small">
              <InputLabel id="mobile-caption-font-size">גודל פונט</InputLabel>
              <Select labelId="mobile-caption-font-size" value={fontSize} label="גודל פונט" onChange={event => onFontSizeChange({ target: { value: String(event.target.value) } } as ChangeEvent<HTMLInputElement>)}>
                {[24, 32, 40, 48, 56, 60, 64, 72, 80, 96].map(size => <MenuItem key={size} value={size} sx={{ fontSize: "0.9rem" }}>{size}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="צבע טקסט" type="color" value={fontColor} onChange={onFontColorChange} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="צבע מסגרת" type="color" value={outlineColor} onChange={onOutlineColorChange} fullWidth size="small" InputLabelProps={{ shrink: true }} />
          </Box>
          <Typography variant="body2" sx={{ mt: 0.9 }}>מיקום</Typography>
          <Slider aria-label="מיקום הכתובית" value={offsetYPercent} onChange={onOffsetYChange} min={0} max={100} valueLabelDisplay="auto" />
          <Typography variant="body2">שוליים</Typography>
          <Slider aria-label="שולי הכתובית" value={marginPercent} onChange={onMarginChange} min={0} max={40} valueLabelDisplay="auto" />
          <FormControlLabel control={<Switch checked={activeWordEnabled} onChange={onToggleActiveWord} />} label="מילה אקטיבית" />
          <FormControlLabel control={<Switch checked={showSubtitles} onChange={(_, checked) => onShowSubtitlesChange(checked)} />} label="הצג כתוביות בתצוגה המקדימה" />
        </Box>
      </Drawer>

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
            <ListItemButton disabled={backDisabled || leaving} onClick={() => { setMoreOpen(false); void leave("onBack"); }}>
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
