import { useContext, useState, type ChangeEvent } from 'react';
import { Alert, Box, Button, ButtonBase, FormControlLabel, Slider, Stack, Switch, Tab, Tabs, TextField, Typography } from '@mui/material';
import { AlignHorizontalCenterRounded, CropRotateRounded } from '@mui/icons-material';
import { CaptionAppearanceContext } from '../contexts/CaptionAppearanceContext';
import { useCaptionLivePatch } from '../hooks/useCaptionLivePreview';
import { CaptionBackgroundSettings } from './CaptionBackgroundSettings';
import { CaptionFontPicker } from './CaptionFontPicker';
import { WordAppearanceContext } from '../contexts/WordAppearanceContext';

const SWATCHES = ['#ffffff', '#000000', '#ffd700', '#ff3b30', '#34c759', '#38bdf8', '#a855f7'];
const COLORS = [['fontColor', 'צבע הכתובית', 'טקסט'], ['outlineColor', 'צבע מסגרת הכתובית', 'מסגרת'], ['activeWordColor', 'צבע המילה הפעילה', 'מילה פעילה']] as const;
const SLIDERS = [['positionXPercent', 'מיקום אופקי', 0, 100, '%'], ['offsetYPercent', 'גובה מהתחתית', 0, 100, '%'], ['rotation', 'סיבוב', -180, 180, '°']] as const;
type SliderKey = typeof SLIDERS[number][0];
const swatchSx = { width: { xs: 30, md: 24 }, height: { xs: 30, md: 24 }, flexShrink: 0, borderRadius: '50%', border: '1px solid rgba(15, 23, 42, .2)' };
const selectedRing = '0 0 0 2px #fff, 0 0 0 4px #1976d2';

export function CaptionAppearanceEditor() {
  const editor = useContext(CaptionAppearanceContext);
  const wordEditor = useContext(WordAppearanceContext);
  const live = useCaptionLivePatch(editor?.live);
  const [tab, setTab] = useState<'font' | 'color' | 'layout'>('font');
  if (!editor?.segment) return null;
  const { change, saving } = editor;
  const values = { ...editor.values, ...live };
  const slide = (key: SliderKey, value: number) => editor.live.set({ ...editor.live.get(), [key]: value });
  const settle = (key: SliderKey, value: number) => editor.commit({ ...editor.live.get(), [key]: value });
  return <Stack spacing={1.25} dir="rtl" role="region" aria-label="עיצוב כתובית נבחרת" sx={{ p: { xs: 0, md: 2 }, pt: { xs: .5, md: 2 }, minWidth: 0 }}>
    <Box sx={{ display: { xs: 'none', md: 'block' } }}>
      <Typography fontWeight={600}>עיצוב הכתובית הזו בלבד</Typography>
      <Typography variant="body2" color="text.secondary" noWrap>{editor.segment.text}</Typography>
    </Box>
    <Typography variant="caption" color="text.secondary">גררו להזזה · פינות לשינוי גודל · ידית עליונה לסיבוב · בטלפון גם צביטה בשתי אצבעות</Typography>
    {wordEditor && <Typography variant="caption" color="text.secondary">לחצו על מילה בתצוגה לשינוי צבע, גודל והדגשה. לבחירת כמה מילים: Ctrl / ⌘ + לחיצה.</Typography>}
    {editor.error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={editor.retry}>נסו שוב</Button>}>{editor.error}</Alert>}
    <Box>
      <FormControlLabel sx={{ m: 0 }} label="מילה אקטיבית בכתובית הזו"
        control={<Switch checked={values.activeWordEnabled} disabled={editor.disabled}
          onChange={(_, checked) => change({ activeWordEnabled: checked })} />} />
      <Stack direction="row" alignItems="center" justifyContent="space-between" useFlexGap flexWrap="wrap">
        <Typography variant="caption" color="text.secondary">{editor.activeWordOverride === undefined ? 'לפי ההגדרה הכללית של הסרטון' : 'הגדרה נפרדת לכתובית הזו'}</Typography>
        <Button size="small" disabled={editor.disabled || editor.activeWordOverride === undefined}
          aria-label="חזרה להגדרה הכללית של מילה אקטיבית" onClick={() => change({ activeWordEnabled: undefined })}>לפי ההגדרה הכללית</Button>
      </Stack>
    </Box>
    <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="fullWidth" aria-label="אפשרויות עיצוב הכתובית"
      sx={{ minHeight: 40, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 40, py: .5 } }}>
      <Tab value="font" label="גופן" />
      <Tab value="color" label="צבע" />
      <Tab value="layout" label="מיקום" />
    </Tabs>
    {tab === 'font' && <Stack spacing={1.5} role="tabpanel" aria-label="גופן">
      <CaptionFontPicker fontId={values.fontId} onFontChange={fontId => change({ fontId })} />
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Slider aria-label="גודל" value={Math.min(values.fontSize, 300)} min={12} max={300} sx={{ flex: 1 }}
          onChange={(_, value) => editor.live.set({ ...editor.live.get(), fontSize: value as number })}
          onChangeCommitted={(_, value) => editor.commit({ ...editor.live.get(), fontSize: value as number })} />
        <TextField label="גודל גופן לכתובית" type="number" size="small" value={values.fontSize} sx={{ width: 104 }}
          inputProps={{ min: 12, max: 1000 }} onChange={event => { if (event.target.value) change({ fontSize: Number(event.target.value) }); }} />
      </Stack>
    </Stack>}
    {tab === 'color' && <Stack spacing={1.5} role="tabpanel" aria-label="צבע">
      <CaptionBackgroundSettings backgroundColor={values.backgroundColor} backgroundOpacity={values.backgroundOpacity} disabled={editor.disabled}
        onChange={patch => { if (patch.backgroundOpacity !== undefined) editor.live.set({ ...editor.live.get(), ...patch }); else change(patch); }}
        onCommit={patch => editor.commit({ ...editor.live.get(), ...patch })} />
      {COLORS.map(([key, label, short]) => <Box key={key}>
        <Typography variant="body2" sx={{ mb: .75 }}>{short}</Typography>
        <Stack direction="row" spacing={.75} alignItems="center" useFlexGap flexWrap="wrap">
          {SWATCHES.map(color => <ButtonBase key={color} aria-label={`${label}: ${color}`} aria-pressed={values[key].toLowerCase() === color}            onClick={() => change({ [key]: color })} sx={{ ...swatchSx, bgcolor: color, boxShadow: values[key].toLowerCase() === color ? selectedRing : 'none' }} />)}
          <Box title="צבע מותאם" sx={{ ...swatchSx, position: 'relative', overflow: 'hidden',
            background: SWATCHES.includes(values[key].toLowerCase()) ? 'conic-gradient(#ff3b30, #ffd700, #34c759, #38bdf8, #a855f7, #ff3b30)' : values[key],
            boxShadow: SWATCHES.includes(values[key].toLowerCase()) ? 'none' : selectedRing }}>
            <Box component="input" type="color" aria-label={label} value={values[key]}              onChange={(event: ChangeEvent<HTMLInputElement>) => change({ [key]: event.target.value })}
              sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 0, p: 0 }} />
          </Box>
        </Stack>
      </Box>)}
    </Stack>}
    {tab === 'layout' && <Stack spacing={.5} role="tabpanel" aria-label="מיקום">
      {SLIDERS.map(([key, label, min, max, unit]) => <Box key={key}>
        <Typography variant="body2">{label}: {Math.round(values[key])}{unit}</Typography>
        <Slider aria-label={label} value={values[key]} min={min} max={max} step={key === 'rotation' ? 1 : .01}
          marks={key === 'rotation' ? [{ value: 0 }] : [{ value: 50 }]}
          onChange={(_, value) => slide(key, value as number)} onChangeCommitted={(_, value) => settle(key, value as number)} />
      </Box>)}
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" startIcon={<CropRotateRounded />} onClick={() => change({ rotation: 0 })}>יישור הכתובית</Button>
        <Button size="small" variant="outlined" startIcon={<AlignHorizontalCenterRounded />} onClick={() => change({ positionXPercent: 50 })}>מרכוז אופקי</Button>
      </Stack>
    </Stack>}
    <Stack direction="row" spacing={1} sx={{ pt: .5 }}>
      <Button variant="contained" sx={{ flex: 1 }} onClick={editor.close}>סיום</Button>
      <Button variant="outlined" onClick={editor.revert} disabled={!editor.dirty}>ביטול השינויים</Button>
    </Stack>
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Button size="small" color="inherit" onClick={editor.reset}>חזרה לעיצוב הכללי</Button>
      <Typography variant="caption" color="text.secondary" role="status">{saving ? 'שומר...' : 'נשמר אוטומטית'}</Typography>
    </Stack>
  </Stack>;
}
