import { useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { VideoSeekBar } from "./VideoSeekBar";
import { CaptionFontPicker } from "./CaptionFontPicker";
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
  Paper,
  Snackbar,
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
  MovieFilterRounded,
  RepeatRounded,
  SettingsRounded,
  ShareRounded,
  UndoRounded,
  SubtitlesRounded,
  DeleteOutlineRounded,
  JoinFullRounded,
} from "@mui/icons-material";
import type { Segment, Word } from "../types";
import { wordsForSegment } from "../../timelineEditing.js";
import { canMergeCaptions, canSplitCaptionAtTime, type CaptionBatchAction } from "../../captionBatchEditing.js";
import { AUTO_CAPTION_FONT_SIZE, CAPTION_FONT_SIZES, type CaptionFontSizeSetting } from "../../captionStyle.js";
import type { CaptionMotion, PopIntensity } from "../../captionMotion.js";
import { synchronizeWords } from "../../wordAlignment.js";
import { formatTimecode } from "../utils/timecode";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { VideoPlayer } from "./VideoPlayer";
import { type CaptionDraft, type SubtitleTimelineProps } from "./SubtitleTimeline";
import { MobileTimingTimeline } from "./MobileTimingTimeline";
import { MobileWordTimeline } from "./MobileWordTimeline";
import { MobileWordTimelineDialog } from "./MobileWordTimelineDialog";
import { useEditorHeaderActions } from "../contexts/EditorHeaderContext";
import { useVideoSharing } from "../hooks/useVideoSharing";
import { VideoShareDialog } from "./VideoShareDialog";
import { EditorNavigationContext, type EditorNavigationGuard } from "../contexts/EditorNavigationContext";
import { MOBILE_APP_HEADER_HEIGHT, MOBILE_EDITOR_NAV_HEIGHT } from "../utils/appLayout";

type SaveState = "idle" | "saving" | "success" | "error";
type MobileMode = "watch" | "edit" | "timing";

type BurnedVideo = { url: string; name: string };

const STYLE_DRAWER_HEIGHT = "80dvh";

export type MobileCaptionEditorProps = {
  onNavigateAway: EditorNavigationGuard;
  timelineEditing: Pick<SubtitleTimelineProps, "onSaveSegment" | "onUndo" | "onRedo" | "canUndo" | "canRedo" | "onPlayFrom" | "loopEnabled" | "onLoopChange" | "onDraftStateChange">;
  editorSettings: ReactNode;
  captionStyles?: ReactNode;
  fontId?: string;
  onFontChange?: (id: string) => void;
  activeWordColor?: string;
  onActiveWordColorChange?: (color: string) => void;
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
  fontSize: CaptionFontSizeSetting;
  autoFontSize: number;
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
  captionMotion?: CaptionMotion;
  popIntensity?: PopIntensity;
  hasTimelineDrafts: boolean;
  canBurn: boolean;
  fontReady?: boolean;
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
  onCaptionBatch: (ids: Segment["id"][], action: CaptionBatchAction, splitTime?: number) => Promise<void>;
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
  onNavigateAway,
  timelineEditing,
  editorSettings,
  captionStyles, fontId, onFontChange, activeWordColor, onActiveWordColorChange,
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
  autoFontSize,
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
  captionMotion,
  popIntensity,
  hasTimelineDrafts,
  canBurn,
  fontReady = true,
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
  onCaptionBatch,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [newText, setNewText] = useState("");
  const [newStart, setNewStart] = useState(0);
  const [newEnd, setNewEnd] = useState(0);
  const [draftText, setDraftText] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [wordDraft, setWordDraft] = useState<Word[] | null>(null);
  const [timingWordsId, setTimingWordsId] = useState<Segment["id"] | null>(null);
  const [checkedIds, setCheckedIds] = useState<Segment["id"][]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchFlight = useRef(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const selectionMode = mode === "timing" && checkedIds.length > 0;
  const singleChecked = checkedIds.length === 1 ? editableSegments.find(segment => segment.id === checkedIds[0]) : undefined;
  const canSplitChecked = canSplitCaptionAtTime(singleChecked, currentTime);
  const splitHint = singleChecked && !canSplitChecked
    ? singleChecked.text.trim().split(/\s+/u).length < 2 ? "לפיצול נדרשות לפחות שתי מילים בכתובית." : "הזיזו את הקו לתוך הכתובית כדי לפצל בנקודה הנוכחית."
    : null;
  useEffect(() => { setCheckedIds([]); setBatchError(null); setBatchNotice(null); }, [mode, mediaUrl]);
  useEffect(() => {
    // A later edit owns Undo now; do not leave the previous batch's toast active.
    if (saveState === "saving" && !batchFlight.current) setBatchNotice(null);
  }, [saveState]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectionMode && !batchFlight.current) {
        event.preventDefault(); setCheckedIds([]); setBatchError(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [selectionMode]);
  useEffect(() => {
    if (!batchBusy) setCheckedIds(ids => ids.filter(id => editableSegments.some(segment => segment.id === id)));
  }, [editableSegments, batchBusy]);
  const toggleChecked = (id: Segment["id"]) => {
    if (batchFlight.current || saveState === "saving" || !isEditable) return;
    loopChangeRef.current(false);
    if (isPlaying) onPlayPause?.();
    setBatchError(null);
    setBatchNotice(null);
    setCheckedIds(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
  };
  const runBatch = async (action: CaptionBatchAction) => {
    if (batchFlight.current || !checkedIds.length || saveState === "saving") return;
    if (action === "split" && !canSplitChecked) return;
    batchFlight.current = true;
    setBatchBusy(true);
    setBatchError(null);
    timelineEditing.onDraftStateChange(true);
    try {
      await onCaptionBatch(checkedIds, action, currentTime);
      setBatchNotice(action === "delete" ? `נמחקו ${checkedIds.length} כתוביות` : null);
      setCheckedIds([]);
    } catch {
      setBatchError("שמירת הפעולה נכשלה. הבחירה נשמרה; נסו שוב.");
    } finally {
      batchFlight.current = false;
      setBatchBusy(false);
      timelineEditing.onDraftStateChange(false);
    }
  };
  const wordDraftRef = useRef<Word[] | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [chromeTop, setChromeTop] = useState(MOBILE_APP_HEADER_HEIGHT);
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
      setChromeTop(bottom && bottom > 0 ? Math.round(bottom) : MOBILE_APP_HEADER_HEIGHT);
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
      activeWordColor={activeWordColor}
      captionMotion={captionMotion}
      popIntensity={popIntensity}
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
  const shareAllowed = canBurn && fontReady && Boolean(mediaUrl) && !hasTimelineDrafts && !hasCaptionDraft && !savingDraft && saveState !== "saving" && !isBurning;
  const videoSharing = useVideoSharing(shareAllowed, onBurnVideo);
  const { sharing, shareVideo } = videoSharing;
  const canShareVideo = shareAllowed && !sharing;
  const registerNavigation = useContext(EditorNavigationContext);
  const navigationBlocked = Boolean(backDisabled || leaving || sharing || savingDraft);
  const navigationRef = useRef<EditorNavigationGuard>(async () => {});
  navigationRef.current = async destination => {
    if (navigationBlocked) return;
    if (await flushDraft()) {
      loopChangeRef.current(false);
      await onNavigateAway(destination);
    }
  };
  useEffect(() => {
    registerNavigation(destination => navigationRef.current(destination), navigationBlocked);
    return () => registerNavigation(null);
  }, [registerNavigation, navigationBlocked]);
  useEditorHeaderActions(true, {
    showShare: canBurn && Boolean(mediaUrl),
    canShare: canShareVideo,
    sharing: isBurning || sharing,
    backDisabled: Boolean(backDisabled || leaving || sharing),
    onShare: () => { void shareVideo(); },
    onMyVideos: () => { void leave("onMyVideos"); },
  });

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
        pb: styleOpen ? `calc(${STYLE_DRAWER_HEIGHT} - ${MOBILE_EDITOR_NAV_HEIGHT + 1}px)` : 0.5,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {mode === "watch" && (
          <Stack spacing={1} alignItems="center" sx={{ flex: 1, minHeight: 0, height: "100%" }}>
            {playerSlot("watch")}
            {!styleOpen && <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{formatTimecode(currentTime, preferences.fps)}</Typography>}
            {!styleOpen && <>
            <VideoSeekBar compact currentTime={currentTime} duration={duration} fps={preferences.fps} mediaUrl={mediaUrl} onSeek={onTimelineTimeChange} />
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
                        minHeight: 62,
                        px: 1.5,
                        py: "3px",
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
            <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, width: "100%", display: "flex", overflow: "hidden" }}>
              {player}
            </Box>
            {/* The hidden zoom frees 28px; captions shrink another 10px.
                Use viewport height so smaller menus give their space to the video. */}
            <Box sx={{ flex: "0 0 calc(30dvh - 110px)", minWidth: 0, minHeight: 180, width: "100%", display: "flex", overflow: "hidden" }}>
            <MobileTimingTimeline
              mediaUrl={mediaUrl}
              segments={editableSegments}
              words={words}
              disabled={!isEditable || saveState === "saving" || batchBusy}
              checkedIds={checkedIds}
              onToggleChecked={toggleChecked}
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
                setBatchNotice(null);
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

      <Box sx={{ position: "relative", flexShrink: 0 }}>
      {selectionMode && <Paper role="toolbar" aria-label="פעולות על כתוביות נבחרות" elevation={8} dir="rtl"
        sx={{ position: "absolute", inset: "0px 8px 1px", zIndex: 9, borderRadius: 3, bgcolor: "background.paper", display: "flex", alignItems: "center", px: 0.5, gap: 0.25 }}>
        <IconButton aria-label="ביטול בחירת כתוביות" disabled={batchBusy} onClick={() => { setCheckedIds([]); setBatchError(null); }} sx={{ width: 44, height: 44 }}><CloseRounded /></IconButton>
        <Typography role="status" variant="body2" sx={{ flex: 1, whiteSpace: "nowrap", fontSize: 12 }}>{batchBusy ? "שומר..." : `${checkedIds.length} נבחרו`}</Typography>
        {checkedIds.length === 1
          ? <Button aria-label="פיצול כתובית בנקודת הקו" disabled={batchBusy || saveState === "saving" || !canSplitChecked} onClick={() => void runBatch("split")}
              sx={{ minHeight: 44, minWidth: 64, gap: 0.5, px: 0.75 }}><ContentCutRounded fontSize="small" />פיצול</Button>
          : <Button aria-label="חיבור כתוביות נבחרות" disabled={batchBusy || saveState === "saving" || !canMergeCaptions(editableSegments, checkedIds)} onClick={() => void runBatch("merge")}
              sx={{ minHeight: 44, minWidth: 64, gap: 0.5, px: 0.75 }}><JoinFullRounded fontSize="small" />חיבור</Button>}
        <Button aria-label="מחיקת כתוביות נבחרות" color="error" disabled={batchBusy || saveState === "saving"} onClick={() => void runBatch("delete")}
          sx={{ minHeight: 44, minWidth: 64, gap: 0.5, px: 0.75 }}><DeleteOutlineRounded fontSize="small" />מחיקה</Button>
      </Paper>}
      {selectionMode && !batchBusy && (batchError || splitHint || (checkedIds.length > 1 && !canMergeCaptions(editableSegments, checkedIds))) &&
        <Alert severity={batchError ? "error" : "info"} sx={{ position: "absolute", bottom: "100%", mx: 1, mb: 0.5, left: 0, right: 0, zIndex: 9, py: 0 }}>
          {batchError ?? splitHint ?? "לחיבור בחרו כתוביות רצופות. אפשר למחוק כל בחירה."}
        </Alert>}
      <Stack direction="row" component="nav" aria-label="מצבי עריכה" aria-hidden={selectionMode || undefined}
        sx={{ visibility: selectionMode ? "hidden" : "visible", flexShrink: 0, borderTop: 1, borderColor: "#e8edf3", bgcolor: "#ffffff", p: 0, zIndex: 8, position: "relative", "& .MuiSvgIcon-root": { fontSize: 20 } }}>
        {[
          { id: "timing" as const, label: "תזמון", icon: <AccessTimeRounded /> },
          { id: "style" as const, label: "עיצוב", icon: <SettingsRounded /> },
          { id: "edit" as const, label: "עריכה", icon: <EditOutlined /> },
        ].map(item => (
          <Button key={item.id} onClick={() => goMode(item.id)} sx={{ flex: 1, flexDirection: "column", color: (item.id === "style" ? styleOpen : mode === item.id) ? "primary.main" : "text.secondary", height: MOBILE_EDITOR_NAV_HEIGHT, minHeight: MOBILE_EDITOR_NAV_HEIGHT, py: 0, fontSize: 11, lineHeight: 1.2 }}>
            {item.icon}
            {item.label}
          </Button>
        ))}
        <Button onClick={() => void openMore()} sx={{ flex: 1, flexDirection: "column", color: "text.secondary", height: MOBILE_EDITOR_NAV_HEIGHT, minHeight: MOBILE_EDITOR_NAV_HEIGHT, py: 0, fontSize: 11, lineHeight: 1.2 }}>
          <AddRounded />
          עוד
        </Button>
      </Stack>
      </Box>
      <Snackbar open={batchNotice !== null} autoHideDuration={6000} onClose={(_, reason) => { if (reason !== "clickaway") setBatchNotice(null); }}
        sx={{ bottom: `calc(${MOBILE_EDITOR_NAV_HEIGHT + 8}px + env(safe-area-inset-bottom, 0px)) !important` }} message={batchNotice}
        action={<Button color="inherit" disabled={saveState === "saving" || !timelineEditing.canUndo} onClick={() => { setBatchNotice(null); timelineEditing.onUndo(); }}>ביטול</Button>} />

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
          {captionStyles}
          <Box sx={{ mt: captionStyles ? 2 : 0 }}><CaptionFontPicker disabled={isBurning} fontId={fontId} onFontChange={onFontChange} /></Box>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 0.9, my: 1.35, "& > *": { minWidth: 0 } }}>
            <FormControl fullWidth size="small">
              <InputLabel id="mobile-caption-font-size">גודל פונט</InputLabel>
              <Select labelId="mobile-caption-font-size" value={fontSize} label="גודל פונט" onChange={event => onFontSizeChange({ target: { value: String(event.target.value) } } as ChangeEvent<HTMLInputElement>)}>
                <MenuItem value={AUTO_CAPTION_FONT_SIZE} sx={{ fontSize: "0.9rem" }}>אוטומטי ({autoFontSize})</MenuItem>
                {CAPTION_FONT_SIZES.map(size => <MenuItem key={size} value={size} sx={{ fontSize: "0.9rem" }}>{size}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="צבע טקסט" type="color" value={fontColor} onChange={onFontColorChange} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField label="צבע מסגרת" type="color" value={outlineColor} onChange={onOutlineColorChange} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            {onActiveWordColorChange && <TextField label="צבע מילה פעילה" type="color" value={activeWordColor ?? '#ffd700'} onChange={event => onActiveWordColorChange(event.target.value)} disabled={isBurning} fullWidth size="small" InputLabelProps={{ shrink: true }} />}
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
          <ListItemButton disabled={isBurning || !mediaUrl || !canBurn || !fontReady || hasTimelineDrafts} onClick={() => { setMoreOpen(false); onBurnVideo(); }}>
            <ListItemIcon><MovieFilterRounded /></ListItemIcon>
            <ListItemText primary={canBurn ? (fontReady ? "הורד סרטון עם כתוביות" : "ממתינים לטעינת הפונט") : "צריבה זמינה לקובץ וידאו בלבד"} />
          </ListItemButton>
          {burnedVideo && (
            <ListItemButton component="a" href={burnedVideo.url} download={burnedVideo.name} onClick={() => setMoreOpen(false)}>
              <ListItemIcon><DownloadRounded /></ListItemIcon>
              <ListItemText primary="הורד סרטון צרוב מוכן" />
            </ListItemButton>
          )}
          <ListItemButton disabled={!isEditable || hasTimelineDrafts || saveState === "saving" || currentTime >= duration} onClick={() => { setMoreOpen(false); setNewText(""); setNewStart(currentTime); setNewEnd(Math.min(duration, currentTime + 0.5)); setAddOpen(true); }}>
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

      <VideoShareDialog open={Boolean(videoSharing.readyToShare)} onClose={videoSharing.closeShare} onShare={videoSharing.shareReadyVideo} />

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
          {aiError && <Alert severity="error">{aiError}</Alert>}
          <TextField label="מה לעשות?" multiline rows={4} value={aiInstructions} onChange={event => setAiInstructions(event.target.value)} fullWidth sx={{ mt: 1 }} placeholder="לדוגמה: תפצל כתוביות ארוכות, תתקן שגיאות כתיב" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiOpen(false)}>ביטול</Button>
          <Button variant="contained" disabled={aiBusy || !aiInstructions.trim() || !onAIEdit} onClick={async () => {
            if (!onAIEdit) return;
            setAiBusy(true); setAiError(null);
            try { await onAIEdit(aiInstructions.trim()); setAiOpen(false); setAiInstructions(""); }
            catch { setAiError("עריכת AI נכשלה. ההוראות נשמרו; אפשר לנסות שוב."); }
            finally { setAiBusy(false); }
          }}>{aiBusy ? "AI מעבד..." : "בצע עריכה"}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
