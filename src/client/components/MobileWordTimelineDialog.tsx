import { useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import type { Segment, Word } from "../types";
import { MobileWordTimeline } from "./MobileWordTimeline";
import { formatTimecode } from "../utils/timecode";

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
      <MobileWordTimeline segment={segment} words={draft ?? words} fps={fps} currentTime={currentTime} activeWordEnabled={activeWordEnabled}
        disabled={disabled || saving} saving={saving} onChange={next => void save(next)} onSeek={onSeek} onInteract={onInteract}
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
