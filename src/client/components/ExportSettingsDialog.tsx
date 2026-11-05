import { useId, useState, type ReactNode } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Slider, Stack, TextField, Typography } from '@mui/material';
import { CloseRounded, TuneRounded } from '@mui/icons-material';
import { useEditorPreferences } from '../contexts/EditorPreferences';
import { estimateExportSize, MIN_EXPORT_BITRATE, MAX_EXPORT_BITRATE, type ExportSettings } from '../../exportSettings.js';

const qualityLabels = { high: 'גבוהה', balanced: 'מאוזנת', compact: 'חסכונית' };
function sizeLabel(bytes: number) {
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(2)} GB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function ExportSettingsDialog({ duration, dimensions, previewControls, compact = false, disabled = false }: {
  duration: number | null; dimensions: { width: number; height: number } | null; disabled?: boolean; previewControls?: ReactNode; compact?: boolean;
}) {
  const { preferences, update } = useEditorPreferences();
  const saved = preferences.exportSettings;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(saved);
  const [bitrate, setBitrate] = useState(String(saved.bitrateMbps));
  const titleId = useId(), bitrateId = useId();
  const valid = bitrate.trim() !== '' && Number.isFinite(Number(bitrate)) && Number(bitrate) >= MIN_EXPORT_BITRATE && Number(bitrate) <= MAX_EXPORT_BITRATE;
  const canSave = draft.mode !== 'bitrate' || valid;
  const next = { ...draft, bitrateMbps: valid ? Number(bitrate) : saved.bitrateMbps };
  const hasDuration = duration !== null && Number.isFinite(duration) && duration > 0;
  const estimate = canSave ? estimateExportSize(next, hasDuration ? duration : 60, dimensions) : null;
  return <>
    <Button size={compact ? "small" : "medium"} variant={compact ? "text" : "outlined"} disabled={disabled} aria-haspopup="dialog" onClick={() => { setDraft(saved); setBitrate(String(saved.bitrateMbps)); setOpen(true); }}
      startIcon={<TuneRounded />} sx={{ alignSelf: 'flex-start', minHeight: compact ? 32 : 44, gap: 1, '& .MuiButton-startIcon': { m: 0 } }}>
      איכות וידאו
      {!compact && <Typography component="span" variant="caption" color="text.secondary">{saved.mode === 'quality' ? `איכות ${qualityLabels[saved.quality]}` : `${saved.bitrateMbps} Mbps`}</Typography>}
    </Button>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby={titleId} dir="rtl">
      <DialogTitle id={`${titleId}-heading`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box component="span" id={titleId}>איכות וידאו</Box>
        <IconButton aria-label="סגירת איכות וידאו" onClick={() => setOpen(false)} sx={{ width: 44, height: 44 }}><CloseRounded /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          <Typography variant="body2" color="text.secondary">בחרו את האיזון בין איכות התמונה לגודל הסרטון עם הכתוביות. הקובץ ייוצא בפורמט MP4 וברזולוציית הגרסה שנבחרה.</Typography>
          <TextField select label="שיטת ייצוא" value={draft.mode} disabled={disabled} onChange={event => setDraft({ ...draft, mode: event.target.value as ExportSettings['mode'] })}>
            <MenuItem value="quality">לפי איכות תמונה</MenuItem>
            <MenuItem value="bitrate">Bitrate ידני</MenuItem>
          </TextField>
          <TextField select label="איכות תמונה" value={draft.quality} disabled={disabled || draft.mode !== "quality"}
            helperText="איכות גבוהה שומרת יותר פרטים; איכות חסכונית מקטינה את הקובץ ועלולה לפגוע בחדות."
            onChange={event => setDraft({ ...draft, quality: event.target.value as ExportSettings['quality'] })}>
            <MenuItem value="high">גבוהה — מומלץ</MenuItem>
            <MenuItem value="balanced">מאוזנת — איכות וגודל</MenuItem>
            <MenuItem value="compact">חסכונית — קובץ קטן יותר</MenuItem>
          </TextField>
          <Stack spacing={1}>
            <TextField label="Bitrate וידאו (Mbps)" type="number" value={bitrate} disabled={disabled || draft.mode !== "bitrate"} error={draft.mode === "bitrate" && !valid}
              helperText={valid ? 'קצב נתונים גבוה יותר מאפשר יותר פירוט, ומגדיל את הקובץ.' : 'יש להזין מספר בין 0.25 ל־100 Mbps.'}
              slotProps={{ htmlInput: { min: MIN_EXPORT_BITRATE, max: MAX_EXPORT_BITRATE, step: .25, dir: 'ltr', inputMode: 'decimal' } }}
              onChange={event => setBitrate(event.target.value)} />
            <Box sx={{ px: 1 }}>
              <Typography id={bitrateId} variant="caption">קצב נתוני הווידאו</Typography>
              <Slider aria-labelledby={bitrateId} disabled={disabled || draft.mode !== "bitrate"} value={valid ? Number(bitrate) : MIN_EXPORT_BITRATE}
                min={MIN_EXPORT_BITRATE} max={MAX_EXPORT_BITRATE} step={.25} valueLabelDisplay="auto"
                onChange={(_, value) => setBitrate(String(value))} />
            </Box>
          </Stack>
          {previewControls}
          {previewControls && <Typography variant="caption" color="text.secondary">שינוי איכות התצוגה המקדימה חל מיד על הניגון בעורך.</Typography>}
          <Box role="status" aria-live="polite" sx={{ p: 2.5, bgcolor: 'grey.50', border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="body2" fontWeight={600}>{hasDuration ? 'גודל קובץ משוער' : 'גודל משוער לכל דקת וידאו'}</Typography>
            <Typography component="p" variant="h4" dir="ltr" sx={{ textAlign: 'right', my: 1, overflowWrap: 'anywhere' }}>{estimate ? `≈ ${sizeLabel(estimate.bytes)}` : '—'}</Typography>
            {estimate && <Typography variant="body2">טווח משוער: <Box component="bdi">{sizeLabel(estimate.minBytes)} – {sizeLabel(estimate.maxBytes)}</Box></Typography>}
            {hasDuration && <Typography variant="caption" display="block" sx={{ mt: 1 }}>לסרטון באורך {Number((duration / 60).toFixed(2))} דקות{dimensions ? ` · ${dimensions.width}×${dimensions.height}` : ''}</Typography>}
            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
              {draft.mode === 'quality' ? 'זהו אומדן גס. באיכות קבועה הגודל עשוי לחרוג מהטווח בהתאם לתנועה, לפרטים ולקצב הפריימים.' : 'זהו קצב נתונים ממוצע, ולכן הגודל בפועל עשוי להשתנות בהתאם לתוכן.'} האומדן כולל אודיו.
              {!hasDuration && ' האומדן לסרטון המלא יופיע לאחר טעינת משך המדיה.'}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">הבחירה תישמר בדפדפן ותשמש בייצוא הסרטון הבא, כולל סרטון שנוצר מאודיו.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap' }}>
        <Button onClick={() => setOpen(false)}>ביטול</Button>
        <Button variant="contained" disabled={disabled || !canSave} onClick={() => { update({ exportSettings: next }); setOpen(false); }}>שמירת הגדרות</Button>
      </DialogActions>
    </Dialog>
  </>;
}
