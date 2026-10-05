import { Dialog, DialogContent, DialogTitle, LinearProgress, Stack, Typography } from '@mui/material';
import type { BurnProgress } from '../utils/burnRequest';

export function BurnProgressDialog({ open, progress }: { open: boolean; progress: BurnProgress }) {
  const determinate = progress.stage === 'burning' && progress.percent !== null;
  const label = progress.stage === 'burning' ? 'צורב את הכתוביות על הסרטון…'
    : progress.stage === 'downloading' ? 'הצריבה הסתיימה, מעביר את הסרטון אליכם…' : 'מכין את הסרטון לצריבה…';
  return <Dialog open={open} disableEscapeKeyDown fullWidth maxWidth="xs" aria-labelledby="burn-progress-title" dir="rtl">
    <DialogTitle id="burn-progress-title">מכין את הסרטון עם הכתוביות</DialogTitle>
    <DialogContent>
      <Stack spacing={2} sx={{ py: 1 }} role="status" aria-live="polite">
        <Typography>{label}</Typography>
        <LinearProgress aria-label="התקדמות צריבת כתוביות" variant={determinate ? 'determinate' : 'indeterminate'} value={progress.percent ?? 0} />
        {determinate && <Typography variant="body2" textAlign="center">{progress.percent}%</Typography>}
        <Typography variant="body2" color="text.secondary">הפעולה עשויה לקחת כמה דקות, בהתאם לאורך הסרטון. השאירו את החלון פתוח עד לסיום.</Typography>
      </Stack>
    </DialogContent>
  </Dialog>;
}
