import { useContext, useState } from 'react';
import { Alert, Box, Button, ButtonBase, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import type { Segment, Word } from '../types';
import { WordAppearanceContext } from '../contexts/WordAppearanceContext';
import { sanitizeWordOverrides, type WordOverrides } from '../../wordOverrides.js';

export function WordAppearanceToolbar({ segmentId, words, close }: { segmentId: Segment['id']; words: Word[]; close: () => void }) {
  const editor = useContext(WordAppearanceContext)!;
  const [failed, setFailed] = useState<{ patch: WordOverrides | null } | null>(null);
  const styles = words.map(word => sanitizeWordOverrides(word.style));
  const scales = styles.map(style => style.fontScale ?? 1);
  const scale = scales.every(value => value === scales[0]) ? scales[0] : '';
  const bold = styles.every(style => style.bold);
  const apply = async (patch: WordOverrides | null) => {
    setFailed(null);
    try { await editor.change(segmentId, words.map(word => word.wordIndex!), patch); }
    catch { setFailed({ patch }); }
  };
  return <Paper data-word-toolbar role="region" aria-label="עיצוב מילים נבחרות" dir="rtl" elevation={4}
    sx={{ position: 'absolute', top: 8, zIndex: 5, width: 'calc(100% - 16px)', maxWidth: 580, p: 1.25, borderRadius: 2 }}>
    <Stack spacing={1}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2" fontWeight={600} noWrap sx={{ minWidth: 0 }}>עיצוב: {words.map(word => word.word).join(' · ')}</Typography>
        <Button size="small" onClick={close} disabled={editor.saving}>סיום עריכת מילים</Button>
      </Stack>
      <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1} alignItems="center">
        <TextField select label="גודל המילים" size="small" value={scale} disabled={editor.disabled} sx={{ width: 108 }}
          onChange={event => void apply({ fontScale: Number(event.target.value) })}>
          <MenuItem value="" disabled>מעורב</MenuItem>
          {[.5, .75, 1, 1.25, 1.5, 1.75, 2].map(value => <MenuItem key={value} value={value}>{value * 100}%</MenuItem>)}
        </TextField>
        <Button size="small" variant={bold ? 'contained' : 'outlined'} aria-pressed={bold} disabled={editor.disabled}
          onClick={() => void apply({ bold: !bold })} sx={{ fontWeight: 900, minWidth: 52 }}>מודגש</Button>
        {['#ffffff', '#ffd700', '#ff3b30', '#38bdf8'].map(value => <ButtonBase key={value} disabled={editor.disabled}
          aria-label={`צבע המילים: ${value}`} onClick={() => void apply({ fontColor: value })}
          sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: value, border: '1px solid #94a3b8',
            outline: styles.every(style => style.fontColor === value) ? '2px solid #1976d2' : undefined, outlineOffset: 2 }} />)}
        <Box component="input" type="color" aria-label="צבע מילים מותאם" value={styles[0]?.fontColor ?? '#ffffff'} disabled={editor.disabled}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => void apply({ fontColor: event.target.value })}
          sx={{ width: 28, height: 28, padding: 0, border: 0, cursor: 'pointer' }} />
        <Button size="small" disabled={editor.disabled || !styles.some(style => Object.keys(style).length)} onClick={() => void apply(null)}>איפוס לעיצוב הכתובית</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" role="status">{editor.saving ? 'שומר...' : 'בגרסה הנוכחית · Ctrl / ⌘ + לחיצה לבחירת כמה מילים · הגודל יחסי לכתובית'}</Typography>
      {failed && <Alert severity="error" action={<Button disabled={editor.disabled} onClick={() => void apply(failed.patch)}>נסו שוב</Button>}>שמירת עיצוב המילים נכשלה. אפשר לנסות שוב.</Alert>}
    </Stack>
  </Paper>;
}
