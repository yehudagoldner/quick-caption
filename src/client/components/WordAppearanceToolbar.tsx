import { useContext, useState } from 'react';
import { Alert, Box, Button, ButtonBase, CircularProgress, IconButton, Menu, MenuItem, Paper, Popover, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Close, FormatBold, MoreHoriz, PaletteOutlined } from '@mui/icons-material';
import type { Segment, Word } from '../types';
import { WordAppearanceContext } from '../contexts/WordAppearanceContext';
import { sanitizeWordOverrides, type WordOverrides } from '../../wordOverrides.js';

export function WordAppearanceToolbar({ segmentId, words, close }: { segmentId: Segment['id']; words: Word[]; close: () => void }) {
  const editor = useContext(WordAppearanceContext)!;
  const [failed, setFailed] = useState<{ patch: WordOverrides | null } | null>(null);
  const [colorsAnchor, setColorsAnchor] = useState<HTMLElement | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const styles = words.map(word => sanitizeWordOverrides(word.style));
  const scales = styles.map(style => style.fontScale ?? 1);
  const scale = scales.every(value => value === scales[0]) ? scales[0] : '';
  const bold = styles.every(style => style.bold);
  const apply = async (patch: WordOverrides | null) => {
    setFailed(null);
    try { await editor.change(segmentId, words.map(word => word.wordIndex!), patch); }
    catch { setFailed({ patch }); }
  };
  return <Paper data-word-toolbar role="region" aria-label="עיצוב מילים נבחרות" dir="rtl" elevation={0}
    onPointerDown={event => event.stopPropagation()}
    sx={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 5,
      width: 'max-content', maxWidth: 'calc(100% - 12px)', p: .5, borderRadius: 1.5, cursor: 'default', color: 'text.primary',
      bgcolor: 'rgba(255,255,255,.93)', backdropFilter: 'blur(8px)', border: '1px solid rgba(0,0,0,.08)', boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
    <Stack direction="row" alignItems="center" spacing={.25} sx={{ '& .MuiIconButton-root': { width: 28, height: 28 }, '& .MuiSvgIcon-root': { fontSize: 18 } }}>
      <Tooltip title="גודל המילים" placement="bottom">
        <TextField select size="small" value={scale} disabled={editor.disabled}
          slotProps={{ select: { displayEmpty: true, inputProps: { 'aria-label': 'גודל המילים' }, MenuProps: { transitionDuration: 0 } } }}
          sx={{ width: 66, '& .MuiOutlinedInput-root': { height: 28, fontSize: 12 }, '& .MuiSelect-select': { py: 0, pl: 1, pr: '22px !important' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' } }}
          onChange={event => void apply({ fontScale: Number(event.target.value) })}>
          <MenuItem value="" disabled>מעורב</MenuItem>
          {[.5, .75, 1, 1.25, 1.5, 1.75, 2].map(value => <MenuItem key={value} value={value}>{value * 100}%</MenuItem>)}
        </TextField>
      </Tooltip>
      <Tooltip title="מודגש"><span><IconButton aria-label="מודגש" aria-pressed={bold} disabled={editor.disabled}
        onClick={() => void apply({ bold: !bold })} sx={{ color: bold ? 'primary.main' : 'text.secondary', bgcolor: bold ? 'action.selected' : undefined }}><FormatBold /></IconButton></span></Tooltip>
      <Tooltip title="צבע המילים"><span><IconButton aria-label="צבע המילים" aria-haspopup="dialog" aria-expanded={Boolean(colorsAnchor)} disabled={editor.disabled}
        onClick={event => setColorsAnchor(event.currentTarget)}><PaletteOutlined /></IconButton></span></Tooltip>
      <Tooltip title="אפשרויות נוספות"><IconButton aria-label="אפשרויות נוספות" aria-haspopup="menu" aria-expanded={Boolean(moreAnchor)}
        onClick={event => setMoreAnchor(event.currentTarget)}><MoreHoriz /></IconButton></Tooltip>
      <Tooltip title="סיום עריכת מילים"><span><IconButton aria-label="סיום עריכת מילים" onClick={close} disabled={editor.saving}>
        {editor.saving ? <CircularProgress size={14} aria-label="שומר" /> : <Close />}
      </IconButton></span></Tooltip>
    </Stack>
    <Popover open={Boolean(colorsAnchor)} anchorEl={colorsAnchor} onClose={() => setColorsAnchor(null)} transitionDuration={0}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{ paper: { role: 'dialog', 'aria-label': 'צבע המילים', sx: { p: 1, mt: .5, borderRadius: 1.5 } } }}>
      <Stack direction="row" spacing={1} alignItems="center">
        {['#ffffff', '#ffd700', '#ff3b30', '#38bdf8'].map(value => <ButtonBase key={value} disabled={editor.disabled}
          aria-label={`צבע המילים: ${value}`} onClick={() => { setColorsAnchor(null); void apply({ fontColor: value }); }}
          sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: value, border: '1px solid #94a3b8',
            outline: styles.every(style => style.fontColor === value) ? '2px solid #1976d2' : undefined, outlineOffset: 2 }} />)}
        <Box component="input" type="color" aria-label="צבע מילים מותאם" value={styles[0]?.fontColor ?? '#ffffff'} disabled={editor.disabled}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => void apply({ fontColor: event.target.value })}
          sx={{ width: 28, height: 28, padding: 0, border: 0, cursor: 'pointer' }} />
      </Stack>
    </Popover>
    <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)} transitionDuration={0}
      slotProps={{ paper: { dir: 'rtl', sx: { '& .MuiMenuItem-root': { fontSize: 13 }, maxWidth: 240 } } }}>
      <MenuItem disabled={editor.disabled || !styles.some(style => Object.keys(style).length)}
        onClick={() => { setMoreAnchor(null); void apply(null); }}>איפוס לעיצוב הכתובית</MenuItem>
      <MenuItem disabled={editor.disabled || !styles.some(style => style.offsetX || style.offsetY)}
        onClick={() => { setMoreAnchor(null); void apply({ offsetX: 0, offsetY: 0 }); }}>איפוס מיקום</MenuItem>
      <Typography component="li" variant="caption" color="text.secondary" sx={{ px: 2, py: 1, listStyle: 'none', lineHeight: 1.5 }}>
        גררו מילה נבחרת להזזה · Ctrl / ⌘ + לחיצה לבחירת כמה מילים
      </Typography>
    </Menu>
    {failed && <Alert severity="error" sx={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, width: 240, maxWidth: '100%' }}
      action={<Button disabled={editor.disabled} onClick={() => void apply(failed.patch)}>נסו שוב</Button>}>שמירת עיצוב המילים נכשלה. אפשר לנסות שוב.</Alert>}
  </Paper>;
}
