import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, CardContent, Snackbar, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import type { ApiResponse, Segment } from "../types";
import { useVideoPlayer } from "./VideoPlayer";
import type { BurnOptions } from "./VideoToolbar";
import { TranscriptionResultHeader } from "./TranscriptionResultHeader";
import { TranscriptionMainContent } from "./TranscriptionMainContent";
import { useTranscriptionState } from "../hooks/useTranscriptionState";
import { usePreviewStyle } from "../hooks/usePreviewStyle";
import { useAutoCaptionFontSize } from "../hooks/useAutoCaptionFontSize";
import { useCaptionFont } from "../hooks/useCaptionFont";
import { AUTO_CAPTION_FONT_SIZE } from "../../captionStyle.js";
import { useTranscriptionHandlers } from "../hooks/useTranscriptionHandlers";
import { useVideoControls } from "../hooks/useVideoControls";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
import { EditorSettings } from "./EditorSettings";
import { CaptionMotionSettings } from "./CaptionMotionSettings";
import { CaptionStylePicker } from "./CaptionStylePicker";
import { popPeakScale } from "../../captionMotion.js";
import { serializeSubtitles } from "../utils/subtitleExport";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { cleanSegmentText, fixSegmentOverlaps, findSegment } from "../utils/transcriptionUtils";
import { synchronizeWords } from "../../wordAlignment.js";
import { EditorNavigationContext } from "../contexts/EditorNavigationContext";
import { DownloadContext } from "../contexts/DownloadContext";
import { useDownloadExperience } from "../hooks/useDownloadExperience";
import { DownloadFeedbackDialog } from "./DownloadFeedbackDialog";
import { BurnProgressDialog } from './BurnProgressDialog';
import type { BurnProgress } from '../utils/burnRequest';
import { CaptionAppearanceContext } from '../contexts/CaptionAppearanceContext';
import { sanitizeCaptionOverrides, type CaptionOverrides } from '../../captionOverrides.js';
import { createCaptionLivePreview } from '../hooks/useCaptionLivePreview';
import { useProjectAudiogram } from '../hooks/useProjectAudiogram';
import { AudiogramContext } from '../contexts/AudiogramContext';
import { VideoVersionContext } from '../contexts/VideoVersionContext';
import { VideoVersionsBar } from './VideoVersionsBar';
import { cropRectangle } from '../../videoVersions.js';
import { WordAppearanceContext } from '../contexts/WordAppearanceContext';
import { styleCaptionWords, moveCaptionWords } from '../../wordOverrides.js';

export type { BurnOptions };
type BurnResult = { blob: Blob; filename?: string; };

type TranscriptionResultProps = {
  response: ApiResponse;
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
  mediaUrl: string | null;
  onBack: () => void;
  onMyVideos: () => void;
  onBurn: (options: BurnOptions) => Promise<BurnResult>;
  onSaveSegments: (segments: Segment[], subtitleContent: string, words?: any[]) => Promise<void>;
  videoId: number | null;
  isEditable: boolean;
};

export function TranscriptionResult({
  response,
  subtitleFormatLabel,
  downloadUrl: _originalDownloadUrl,
  downloadName: originalDownloadName,
  mediaUrl,
  onBack,
  onMyVideos,
  onBurn,
  onSaveSegments,
  videoId,
  isEditable,
}: TranscriptionResultProps) {
  const { preferences } = useEditorPreferences();
  const desktop = useMediaQuery(useTheme().breakpoints.up("md"));
  const [reframing, setReframing] = useState(false);
  const [versionDownloadPending, setVersionDownloadPending] = useState(false);
  const [requestedDownload, setRequestedDownload] = useState<{ id: string } | null>(null);
  const downloadFlight = useRef(false);
  const consumedDownload = useRef<object | null>(null);
  const downloads = useDownloadExperience(videoId);
  const [burnProgress, setBurnProgress] = useState<BurnProgress>({ stage: 'preparing', percent: null });
  const [timelineDrafts, setHasTimelineDrafts] = useState(false);
  // The selected caption, and its style when selected so Revert can restore it.
  const [appearanceSelection, setAppearanceSelection] = useState<{ id: Segment['id']; original: CaptionOverrides } | null>(null);
  // A style applied in the preview but not yet saved; it is flushed automatically.
  const [appearancePending, setAppearancePending] = useState<{ id: Segment['id']; style: CaptionOverrides; version: number } | null>(null);
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [wordSaving, setWordSaving] = useState(false);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [appearanceControlsOpen, setAppearanceControlsOpen] = useState(false);
  const [appearanceLive] = useState(createCaptionLivePreview);
  const appearanceTimer = useRef<number>();
  const appearanceFlush = useRef<() => Promise<void>>(async () => {});
  const hasTimelineDrafts = timelineDrafts || Boolean(appearancePending) || appearanceSaving || wordSaving;
  useEffect(() => {
    window.clearTimeout(appearanceTimer.current);
    setAppearanceSelection(null); setAppearancePending(null); setAppearanceError(null); setAppearanceControlsOpen(false);
  }, [videoId, mediaUrl]);
  useEffect(() => () => window.clearTimeout(appearanceTimer.current), []);
  useLayoutEffect(() => { appearanceLive.clearSettled(); }, [appearancePending, appearanceLive]);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const loopEnabledRef = useRef(loopEnabled);
  loopEnabledRef.current = loopEnabled;
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState(response.subtitle?.format || ".srt");
  const downloadName = originalDownloadName.replace(/\.[^.]+$/, "") + exportFormat;
  useEffect(() => { setExportFormat(response.subtitle?.format || ".srt"); }, [mediaUrl, videoId, response.subtitle?.format]);
  const videoPlayer = useVideoPlayer();
  const responseSegments = response.segments ?? [];
  const savedSegments = useMemo(() => fixSegmentOverlaps(responseSegments.map(segment => ({ ...segment, text: cleanSegmentText(segment.text) })))
    .filter(segment => segment.end > segment.start), [responseSegments]);
  const savedWords = useMemo(() => synchronizeWords(savedSegments, response.words), [savedSegments, response.words]);

  const {
    versions,
    fontId: projectFontId, setFontId, activeWordColor, setActiveWordColor, applyCaptionStyle,
    editableSegments,
    editableWords,
    setActiveSegmentId,
    fontSize,
    setFontSize,
    fontColor,
    setFontColor,
    outlineColor,
    setOutlineColor,
    offsetYPercent,
    setOffsetYPercent,
    marginPercent,
    setMarginPercent,
    captionMotion,
    setCaptionMotion,
    popIntensity,
    setPopIntensity,
    videoDimensions,
    setVideoDimensions,
    renderDimensions,
    setRenderDimensions,
    videoDuration,
    setVideoDuration,
    currentTime,
    setCurrentTime,
    burnError,
    setBurnError,
    isBurning,
    setIsBurning,
    burnedVideo,
    setBurnedVideo,
    saveState,
    saveError,
    selectedSegmentId,
    setSelectedSegmentId,
    activeWordEnabled,
    handleSegmentTextChange,
    handleSegmentTextChangeAndSave,
    handleSegmentBlur,
    handleAddSubtitle,
    handleDeleteSegment,
    handleCaptionBatch,
    handleSplitSegment,
    handleUndoSplit,
    canUndoSplit,
    handleToggleActiveWord,
    handleWordsChange,
    handleResegment,
    handleAIEdit,
    handleCharacterReflow,
    handleUndoReflow,
    canUndoReflow,
    persistSegments,
    handleSaveSegment,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
  } = useTranscriptionState({
    responseSegments,
    responseWords: response.words,
    mediaUrl,
    isEditable,
    videoId,
    onSaveSegments,
  });

  const audiogram = useProjectAudiogram(videoId);
  const [audioOnly, setAudioOnly] = useState(false);
  useEffect(() => { setAudioOnly(false); }, [mediaUrl]);
  // Audio is laid out, previewed and burned on the audiogram's frame.
  const crop = desktop && versions.activeId !== 'original' ? versions.crops[versions.activeId] ?? null : null;
  const mediaDimensions = audioOnly ? audiogram.dimensions : videoDimensions && crop ? cropRectangle(videoDimensions, crop) : videoDimensions;
  const captionRenderDimensions = renderDimensions && videoDimensions && crop && mediaDimensions
    ? { width: renderDimensions.width * mediaDimensions.width / videoDimensions.width, height: renderDimensions.height * mediaDimensions.height / videoDimensions.height }
    : renderDimensions;
  const fontId = projectFontId ?? preferences.fontId;
  const { ready: fontReady, error: fontLoadError } = useCaptionFont(fontId);
  const activeSegment = useMemo(() => findSegment(editableSegments, currentTime) ?? null, [editableSegments, currentTime]);
  const appearanceSegment = editableSegments.find(segment => segment.id === appearanceSelection?.id) ?? null;
  const captionStyle = (segment: Segment | null | undefined) =>
    sanitizeCaptionOverrides(appearancePending && segment?.id === appearancePending.id ? appearancePending.style : segment?.style);
  const activeOverrides = captionStyle(activeSegment);
  const appearanceStyle = captionStyle(appearanceSegment);
  const appearanceDirty = Boolean(appearanceSelection && JSON.stringify(appearanceStyle) !== JSON.stringify(appearanceSelection.original));
  const segmentsRef = useRef(editableSegments);
  segmentsRef.current = editableSegments;
  const pendingRef = useRef(appearancePending);
  pendingRef.current = appearancePending;
  // Timers call the latest flush, so it never saves with stale segments or words.
  appearanceFlush.current = async () => {
    window.clearTimeout(appearanceTimer.current);
    const job = pendingRef.current;
    if (!job) return;
    const target = segmentsRef.current.find(segment => segment.id === job.id);
    const finished = () => setAppearancePending(current => current?.version === job.version ? null : current);
    if (!target) { finished(); return; }
    if (JSON.stringify(sanitizeCaptionOverrides(target.style)) === JSON.stringify(job.style)) { finished(); return; }
    setAppearanceSaving(true);
    try {
      await persistSegments(segmentsRef.current.map(segment => segment.id === job.id
        ? { ...segment, style: Object.keys(job.style).length ? job.style : undefined } : segment), undefined, { throwOnError: true, quiet: true });
      finished();
      setAppearanceError(null);
    } catch { setAppearanceError('שמירת העיצוב נכשלה. השינוי נשאר בתצוגה; אפשר לנסות שוב.'); }
    finally { setAppearanceSaving(false); }
  };
  const applyAppearance = (style: CaptionOverrides, immediate = false) => {
    if (!appearanceSelection) return;
    const id = appearanceSelection.id;
    const next = { id, style: sanitizeCaptionOverrides(style), version: (pendingRef.current?.version ?? 0) + 1 };
    pendingRef.current = next;
    setAppearancePending(next);
    window.clearTimeout(appearanceTimer.current);
    appearanceTimer.current = window.setTimeout(() => void appearanceFlush.current(), immediate ? 0 : 400);
  };
  const closeAppearance = () => {
    appearanceLive.set(null);
    void appearanceFlush.current();
    setAppearanceSelection(null); setAppearanceControlsOpen(false);
  };
  // Like other editors, moving the playhead off the selected caption deselects it.
  const selectedOnScreen = !appearanceSegment || (currentTime >= appearanceSegment.start && currentTime < appearanceSegment.end);
  const closeAppearanceRef = useRef(closeAppearance);
  closeAppearanceRef.current = closeAppearance;
  useEffect(() => { if (appearanceSelection && !selectedOnScreen) closeAppearanceRef.current(); }, [appearanceSelection, selectedOnScreen]);
  useEffect(() => { if (appearanceSelection && !appearanceSegment) closeAppearanceRef.current(); }, [appearanceSelection, appearanceSegment]);
  const { ready: previewFontReady, error: previewFontError } = useCaptionFont(activeOverrides.fontId ?? fontId);
  const sizingSegments = useMemo(() => captionMotion === "pop"
    ? editableWords.map((word, index) => ({ id: index, start: word.start, end: word.end, text: word.word }))
    : editableSegments, [captionMotion, editableWords, editableSegments]);
  const fittedFontSize = useAutoCaptionFontSize({ segments: sizingSegments, videoDimensions: mediaDimensions, marginPercent, offsetYPercent, fontId });
  // Reserve room for the largest bounce and keep single words at a readable
  // default size rather than stretching a short word across the entire frame.
  const autoFontSize = captionMotion === "pop" && mediaDimensions
    ? Math.max(12, Math.floor(Math.min(fittedFontSize / popPeakScale(popIntensity), mediaDimensions.height * .095)))
    : fittedFontSize;
  const effectiveFontSize = fontSize === AUTO_CAPTION_FONT_SIZE ? autoFontSize : fontSize;

  const previewStyle = usePreviewStyle({
    scaleOutline: true,
    fontId: activeOverrides.fontId ?? fontId,
    fontColor: activeOverrides.fontColor ?? fontColor,
    fontSize: activeOverrides.fontSize ?? effectiveFontSize,
    offsetYPercent: activeOverrides.offsetYPercent ?? offsetYPercent,
    outlineColor: activeOverrides.outlineColor ?? outlineColor,
    positionXPercent: activeOverrides.positionXPercent,
    rotation: activeOverrides.rotation,
    marginPercent,
    videoDimensions: mediaDimensions,
    renderDimensions: captionRenderDimensions,
  });

  useEffect(() => {
    const content = serializeSubtitles(editableSegments, exportFormat, preferences.direction);
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [editableSegments, exportFormat, preferences.direction]);


  // Fresh transcriptions already include this notice in the server warnings.
  // Keep the editor fallback for older results and newly edited word timings.
  const hasEstimatedTimingWarning = response.warnings?.some(warning => warning.includes("תזמון משוער")) ?? false;

  const { isPlaying, handlePlayPause } = useVideoControls(videoPlayer);
  const narrow = useNarrowViewport();
  const playbackRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const historyKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented || event.isComposing) return;
      // Physical codes also work with the Hebrew keyboard layout.
      const key = event.code || event.key.toLowerCase();
      if (!["KeyZ", "KeyY", "z", "y"].includes(key)) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target !== document.body && target !== document.documentElement && !playbackRoot.current?.contains(target)) return;
      // Text fields keep native typing history; range inputs are editor controls.
      if (target.isContentEditable || target.closest('textarea,select,input:not([type="range"]),[role="textbox"],[role="combobox"],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || !isEditable || isBurning || reframing || hasTimelineDrafts || saveState === "saving") return;
      const redo = key === "KeyY" || key === "y" || event.shiftKey;
      if (redo ? canRedo : canUndo) void (redo ? handleRedo() : handleUndo());
    };
    // Own history once for the whole editor, including word tracks, preview,
    // sliders and whitespace, before native controls consume the shortcut.
    window.addEventListener("keydown", historyKey, true);
    return () => window.removeEventListener("keydown", historyKey, true);
  }, [isEditable, isBurning, reframing, hasTimelineDrafts, saveState, canUndo, canRedo, handleUndo, handleRedo]);
  useEffect(() => {
    if (!desktop || !videoPlayer) return;
    const playbackKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.defaultPrevented || event.isComposing
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('[data-testid="caption-position"], [data-word-toolbar]')) return;
      // Page whitespace may leave focus on body. Header controls and portals
      // keep their own keyboard behavior, while the editor owns plain Space.
      if (target !== document.body && target !== document.documentElement && !playbackRoot.current?.contains(target)) return;
      if (target.isContentEditable || target.closest('input,textarea,select,[role="textbox"],[role="combobox"],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')) return;
      // Capture before word selection, timeline shortcuts and native video or
      // button behavior, preventing two toggles from a single key press.
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) void handlePlayPause();
    };
    window.addEventListener("keydown", playbackKey, true);
    return () => window.removeEventListener("keydown", playbackKey, true);
  }, [desktop, videoPlayer, handlePlayPause]);
  const registerNavigation = useContext(EditorNavigationContext);

  const leaveEditor = async (destination: () => void) => {
    if (isEditable && (saveState === "error" || JSON.stringify(editableSegments) !== JSON.stringify(savedSegments) || JSON.stringify(editableWords) !== JSON.stringify(savedWords))) {
      try { await persistSegments(editableSegments, editableWords, { throwOnError: true }); }
      catch { return; }
    }
    destination();
  };
  const handleLeaveEditor = () => leaveEditor(onBack);
  const handleMyVideos = () => leaveEditor(onMyVideos);
  const navigationRef = useRef(leaveEditor);
  navigationRef.current = leaveEditor;
  const navigationBlocked = isBurning || versionDownloadPending || reframing || hasTimelineDrafts || saveState === "saving";
  useEffect(() => {
    if (narrow) return;
    registerNavigation(async destination => {
      if (!navigationBlocked) await navigationRef.current(destination);
    }, navigationBlocked);
    return () => registerNavigation(null);
  }, [registerNavigation, navigationBlocked, narrow]);

  const {
    handleVideoTimeUpdate,
    handleVideoLoadedMetadata,
    handleVideoResize,
    handleTimelineTimeChange,
    handleTimelineSegmentsChange,
    handleFontSizeChange,
    handleFontColorChange,
    handleOutlineColorChange,
    handleOffsetYChange,
    handleMarginChange,
    handleBurnVideo,
  } = useTranscriptionHandlers({
    onDownloadVideo: downloads.actions.downloadVideo,
    fontId, activeWordColor,
    captionMotion,
    popIntensity,
    mediaUrl,
    editableSegments,
    editableWords,
    activeWordEnabled,
    setActiveSegmentId,
    setCurrentTime,
    setVideoDimensions,
    setVideoDuration,
    setRenderDimensions,
    setFontSize,
    setFontColor,
    setOutlineColor,
    setOffsetYPercent,
    setMarginPercent,
    setBurnError,
    setIsBurning,
    setBurnedVideo,
    persistSegments,
    videoPlayer,
    response,
    downloadName,
    burnedVideo,
    fontSize: effectiveFontSize,
    fontReady,
    fontColor,
    outlineColor,
    offsetYPercent,
    marginPercent,
    videoDimensions: mediaDimensions,
    audiogram: audioOnly ? { settings: audiogram.settings, image: audiogram.image, imageVersion: audiogram.imageVersion } : null,
    crop,
    onBurn,
    setBurnProgress,
  });
  const handleLoadedMetadata = useCallback((dimensions: { width: number; height: number }, duration: number) => {
    setAudioOnly(!dimensions.width || !dimensions.height);
    handleVideoLoadedMetadata(dimensions, duration);
  }, [handleVideoLoadedMetadata]);
  const selectVersion = async (id: string) => {
    if (hasTimelineDrafts || reframing || isBurning) return;
    closeAppearance(); setLoopEnabled(false); loopEnabledRef.current = false;
    await versions.switchVersion(id);
  };
  const selectVersionRef = useRef(selectVersion); selectVersionRef.current = selectVersion;
  const downloadVersion = async (id: string) => {
    if (downloadFlight.current || navigationBlocked || !desktop || !versions.enabled || !fontReady || !isEditable) return;
    downloadFlight.current = true;
    setVersionDownloadPending(true);
    try {
      await selectVersion(id);
      // Export in the next committed render, after the selected version's
      // captions, crop, dimensions and automatic font size have all updated.
      setRequestedDownload({ id });
    } catch {
      setBurnError('לא ניתן לעבור לגרסה להורדה. שמרו את השינויים ונסו שוב.');
      downloadFlight.current = false; setVersionDownloadPending(false);
    }
  };
  useEffect(() => {
    if (!requestedDownload || consumedDownload.current === requestedDownload) return;
    consumedDownload.current = requestedDownload;
    const finish = () => { downloadFlight.current = false; setRequestedDownload(null); setVersionDownloadPending(false); };
    if (!desktop || versions.activeId !== requestedDownload.id || !fontReady) {
      setBurnError('לא ניתן להכין את הגרסה שנבחרה. נסו שוב.'); finish(); return;
    }
    void handleBurnVideo().finally(finish);
  }, [requestedDownload, versions.activeId, desktop, fontReady, handleBurnVideo, setBurnError]);
  useEffect(() => {
    if (!desktop && versions.activeId !== 'original' && !navigationBlocked) void selectVersionRef.current('original').catch(() => {});
  }, [desktop, versions.activeId, navigationBlocked]);

  return (
    <DownloadContext.Provider value={downloads.actions}>
    <VideoVersionContext.Provider value={desktop && versions.enabled ? { activeId: versions.activeId, crop,
      disabled: navigationBlocked || !isEditable, updateCrop: value => {
        try { versions.updateCrop(value); } catch { setBurnError('שמירת מסגרת החיתוך נכשלה. בדקו שיש מקום פנוי במכשיר.'); }
      }, splitAll: versions.splitAllVersions, download: downloadVersion } : null}>
    <AudiogramContext.Provider value={audioOnly ? { ...audiogram, disabled: isBurning } : null}>
    <WordAppearanceContext.Provider value={desktop ? {
      versionId: versions.activeId,
      disabled: !isEditable || isBurning || hasTimelineDrafts || saveState === 'saving',
      saving: wordSaving,
      move: async (segmentId, indexes, delta) => {
        if (!isEditable || isBurning || hasTimelineDrafts || saveState === 'saving') return;
        setWordSaving(true);
        try {
          await persistSegments(editableSegments, moveCaptionWords(editableWords, segmentId, indexes, delta), { throwOnError: true, layoutOnly: true });
        } finally { setWordSaving(false); }
      },
      change: async (segmentId, indexes, patch) => {
        if (!isEditable || isBurning || hasTimelineDrafts || saveState === 'saving') return;
        setWordSaving(true);
        try {
          await persistSegments(editableSegments, styleCaptionWords(editableWords, segmentId, indexes, patch), { throwOnError: true, layoutOnly: true });
        } finally { setWordSaving(false); }
      },
    } : null}>
    <CaptionAppearanceContext.Provider value={{
      segment: appearanceSegment,
      values: { fontId, fontSize: effectiveFontSize, fontColor, outlineColor, activeWordColor, activeWordEnabled, positionXPercent: 50, offsetYPercent, rotation: 0, ...appearanceStyle },
      activeWordOverride: appearanceStyle.activeWordEnabled,
      live: appearanceLive,
      disabled: !isEditable || isBurning || timelineDrafts || wordSaving,
      dirty: appearanceDirty, saving: appearanceSaving, error: appearanceError,
      controlsOpen: appearanceControlsOpen,
      showControls: () => setAppearanceControlsOpen(true),
      select: (id, options) => {
        if (!isEditable || isBurning || timelineDrafts) return;
        const segment = editableSegments.find(item => item.id === id);
        if (!segment) return;
        if (!options?.deferControls) setAppearanceControlsOpen(true);
        if (appearanceSelection?.id === id) return;
        if (pendingRef.current) void appearanceFlush.current();
        appearanceLive.set(null);
        setAppearanceControlsOpen(!options?.deferControls);
        loopEnabledRef.current = false; videoPlayer?.pause(); setLoopEnabled(false);
        setAppearanceSelection({ id, original: captionStyle(segment) }); setAppearanceError(null);
      },
      change: patch => applyAppearance({ ...appearanceStyle, ...patch }),
      commit: patch => {
        if (!appearanceSelection) { appearanceLive.set(null); return; }
        appearanceLive.settle();
        applyAppearance({ ...appearanceStyle, ...patch });
      },
      reset: () => { appearanceLive.set(null); applyAppearance({}, true); },
      revert: () => { if (appearanceSelection) { appearanceLive.set(null); applyAppearance(appearanceSelection.original, true); } },
      retry: () => { void appearanceFlush.current(); },
      close: closeAppearance,
    }}>
    <BurnProgressDialog open={isBurning || versionDownloadPending} progress={isBurning ? burnProgress : { stage: 'preparing', percent: null }} />
    <Card ref={playbackRoot} elevation={narrow ? 0 : 3} sx={{ overflow: "visible", ...(narrow ? { bgcolor: "transparent", boxShadow: "none" } : {}) }}>
      <CardContent sx={narrow ? { p: 0, "&:last-child": { pb: 0 } } : { p: { md: 1.5 }, "&:last-child": { pb: { md: 1.5 } } }}>
        <Stack spacing={narrow ? 0 : 1.5}>
          {(fontLoadError || previewFontError) && <Alert severity="error">טעינת הפונט נכשלה. בחרו פונט אחר כדי לצרוב את הסרטון.</Alert>}
          {(!fontReady || !previewFontReady) && !fontLoadError && !previewFontError && <Typography role="status" variant="caption">טוען פונט...</Typography>}
          {!narrow && !desktop && (
          <TranscriptionResultHeader
            subtitleFormatLabel={subtitleFormatLabel}
            downloadUrl={downloadUrl}
            downloadName={downloadName}
            warnings={response.warnings}
            backDisabled={saveState === "saving" || isBurning || hasTimelineDrafts}
            onBack={handleLeaveEditor}
          />
          )}
          {saveState === "error" && !appearanceError && <Alert severity="error" action={<Button onClick={() => persistSegments(editableSegments, editableWords)}>נסה לשמור שוב</Button>}>{saveError}</Alert>}
          {!narrow && !desktop && activeWordEnabled && !hasEstimatedTimingWarning && editableWords.some(word => word.timingSource === "estimated") && <Alert severity="info">לחלק מהמילים הושלם תזמון משוער. אפשר לדייק אותן בציר המילים של המקטע; הטקסט המתוקן נשמר במלואו.</Alert>}

          <TranscriptionMainContent
            versionsBar={desktop && !audioOnly && <VideoVersionsBar eligible={Boolean(videoDimensions && videoDimensions.width / videoDimensions.height >= 1.3)}
              enabled={versions.enabled} dismissed={versions.dismissed} activeId={versions.activeId} crop={crop} mediaUrl={mediaUrl}
              disabled={navigationBlocked || !isEditable} shareAllowed={fontReady && Boolean(mediaDimensions)} onBurnVideo={options => { videoPlayer?.pause(); return handleBurnVideo(options); }}
              create={versions.create} dismiss={versions.dismiss} select={selectVersion} updateCrop={versions.updateCrop} onBusy={setReframing} />}
            onNavigateAway={destination => navigationRef.current(destination)}
            fontId={fontId} onFontChange={setFontId} activeWordColor={activeWordColor}
            onActiveWordColorChange={setActiveWordColor}
            captionStyles={<CaptionStylePicker appearance={{ fontId, fontSize, fontColor, outlineColor, activeWordColor, activeWordEnabled, offsetYPercent, marginPercent, captionMotion, popIntensity }} onApply={applyCaptionStyle} disabled={isBurning} />}
            fontReady={fontReady}
            hasTimelineDrafts={hasTimelineDrafts || reframing}
            timelineEditing={{ onSaveSegment: handleSaveSegment, onUndo: handleUndo, onRedo: handleRedo, canUndo, canRedo,
              onDraftStateChange: setHasTimelineDrafts, loopEnabled,
              onPlayFrom: time => { handleTimelineTimeChange(time); void videoPlayer?.play().catch(() => setBurnError("לא ניתן להתחיל ניגון.")); },
              onLoopChange: enabled => {
                loopEnabledRef.current = enabled;
                setLoopEnabled(enabled);
                const selected = editableSegments.find(s => s.id === selectedSegmentId);
                if (enabled && selected) { handleTimelineTimeChange(selected.start); void videoPlayer?.play().catch(() => setLoopEnabled(false)); }
              },
            }}
            editorSettings={<>
              <CaptionMotionSettings motion={captionMotion} intensity={popIntensity} onMotionChange={setCaptionMotion} onIntensityChange={setPopIntensity} disabled={isBurning} />
              <EditorSettings disabled={!isEditable || saveState === "saving" || hasTimelineDrafts} onApply={handleCharacterReflow} onUndo={handleUndoReflow} canUndo={canUndoReflow} exportFormat={exportFormat} onExportFormatChange={setExportFormat} />
            </>}
            captionMotion={captionMotion}
            popIntensity={popIntensity}
            mediaUrl={mediaUrl}
            activeSegmentText={activeSegment?.text ?? null}
            previewStyle={previewStyle}
            editableSegments={editableSegments}
            words={editableWords}
            isEditable={isEditable}
            videoDuration={videoDuration}
            renderDimensions={renderDimensions}
            currentTime={currentTime}
            selectedSegmentId={selectedSegmentId}
            activeSegmentId={activeSegment?.id ?? null}
            fontSize={fontSize}
            autoFontSize={autoFontSize}
            fontColor={fontColor}
            outlineColor={outlineColor}
            offsetYPercent={offsetYPercent}
            marginPercent={marginPercent}
            isBurning={isBurning}
            burnError={burnError}
            burnedVideo={burnedVideo}
            videoDimensions={mediaDimensions}
            saveState={saveState}
            saveError={saveError}
            downloadUrl={downloadUrl}
            downloadName={downloadName}
            activeWordEnabled={activeWordEnabled}
            onVideoTimeUpdate={time => {
              const selected = loopEnabledRef.current && editableSegments.find(s => s.id === selectedSegmentId);
              if (selected && videoPlayer && (time >= selected.end || time < selected.start)) {
                const wasEnded = videoPlayer.ended;
                handleTimelineTimeChange(selected.start);
                if (wasEnded) void videoPlayer.play().catch(() => setLoopEnabled(false));
              } else handleVideoTimeUpdate(time);
            }}
            onVideoLoadedMetadata={handleLoadedMetadata}
            onVideoResize={handleVideoResize}
            onTimelineSegmentsChange={handleTimelineSegmentsChange}
            onTimelineTimeChange={time => {
              // A manual seek must win over the selected-caption loop, including
              // media events queued before React renders the new loop state.
              loopEnabledRef.current = false;
              setLoopEnabled(false);
              handleTimelineTimeChange(time);
            }}
            onSegmentSelect={id => {
              if (appearanceSelection && id !== null && id !== appearanceSelection.id) closeAppearance();
              setSelectedSegmentId(id); setLoopEnabled(false);
            }}
            onSegmentTextChangeAndSave={handleSegmentTextChangeAndSave}
            onSegmentTextChange={handleSegmentTextChange}
            onSegmentBlur={handleSegmentBlur}
            onFontSizeChange={handleFontSizeChange}
            onFontColorChange={handleFontColorChange}
            onOutlineColorChange={handleOutlineColorChange}
            onOffsetYChange={handleOffsetYChange}
            onMarginChange={handleMarginChange}
            onBurnVideo={reframing ? async () => null : handleBurnVideo}
            onAddSubtitle={handleAddSubtitle}
            onDeleteSegment={handleDeleteSegment}
            onCaptionBatch={handleCaptionBatch}
            onSplitSegment={handleSplitSegment}
            onUndoSplit={handleUndoSplit}
            canUndoSplit={canUndoSplit}
            onToggleActiveWord={handleToggleActiveWord}
            onWordsChange={handleWordsChange}
            onResegment={handleResegment}
            onAIEdit={handleAIEdit}
            isPlaying={isPlaying}
            onPlayPause={() => { void handlePlayPause(); }}
            onBack={handleLeaveEditor}
            onMyVideos={handleMyVideos}
            backDisabled={saveState === "saving" || isBurning || hasTimelineDrafts}
          />

        </Stack>
      </CardContent>
    </Card>
    <Snackbar open={Boolean(downloads.error)} onClose={downloads.clearError} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
      <Alert severity="error" onClose={downloads.clearError}>{downloads.error}</Alert>
    </Snackbar>
    {downloads.feedbackDownloadId && <DownloadFeedbackDialog key={downloads.feedbackDownloadId} open onClose={downloads.closeFeedback} onSubmit={downloads.saveFeedback} />}
    </CaptionAppearanceContext.Provider>
    </WordAppearanceContext.Provider>
    </AudiogramContext.Provider>
    </VideoVersionContext.Provider>
    </DownloadContext.Provider>
  );
}
