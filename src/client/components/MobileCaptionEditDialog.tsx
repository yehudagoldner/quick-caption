import { useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from "@mui/material";
import { ChevronLeftRounded, ChevronRightRounded, Pause, PlayArrow, Replay } from "@mui/icons-material";
import type { Segment, Word } from "../types";
import { MobileWordTimeline } from "./MobileWordTimeline";
import { formatTimecode } from "../utils/timecode";
import { useVideoPlayer } from "./VideoPlayer";
import { synchronizeWords } from '../../wordAlignment.js';
import { useEditorPreferences } from '../contexts/EditorPreferences';

export function MobileCaptionEditDialog({ segment, words, fps, currentTime, activeWordEnabled, disabled,
  onSave, onClose, onSeek, onInteract, onUndo, onRedo, canUndo, canRedo, onDraftStateChange,
  registerFlush, onSelectAdjacent, previousDisabled, nextDisabled,
}: {
  segment: Segment; words: Word[]; fps: number; currentTime: number; activeWordEnabled: boolean; disabled: boolean;
  onSave: (segment: Segment, words: Word[]) => Promise<void>; onClose: () => void; onSeek: (time: number) => void; onInteract: () => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; onDraftStateChange: (dirty: boolean) => void;
  registerFlush: (flush: (() => Promise<boolean>) | null) => void;
  onSelectAdjacent: (delta: number) => void; previousDisabled: boolean; nextDisabled: boolean;
}) {
  const { preferences } = useEditorPreferences();
  const [text, setText] = useState(segment.text);
  const textRef = useRef(text);
  const savedText = useRef(segment.text);
  const [draft, setDraft] = useState<Word[] | null>(null);
  const draftRef = useRef<Word[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = useVideoPlayer();
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const playbackRequest = useRef(0);
  const stop = () => {
    playbackRequest.current++;
    player?.pause();
    setPlaying(false);
  };
  useEffect(() => {
    if (!player) return;
    let frame = 0;
    const checkBounds = () => {
      const end = Number.isFinite(player.duration) ? Math.min(segment.end, player.duration) : segment.end;
      if (player.currentTime >= end || player.currentTime < segment.start) {
        player.pause();
        const boundedTime = Math.max(segment.start, Math.min(end, player.currentTime));
        if (Math.abs(player.currentTime - boundedTime) > 0.000001) player.currentTime = boundedTime;
        setPlaying(false);
      }
    };
    const tick = () => {
      checkBounds();
      if (!player.paused) frame = requestAnimationFrame(tick);
    };
    const play = () => { setPlaying(true); cancelAnimationFrame(frame); tick(); };
    const pause = () => { setPlaying(false); cancelAnimationFrame(frame); };
    const hide = () => { if (document.hidden) { playbackRequest.current++; player.pause(); } };
    player.addEventListener("play", play);
    player.addEventListener("pause", pause);
    player.addEventListener("ended", pause);
    player.addEventListener("timeupdate", checkBounds);
    document.addEventListener("visibilitychange", hide);
    return () => {
      playbackRequest.current++;
      cancelAnimationFrame(frame);
      player.removeEventListener("play", play);
      player.removeEventListener("pause", pause);
      player.removeEventListener("ended", pause);
      player.removeEventListener("timeupdate", checkBounds);
      document.removeEventListener("visibilitychange", hide);
      player.pause();
    };
  }, [player, segment.start, segment.end]);
  const listen = (restart = false) => {
    if (!player) return;
    onInteract();
    const request = ++playbackRequest.current;
    setPlaybackError(null);
    if (restart || player.currentTime < segment.start || player.currentTime >= segment.end - 0.01 || player.ended) onSeek(segment.start);
    player.muted = false;
    if (player.volume === 0) player.volume = 1;
    void player.play().catch(() => {
      if (request !== playbackRequest.current) return;
      setPlaying(false);
      setPlaybackError("לא ניתן להשמיע את הקטע כרגע. נסו שוב.");
    });
  };
  const interact = () => { onInteract(); stop(); };
  const inFlight = useRef<Promise<boolean> | null>(null);
  const dirtyText = text.trim() !== savedText.current.trim();
  useEffect(() => {
    if (inFlight.current) return;
    if (textRef.current.trim() === savedText.current.trim()) { textRef.current = segment.text; setText(segment.text); }
    savedText.current = segment.text;
  }, [segment.text]);
  const notifyDraft = useRef(onDraftStateChange);
  notifyDraft.current = onDraftStateChange;
  useEffect(() => { notifyDraft.current(dirtyText || draft !== null || saving); }, [dirtyText, draft, saving]);
  useEffect(() => () => notifyDraft.current(false), []);
  const save = async (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const nextText = textRef.current.trim();
    if (!nextText) { setError('הכתובית ריקה. הקלידו טקסט או בטלו את השינוי.'); return false; }
    if (nextText === savedText.current.trim() && !draftRef.current) return true;
    if (disabled) return false;
    const nextSegment = { ...segment, text: nextText };
    const nextWords = synchronizeWords([nextSegment], draftRef.current ?? words);
    setSaving(true);
    setError(null);
    const request = (async () => {
      try {
        await onSave(nextSegment, nextWords);
        savedText.current = nextText;
        draftRef.current = null; setDraft(null);
        return true;
      } catch { setError('שמירת הכתובית נכשלה. הטקסט והתזמון נשארו כאן; נסו לשמור שוב או בטלו את השינוי.'); return false; }
      finally { inFlight.current = null; setSaving(false); }
    })();
    inFlight.current = request;
    return request;
  };
  const flushRef = useRef(save);
  flushRef.current = save;
  const register = useRef(registerFlush);
  register.current = registerFlush;
  useEffect(() => {
    register.current(() => flushRef.current());
    return () => register.current(null);
  }, []);
  useEffect(() => {
    if (!dirtyText || !text.trim() || error || saving) return;
    const timer = window.setTimeout(() => { void flushRef.current(); }, 1000);
    return () => window.clearTimeout(timer);
  }, [text, dirtyText, error, saving]);
  const discard = () => {
    textRef.current = segment.text; setText(segment.text); savedText.current = segment.text;
    draftRef.current = null; setDraft(null); setError(null);
  };
  const close = async () => { if (await save()) onClose(); };
  const adjacent = async (delta: number) => { if (await save()) onSelectAdjacent(delta); };
  return <Dialog open fullWidth maxWidth="sm" dir="rtl" onClose={() => { void close(); }} disableEscapeKeyDown={saving || draft !== null}
    slotProps={{ paper: { sx: { m: { xs: 1.5, sm: 4 }, width: { xs: "calc(100% - 24px)", sm: "calc(100% - 64px)" } } } }}>
    <DialogTitle sx={{ pb: 0.5 }}>עריכת כתובית</DialogTitle>
    <DialogContent sx={{ px: { xs: 1.5, sm: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <IconButton aria-label="המקטע הקודם" disabled={previousDisabled || saving} onClick={() => void adjacent(-1)}><ChevronLeftRounded /></IconButton>
        <Typography variant="caption" color="text.secondary">טקסט ותזמון המילים</Typography>
        <IconButton aria-label="המקטע הבא" disabled={nextDisabled || saving} onClick={() => void adjacent(1)}><ChevronRightRounded /></IconButton>
      </Stack>
      <TextField label="טקסט הכתובית" multiline minRows={2} maxRows={4} fullWidth value={text} disabled={disabled || saving}
        onChange={event => { textRef.current = event.target.value; setText(event.target.value); setError(null); }}
        inputProps={{ dir: preferences.direction }} sx={{ mt: 0.5, mb: 1.5 }} />
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>גבולות הכתובית: <span dir="ltr">{formatTimecode(segment.start, fps)} – {formatTimecode(segment.end, fps)}</span></Typography>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", mb: 0.5 }}>
        <Button variant="contained" startIcon={playing ? <Pause /> : <PlayArrow />} disabled={!player}
          onClick={() => playing ? stop() : listen()}>{playing ? "השהיה" : "השמעת הכתובית"}</Button>
        <Button startIcon={<Replay />} disabled={!player} onClick={() => listen(true)}>מההתחלה</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>בחרו מיקום בציר והאזינו ממנו. ההשמעה נעצרת בסוף הכתובית.</Typography>
      {playbackError && <Alert severity="error" sx={{ mb: 1 }}>{playbackError}</Alert>}
      <MobileWordTimeline segment={segment} words={draft ?? words} fps={fps} currentTime={currentTime} activeWordEnabled={activeWordEnabled}
        disabled={disabled || saving || dirtyText} saving={saving} onChange={next => { draftRef.current = next; setDraft(next); void save(); }} onSeek={time => { interact(); onSeek(time); }} onInteract={interact}
        onUndo={onUndo} onRedo={onRedo} canUndo={!dirtyText && !draft && canUndo} canRedo={!dirtyText && !draft && canRedo} />
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </DialogContent>
    <DialogActions sx={{ flexWrap: "wrap" }}>
      {(dirtyText || draft || error) && <Button disabled={saving || disabled} onClick={discard}>ביטול השינוי</Button>}
      {error && <>
        <Button disabled={saving || disabled} onClick={() => void save()}>שמירה חוזרת</Button>
      </>}
      <Button variant="contained" disabled={saving || draft !== null} onClick={() => void close()}>{dirtyText ? 'שמירה וסיום' : 'סיום'}</Button>
    </DialogActions>
  </Dialog>;
}
