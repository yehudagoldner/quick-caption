import { useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { PlayArrowRounded } from "@mui/icons-material";
import type { Segment, Word } from "../types";
import { validateWordRange } from "../../timelineEditing.js";
import { formatTimecode } from "../utils/timecode";
import { TimecodeField } from "./TimecodeField";

export function MobileWordTimingDialog({ segment, words, fps, onSave, onClose, onSeek }: {
  segment: Segment; words: Word[]; fps: number;
  onSave: (words: Word[]) => Promise<void>; onClose: () => void; onSeek: (time: number) => void;
}) {
  const [draft, setDraft] = useState(() => words.map(word => ({ ...word })));
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const errors = draft.map((word, index) => validateWordRange(word, segment, draft.filter((_, other) => other !== index)) ||
    (index > 0 && word.start < draft[index - 1].start ? "תזמון המילים חייב לשמור על סדר המילים במקטע." : null));
  const dirty = draft.some((word, index) => word.start !== words[index]?.start || word.end !== words[index]?.end);
  const setValidity = (key: string, valid: boolean) => setInvalidFields(current => current[key] === !valid ? current : { ...current, [key]: !valid });
  const changeTime = (index: number, edge: "start" | "end", value: number) => {
    setDraft(current => current.map((word, i) => i === index ? { ...word, [edge]: value, timingSource: "aligned" } : word));
    setSaveError(null);
  };
  const save = async () => {
    if (saving || errors.some(Boolean) || Object.values(invalidFields).some(Boolean)) return;
    setSaving(true);
    setSaveError(null);
    try { await onSave(draft); onClose(); }
    catch { setSaveError("שמירת התזמון נכשלה. השינויים נשארו כאן; נסו לשמור שוב."); }
    finally { setSaving(false); }
  };

  return <Dialog open fullWidth maxWidth="sm" dir="rtl" onClose={saving ? undefined : onClose}>
    <DialogTitle>תזמון מילים</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        <Typography variant="body2">אפשר להקליד זמן או לדייק בפריים אחד באמצעות כפתורי הפלוס והמינוס.</Typography>
        <Typography variant="caption">גבולות המקטע: <span dir="ltr">{formatTimecode(segment.start, fps)} – {formatTimecode(segment.end, fps)}</span></Typography>
        {draft.map((word, index) => <Stack key={index} spacing={1} component="section" aria-label={`תזמון מילה ${index + 1}: ${word.word}`} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography fontWeight={600}>{index + 1}. {word.word}</Typography>
            <Button size="small" startIcon={<PlayArrowRounded />} disabled={saving} aria-label={`מעבר למילה ${index + 1}: ${word.word}`} onClick={() => onSeek(word.start + Math.min(.001, (word.end - word.start) / 2))}>מעבר למילה</Button>
          </Stack>
          <Stack spacing={1} sx={{ "& > *": { minWidth: 0 } }}>
            <TimecodeField label="תחילת המילה" value={word.start} fps={fps} disabled={saving} onChange={time => changeTime(index, "start", time)} onValidityChange={valid => setValidity(`${index}-start`, valid)} />
            <TimecodeField label="סיום המילה" value={word.end} fps={fps} disabled={saving} onChange={time => changeTime(index, "end", time)} onValidityChange={valid => setValidity(`${index}-end`, valid)} />
          </Stack>
          {errors[index] && <Alert severity="warning">{errors[index]}</Alert>}
        </Stack>)}
        {saveError && <Alert severity="error">{saveError}</Alert>}
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button disabled={saving} onClick={onClose}>ביטול</Button>
      <Button variant="contained" disabled={saving || !dirty || errors.some(Boolean) || Object.values(invalidFields).some(Boolean)} onClick={() => void save()}>{saving ? "שומר..." : "שמירת תזמון"}</Button>
    </DialogActions>
  </Dialog>;
}
