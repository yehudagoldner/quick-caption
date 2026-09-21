import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
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
  MovieFilterRounded,
  RepeatRounded,
  SettingsRounded,
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
  onBurnVideo: () => void;
  onAddSubtitle: (text: string, startTime: number, endTime: number) => void;
  onSplitSegment: (segmentId: Segment["id"], splitTime: number, draft?: CaptionDraft) => Promise<void>;
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

  const duration = videoDuration && Number.isFinite(videoDuration) ? videoDuration : Math.max(1, ...editableSegments.map(s => s.end), 1);
  const selectedIndex = editableSegments.findIndex(s => s.id === selectedSegmentId);
  const selected = selectedIndex >= 0 ? editableSegments[selectedIndex] : null;
  const captionWords = useMemo(() => selected ? wordsForSegment(words, selected) : [], [words, selected]);
  const activeWord = useActiveWord({ words: captionWords, currentTime, enabled: activeWordEnabled });
  const locked = !isEditable || saveState === "saving" || saving;

  useEffect(() => {
    if (selected) setDraftText(selected.text);
  }, [selected?.id, selected?.text]);

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

  const saveCaption = async () => {
    if (!selected || !draftText.trim()) return;
    setSaving(true);
    try {
      const segment = { ...selected, text: draftText };
      await timelineEditing.onSaveSegment(segment, synchronizeWords([segment], captionWords));
    } finally {
      setSaving(false);
    }
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

  const playerSlot = (kind: "watch" | "compact") => (
    <Box sx={{
      flex: kind === "watch" ? 1 : "0 0 auto",
      minHeight: 0,
      width: "100%",
      height: kind === "watch" ? undefined : "min(22dvh, 148px)",
      maxHeight: kind === "watch" ? "100%" : "min(22dvh, 148px)",
      display: "flex",
      overflow: "hidden",
    }}>
      {player}
    </Box>
  );

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
      <Stack direction="row" alignItems="center" sx={{ flexShrink: 0, px: 0.5, py: 0.25, minHeight: 44, borderBottom: 1, borderColor: "#e8edf3", bgcolor: "#ffffff" }}>
        <IconButton size="small" aria-label="חזרה לצפייה" onClick={() => setMode("watch")}><ChevronRightRounded /></IconButton>
        <Typography sx={{ flex: 1, fontWeight: 500, fontSize: 15 }}>עורך כתוביות</Typography>
        <Button onClick={() => setMoreOpen(true)} disabled={hasTimelineDrafts}>הורדה</Button>
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
              sx={{ flexShrink: 0, position: "relative", width: "100%", height: 10, bgcolor: "#e8edf3", borderRadius: 999, cursor: "pointer" }}
            >
              {editableSegments.map(segment => (
                <Box key={String(segment.id)} sx={{
                  position: "absolute", top: "2px", height: 6, borderRadius: 999,
                  left: `${(segment.start / duration) * 100}%`,
                  width: `${Math.max(0.8, ((segment.end - segment.start) / duration) * 100)}%`,
                  bgcolor: segment.id === (selectedSegmentId ?? activeSegmentId) ? "primary.main" : "#9b5700",
                }} />
              ))}
              <Box sx={{ position: "absolute", top: "-3px", width: "2px", height: 16, bgcolor: "primary.main", left: `${(currentTime / duration) * 100}%` }} />
            </Box>
          </Stack>
        )}

        {mode === "edit" && selected && (
          <Stack spacing={1} sx={{ minWidth: 0, width: "100%", flex: 1, minHeight: 0, overflow: "auto" }}>
            {playerSlot("compact")}
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexShrink: 0 }}>
              <IconButton aria-label="המקטע הקודם" disabled={selectedIndex <= 0} onClick={() => onSegmentSelect(editableSegments[selectedIndex - 1].id)}><ChevronRightRounded /></IconButton>
              <Typography variant="body2" color="text.secondary">מקטע {selectedIndex + 1} מתוך {editableSegments.length}</Typography>
              <IconButton aria-label="המקטע הבא" disabled={selectedIndex >= editableSegments.length - 1} onClick={() => onSegmentSelect(editableSegments[selectedIndex + 1].id)}><ChevronLeftRounded /></IconButton>
            </Stack>
            <TextField
              label="טקסט המקטע"
              multiline
              minRows={1}
              maxRows={3}
              fullWidth
              value={draftText}
              disabled={locked}
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
              <Button variant="contained" onClick={() => void saveCaption()} disabled={locked || !draftText.trim() || draftText === selected.text}>{saving ? "שומר…" : "שמור"}</Button>
              <Button variant="outlined" startIcon={<RepeatRounded />} aria-pressed={timelineEditing.loopEnabled} onClick={() => timelineEditing.onLoopChange(!timelineEditing.loopEnabled)}>נגן בלולאה</Button>
              <Button variant="outlined" startIcon={<ContentCutRounded />} disabled={locked || draftText.trim().split(/\s+/).length < 2 || currentTime <= selected.start || currentTime >= selected.end} onClick={() => void onSplitSegment(selected.id, currentTime)}>פצל</Button>
            </Stack>
          </Stack>
        )}

        {mode === "edit" && !selected && (
          <Stack spacing={1} alignItems="center" sx={{ flex: 1, minHeight: 0 }}>
            {playerSlot("watch")}
            <Typography color="text.secondary" sx={{ flexShrink: 0 }}>אין מקטעים לעריכה.</Typography>
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
