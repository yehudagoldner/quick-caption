import { useContext } from 'react';
import { Alert, Box, Button, Slider, Stack, TextField, Typography } from '@mui/material';
import { CaptionAppearanceContext } from '../contexts/CaptionAppearanceContext';
import { CaptionFontPicker } from './CaptionFontPicker';

export function CaptionAppearanceEditor() {
  const editor = useContext(CaptionAppearanceContext);
  if (!editor?.segment) return null;
  const { values, change, saving } = editor;
  return <Stack spacing={1.5} dir="rtl" role="region" aria-label="עיצוב כתובית נבחרת" sx={{ p: 2, minWidth: 0 }}>
    <Typography fontWeight={600}>עיצוב הכתובית הזו בלבד</Typography>
    <Typography variant="body2" noWrap>{editor.segment.text}</Typography>
    <Typography variant="caption" color="text.secondary">גררו להזזה, גררו את הידית העגולה לסיבוב. בשתי אצבעות אפשר לסובב ולהגדיל או להקטין.</Typography>
    {editor.error && <Alert severity="error">{editor.error}</Alert>}
    <CaptionFontPicker fontId={values.fontId} onFontChange={fontId => change({ fontId })} disabled={saving} />
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
      <TextField label="גודל גופן לכתובית" type="number" size="small" value={values.fontSize} disabled={saving}
        inputProps={{ min: 12, max: 1000 }} onChange={event => { if (event.target.value) change({ fontSize: Number(event.target.value) }); }} />
      {(['fontColor', 'outlineColor', 'activeWordColor'] as const).map((key, index) => <TextField key={key} type="color" size="small"
        label={['צבע הכתובית', 'צבע מסגרת הכתובית', 'צבע המילה הפעילה'][index]} value={values[key]} disabled={saving}
        onChange={event => change({ [key]: event.target.value })} InputLabelProps={{ shrink: true }} />)}
    </Box>
    {(['positionXPercent', 'offsetYPercent', 'rotation'] as const).map((key, index) => <Box key={key}>
      <Typography variant="body2">{['מיקום אופקי', 'גובה מהתחתית', 'סיבוב'][index]}: {values[key]}{key === 'rotation' ? '°' : '%'}</Typography>
      <Slider aria-label={['מיקום אופקי', 'גובה מהתחתית', 'סיבוב'][index]} value={values[key]} disabled={saving}
        min={key === 'rotation' ? -180 : 0} max={key === 'rotation' ? 180 : 100} step={key === 'rotation' ? 1 : .01} valueLabelDisplay="auto"
        onChange={(_, value) => change({ [key]: value as number })} />
    </Box>)}
    <Stack direction="row" spacing={1}>
      <Button disabled={saving} onClick={() => change({ rotation: 0 })}>יישור הכתובית</Button>
      <Button disabled={saving} onClick={() => change({ positionXPercent: 50 })}>מרכוז אופקי</Button>
    </Stack>
    <Button onClick={editor.reset} disabled={saving}>חזרה לעיצוב הכללי</Button>
    <Stack direction="row" spacing={1}>
      <Button variant="contained" onClick={() => void editor.save()} disabled={saving || !editor.dirty}>{saving ? 'שומר...' : 'שמירת עיצוב הכתובית'}</Button>
      <Button onClick={editor.close} disabled={saving}>{editor.dirty ? 'ביטול' : 'סיום'}</Button>
    </Stack>
  </Stack>;
}
