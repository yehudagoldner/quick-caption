import { useMemo, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from '@mui/material';
import { AddRounded, CheckRounded, DeleteOutlineRounded, EditOutlined } from '@mui/icons-material';
import { CAPTION_PRESETS, readCustomCaptionPresets, sameCaptionAppearance, sanitizeCaptionAppearance, type CaptionAppearance, type CaptionPreset } from '../../captionPresets.js';
import { useCaptionFont } from '../hooks/useCaptionFont';
import { apiUserUid } from '../api';

function StyleCard({ preset, selected, disabled, onApply, onEdit, onDelete }: {
  preset: CaptionPreset; selected: boolean; disabled: boolean; onApply: () => void; onEdit?: () => void; onDelete?: () => void;
}) {
  const { font, ready } = useCaptionFont(preset.style.fontId);
  const pop = preset.style.captionMotion === 'pop';
  return <Box sx={{ borderRadius: 2, border: '2px solid', borderColor: selected ? 'primary.main' : 'divider', overflow: 'hidden', bgcolor: 'background.paper' }}>
    <ButtonBase aria-label={`בחירת סגנון ${preset.name}`} aria-pressed={selected} disabled={disabled} onClick={onApply}
      sx={{ width: '100%', display: 'block', textAlign: 'start', '&.Mui-focusVisible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: -3 },
        '&:hover .caption-style-sample': pop ? { animation: `caption-style-pop ${preset.style.popIntensity === 'strong' ? 220 : 160}ms linear` } : {},
        '@keyframes caption-style-pop': { '0%': { transform: `scale(${preset.style.popIntensity === 'strong' ? .65 : .82})` }, '30%': { transform: 'scale(.96)' }, '65%': { transform: `scale(${preset.style.popIntensity === 'strong' ? 1.12 : 1.05})` }, '100%': { transform: 'scale(1)' } },
        '@media (prefers-reduced-motion: reduce)': { '&:hover .caption-style-sample': { animation: 'none' } } }}>
      <Box sx={{ height: 92, position: 'relative', display: 'grid', placeItems: 'center', overflow: 'hidden', px: 1.5,
        background: 'radial-gradient(ellipse at 15% 0%, #544877 0%, transparent 65%), radial-gradient(ellipse at 95% 100%, #2d5959 0%, transparent 60%), #151c2b' }}>
        {selected && <CheckRounded sx={{ position: 'absolute', top: 6, right: 6, color: '#fff', fontSize: 18 }} />}
        <Box component="span" className="caption-style-sample" dir="rtl" sx={{ fontFamily: `"${font.cssFamily}"`, fontWeight: font.weight,
          fontSize: 26, lineHeight: 1.4, textAlign: 'center', color: preset.style.fontColor, opacity: ready ? 1 : .65,
          textShadow: `-1px -1px 0 ${preset.style.outlineColor}, 1px -1px 0 ${preset.style.outlineColor}, -1px 1px 0 ${preset.style.outlineColor}, 1px 1px 0 ${preset.style.outlineColor}`,
          display: 'inline-block', transformOrigin: '50% 100%' }}>
          {pop ? 'המילים שלך' : <>המילים <span style={{ color: preset.style.activeWordEnabled ? preset.style.activeWordColor : 'inherit' }}>שלך</span></>}
        </Box>
      </Box>
      <Box sx={{ px: 1.25, py: 1 }}>
        <Typography component="div" sx={{ fontSize: 14, fontWeight: 700 }}>{preset.name} {preset.id === 'clean' && <Chip label="מומלץ" size="small" sx={{ height: 18, fontSize: 10, mx: .5 }} />}</Typography>
        <Typography component="div" color="text.secondary" sx={{ fontSize: 11, minHeight: 30, mt: .25 }}>{preset.description}</Typography>
      </Box>
    </ButtonBase>
    {onDelete && <Stack direction="row" justifyContent="flex-end" sx={{ px: .5, borderTop: '1px solid', borderColor: 'divider' }}>
      <IconButton size="small" aria-label={`שינוי שם ${preset.name}`} disabled={disabled} onClick={onEdit}><EditOutlined fontSize="small" /></IconButton>
      <IconButton size="small" aria-label={`מחיקת סגנון ${preset.name}`} disabled={disabled} onClick={onDelete}><DeleteOutlineRounded fontSize="small" /></IconButton>
    </Stack>}
  </Box>;
}

export function CaptionStylePicker({ appearance, onApply, disabled = false }: {
  appearance: CaptionAppearance; onApply: (style: CaptionAppearance) => void; disabled?: boolean;
}) {
  const key = `caption-templates:${apiUserUid()}`;
  const loaded = useMemo(() => { try { return readCustomCaptionPresets(localStorage.getItem(key)); } catch { return []; } }, [key]);
  const [saved, setSaved] = useState({ key, values: loaded });
  const custom = saved.key === key ? saved.values : loaded;
  const [category, setCategory] = useState('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const presets = category === 'custom' ? custom : CAPTION_PRESETS.filter(preset => category === 'all' || preset.category === category);
  const store = (values: CaptionPreset[]) => {
    try { localStorage.setItem(key, JSON.stringify(values)); setSaved({ key, values }); setError(''); return true; }
    catch { setError('לא ניתן לשמור סגנונות בדפדפן כרגע. נסו שוב.'); return false; }
  };
  const save = () => {
    const nextName = name.trim();
    if (!nextName) return;
    const values = editing === 'new' ? [...custom, { id: `custom-${crypto.randomUUID()}`, name: nextName, category: 'custom', description: 'הסגנון שלך', style: sanitizeCaptionAppearance(appearance) }]
      : custom.map(preset => preset.id === editing ? { ...preset, name: nextName } : preset);
    if (store(values)) { setEditing(null); setCategory('custom'); setAnnouncement(`הסגנון ${nextName} נשמר`); }
  };
  return <Box data-testid="caption-style-library" dir="rtl" sx={{ minWidth: 0 }}>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>בחרו מראה לכתוביות. אפשר לשנות אותו גם אחרי הבחירה.</Typography>
    <Stack direction="row" flexWrap="wrap" gap={.75} role="group" aria-label="קטגוריות סגנונות" sx={{ mb: 1.5 }}>
      {[['all', 'הכול'], ['clean', 'נקי'], ['bold', 'בולט'], ['playful', 'צבעוני'], ['custom', 'שלי']].map(([id, label]) =>
        <Button key={id} size="small" variant={category === id ? 'contained' : 'outlined'} aria-pressed={category === id} onClick={() => setCategory(id)} sx={{ borderRadius: 6, minWidth: 44 }}>{label}</Button>)}
    </Stack>
    {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
      {presets.map(preset => <StyleCard key={preset.id} preset={preset} selected={sameCaptionAppearance(appearance, preset.style)} disabled={disabled}
        onApply={() => { onApply(preset.style); setAnnouncement(`הסגנון ${preset.name} הוחל`); }}
        onEdit={category === 'custom' ? () => { setEditing(preset.id); setName(preset.name); } : undefined}
        onDelete={category === 'custom' ? () => { if (store(custom.filter(value => value.id !== preset.id))) setAnnouncement(`הסגנון ${preset.name} נמחק`); } : undefined} />)}
    </Box>
    {category === 'custom' && !custom.length && <Typography sx={{ py: 2 }} variant="body2" color="text.secondary">שמרו את העיצוב הנוכחי כדי להשתמש בו גם בסרטונים הבאים.</Typography>}
    <Button fullWidth variant="outlined" startIcon={<AddRounded />} disabled={disabled || custom.length >= 24}
      onClick={() => { setName(''); setEditing('new'); }} sx={{ mt: 1.5, borderStyle: 'dashed' }}>שמירת העיצוב כסגנון אישי</Button>
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>הסגנונות האישיים נשמרים בדפדפן הזה.{custom.length >= 24 ? ' ניתן לשמור עד 24 סגנונות.' : ''}</Typography>
    <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>{announcement}</Box>
    <Dialog open={editing !== null} onClose={() => setEditing(null)} fullWidth maxWidth="xs">
      <DialogTitle>{editing === 'new' ? 'שמירת סגנון אישי' : 'שינוי שם הסגנון'}</DialogTitle>
      <DialogContent><TextField autoFocus fullWidth label="שם הסגנון" value={name} onChange={event => setName(event.target.value)} inputProps={{ maxLength: 40 }} sx={{ mt: 1 }} />{error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}</DialogContent>
      <DialogActions><Button onClick={() => setEditing(null)}>ביטול</Button><Button disabled={disabled || !name.trim()} variant="contained" onClick={save}>שמירה</Button></DialogActions>
    </Dialog>
  </Box>;
}
