import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { PreviewQuality } from '../hooks/useVideoPreview';

export function VideoPreviewQuality({ status, quality, qualities, disabled, error, onChange, onRetry, onSource }: {
  status: string; quality: PreviewQuality; qualities: PreviewQuality[]; disabled: boolean; error: string | null;
  onChange: (quality: PreviewQuality) => void; onRetry: () => void; onSource: () => void;
}) {
  if (status === 'source') return <TextField select fullWidth size="small" label="איכות תצוגה מקדימה" value="source" disabled helperText="הניגון משתמש בקובץ המקור."><MenuItem value="source">איכות מקור</MenuItem></TextField>;
  return <Stack spacing={1} dir="rtl">
    {status === 'rendition' ? <>
      <TextField select size="small" label="איכות תצוגה מקדימה" value={quality} disabled={disabled} onChange={event => onChange(event.target.value as PreviewQuality)} sx={{ minWidth: 210, alignSelf: 'flex-start' }}>
        {qualities.map(value => <MenuItem key={value} value={value}>{value}{value === '720p' ? ' — עריכה מהירה' : value === '1080p' ? ' — פירוט גבוה' : ''}</MenuItem>)}
      </TextField>
      <Typography variant="caption" color="text.secondary">איכות הניגון בעורך בלבד. הייצוא משתמש בקובץ המקור ובהגדרות הייצוא שבחרתם.</Typography>
    </> : <Alert severity={error ? 'warning' : 'info'} action={status !== 'loading' && <Button disabled={disabled} onClick={onRetry}>נסה שוב</Button>}>
      {error || (status === 'pending' ? 'גרסת העריכה עדיין בהכנה. ננסה שוב אוטומטית בעוד כמה שניות.' : status === 'unavailable' ? 'גרסת העריכה הקלה עדיין אינה זמינה.' : 'טוען את התצוגה המקדימה...')}
    </Alert>}
    {['pending', 'unavailable', 'error'].includes(status) && <Button disabled={disabled} onClick={onSource} sx={{ alignSelf: 'flex-start' }}>ניגון קובץ המקור (טעינה כבדה)</Button>}
  </Stack>;
}
