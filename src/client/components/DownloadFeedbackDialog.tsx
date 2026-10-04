import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Rating, Stack, TextField, Typography } from '@mui/material';

export function DownloadFeedbackDialog({ open, onClose, onSubmit }: {
  open: boolean; onClose: () => void; onSubmit: (rating: number, feedback: string) => Promise<void>;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!rating || saving) return;
    setSaving(true); setError(null);
    try { await onSubmit(rating, feedback); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'שמירת הדירוג נכשלה. נסו שוב.'); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onClose={() => { if (!saving) onClose(); }} fullWidth maxWidth="xs" dir="rtl" aria-labelledby="download-feedback-title">
    <DialogTitle id="download-feedback-title">איך הייתה החוויה?</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      <Typography>הורדת הסרטון התחילה. נשמח לשמוע איך היה להשתמש ב־Quick Caption.</Typography>
      <Typography fontWeight={600}>דירוג החוויה: 1 עד 5 כוכבים</Typography>
      <Rating name="download-experience-rating" value={rating} onChange={(_, value) => setRating(value)} disabled={saving} dir="rtl"
        getLabelText={value => `${value} ${value === 1 ? 'כוכב' : 'כוכבים'}`} size="large" sx={{ alignSelf: 'center' }} />
      <TextField label="פידבק על החוויה (לא חובה)" multiline minRows={3} value={feedback} onChange={e => setFeedback(e.target.value)} disabled={saving}
        slotProps={{ htmlInput: { maxLength: 2000 } }} helperText={`${feedback.length}/2000`} />
      {error && <Alert severity="error">{error}</Alert>}
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose} disabled={saving}>אולי אחר כך</Button>
      <Button variant="contained" disabled={!rating || saving} onClick={() => void submit()}>{saving ? 'שומר...' : 'שליחת דירוג'}</Button>
    </DialogActions>
  </Dialog>;
}
