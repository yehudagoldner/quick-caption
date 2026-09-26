import { useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { Pause, PlayArrow, Replay } from "@mui/icons-material";
import type { Segment, Word } from "../types";
import { MobileWordTimeline } from "./MobileWordTimeline";
import { formatTimecode } from "../utils/timecode";
import { useVideoPlayer } from "./VideoPlayer";

export function MobileWordTimelineDialog({ segment, words, fps, currentTime, activeWordEnabled, disabled,
  onSave, onClose, onSeek, onInteract, onUndo, onRedo, canUndo, canRedo, onDraftStateChange,
}: {
  segment: Segment; words: Word[]; fps: number; currentTime: number; activeWordEnabled: boolean; disabled: boolean;
  onSave: (words: Word[]) => Promise<void>; onClose: () => void; onSeek: (time: number) => void; onInteract: () => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; onDraftStateChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<Word[] | null>(null);
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
  const inFlight = useRef(false);
  const notifyDraft = useRef(onDraftStateChange);
  notifyDraft.current = onDraftStateChange;
  useEffect(() => { notifyDraft.current(draft !== null || saving); }, [draft, saving]);
  useEffect(() => () => notifyDraft.current(false), []);
  const save = async (next: Word[]) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setDraft(next);
    setSaving(true);
    setError(null);
    try { await onSave(next); setDraft(null); }
    catch { setError("שמירת התזמון נכשלה. השינוי נשאר בציר; נסו לשמור שוב או בטלו את השינוי."); }
    finally { inFlight.current = false; setSaving(false); }
  };
  const close = () => { if (!inFlight.current && !draft) onClose(); };
  return <Dialog open fullWidth maxWidth="sm" dir="rtl" onClose={close} disableEscapeKeyDown={saving || draft !== null}
    slotProps={{ paper: { sx: { m: { xs: 1.5, sm: 4 }, width: { xs: "calc(100% - 24px)", sm: "calc(100% - 64px)" } } } }}>
    <DialogTitle sx={{ pb: 0.5 }}>תזמון מילים בכתובית</DialogTitle>
    <DialogContent sx={{ px: { xs: 1.5, sm: 3 } }}>
      <Typography sx={{ mb: 0.5, overflowWrap: "anywhere" }}>{segment.text}</Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>גבולות הכתובית: <span dir="ltr">{formatTimecode(segment.start, fps)} – {formatTimecode(segment.end, fps)}</span></Typography>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", mb: 0.5 }}>
        <Button variant="contained" startIcon={playing ? <Pause /> : <PlayArrow />} disabled={!player}
          onClick={() => playing ? stop() : listen()}>{playing ? "השהיה" : "השמעת הכתובית"}</Button>
        <Button startIcon={<Replay />} disabled={!player} onClick={() => listen(true)}>מההתחלה</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>בחרו מיקום בציר והאזינו ממנו. ההשמעה נעצרת בסוף הכתובית.</Typography>
      {playbackError && <Alert severity="error" sx={{ mb: 1 }}>{playbackError}</Alert>}
      <MobileWordTimeline segment={segment} words={draft ?? words} fps={fps} currentTime={currentTime} activeWordEnabled={activeWordEnabled}
        disabled={disabled || saving} saving={saving} onChange={next => void save(next)} onSeek={time => { interact(); onSeek(time); }} onInteract={interact}
        onUndo={onUndo} onRedo={onRedo} canUndo={!draft && canUndo} canRedo={!draft && canRedo} />
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </DialogContent>
    <DialogActions sx={{ flexWrap: "wrap" }}>
      {error && draft && <>
        <Button disabled={saving || disabled} onClick={() => { setDraft(null); setError(null); }}>ביטול השינוי</Button>
        <Button disabled={saving || disabled} onClick={() => void save(draft)}>שמירה חוזרת</Button>
      </>}
      <Button variant="contained" disabled={saving || draft !== null} onClick={close}>סיום</Button>
    </DialogActions>
  </Dialog>;
}
