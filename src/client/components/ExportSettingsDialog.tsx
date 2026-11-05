import { useId, useState, type ReactNode } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Slider, Stack, TextField, Typography } from '@mui/material';
import { CloseRounded, TuneRounded } from '@mui/icons-material';
import { useEditorPreferences } from '../contexts/EditorPreferences';
import { availableExportResolutions, exportDimensions, estimatedVideoBitrate, estimateExportSize, MIN_EXPORT_BITRATE, MAX_EXPORT_BITRATE, type ExportSettings } from '../../exportSettings.js';

const qualityLabels = { high: 'גבוהה', balanced: 'מאוזנת', compact: 'חסכונית' };
const resolutionLabel = (value: number) => value === 2160 ? '4K · 2160p' : `${value}p`;
const sizeLabel = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;

export function ExportSettingsDialog({ duration, dimensions, previewControls, compact = false, disabled = false }: {
  duration: number | null; dimensions: { width: number; height: number } | null; disabled?: boolean; previewControls?: ReactNode; compact?: boolean;
}) {
  const { preferences, update } = useEditorPreferences();
  const saved = preferences.exportSettings;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(saved);
  const [bitrate, setBitrate] = useState(String(saved.bitrateMbps));
  const titleId = useId();
  const resolutions = availableExportResolutions(dimensions);
  const resolution = typeof draft.resolution === 'number' && resolutions.includes(draft.resolution) ? draft.resolution : 'source';
  const valid = bitrate.trim() !== '' && Number.isFinite(Number(bitrate)) && Number(bitrate) >= MIN_EXPORT_BITRATE && Number(bitrate) <= MAX_EXPORT_BITRATE;
  const canSave = draft.mode !== 'bitrate' || valid;
  const next: ExportSettings = { ...draft, resolution, bitrateMbps: valid ? Number(bitrate) : saved.bitrateMbps };
  const output = exportDimensions(next, dimensions);
  const hasDuration = duration !== null && Number.isFinite(duration) && duration > 0;
  const estimate = canSave ? estimateExportSize(next, hasDuration ? duration : 60, dimensions) : null;
  const rate = estimatedVideoBitrate(next, dimensions);
  return <>
    <Button aria-label="איכות וידאו" size={compact ? 'small' : 'medium'} variant={compact ? 'text' : 'outlined'} disabled={disabled} aria-haspopup="dialog"
      onClick={() => { setDraft(saved); setBitrate(String(saved.bitrateMbps)); setOpen(true); }} startIcon={<TuneRounded />}
      sx={{ minHeight: compact ? 32 : 44, gap: 1, '& .MuiButton-startIcon': { m: 0 } }}>איכות וידאו</Button>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby={titleId} dir="rtl"
      slotProps={{ paper: { sx: { m: 1.5, width: 'calc(100% - 24px)', maxHeight: 'calc(100dvh - 24px)' } } }}>
      <DialogTitle id={`${titleId}-heading`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: .5 }}>
        <Box component="span" id={titleId}>איכות וידאו</Box>
        <IconButton aria-label="סגירת איכות וידאו" onClick={() => setOpen(false)} sx={{ width: 44, height: 44 }}><CloseRounded /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 2, '& .MuiFormHelperText-root': { mx: 0, fontSize: 11 }, '& .MuiInputBase-root': { fontSize: 14 } }}>
        <Stack spacing={1.5}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, pt: .5 }}>
            <TextField select fullWidth size="small" label="רזולוציית ייצוא" value={resolution} disabled={disabled || !dimensions}
              onChange={e => setDraft({ ...draft, resolution: e.target.value === 'source' ? 'source' : Number(e.target.value) as ExportSettings['resolution'] })}>
              <MenuItem value="source">מקור{dimensions ? ` · ${Math.min(dimensions.width, dimensions.height)}p` : ''}</MenuItem>
              {resolutions.map(value => <MenuItem key={value} value={value}>{resolutionLabel(value)}</MenuItem>)}
            </TextField>
            <TextField select fullWidth size="small" label="שיטת ייצוא" value={draft.mode} disabled={disabled} onChange={e => setDraft({ ...draft, mode: e.target.value as ExportSettings['mode'] })}>
              <MenuItem value="quality">לפי איכות תמונה</MenuItem><MenuItem value="bitrate">Bitrate ידני</MenuItem>
            </TextField>
            <TextField select fullWidth size="small" label="איכות תמונה" slotProps={{ select: { renderValue: value => qualityLabels[value as ExportSettings['quality']] } }} value={draft.quality} disabled={disabled || draft.mode !== 'quality'} onChange={e => setDraft({ ...draft, quality: e.target.value as ExportSettings['quality'] })}>
              {(['high', 'balanced', 'compact'] as const).map(quality => <MenuItem key={quality} value={quality}>
                <Box><Typography variant="body2">{qualityLabels[quality]}</Typography><Typography variant="caption" color="text.secondary">Bitrate משוער: <bdi>{estimatedVideoBitrate({ ...next, mode: 'quality', quality }, dimensions).toFixed(1)} Mbps</bdi></Typography></Box>
              </MenuItem>)}
            </TextField>
            <TextField size="small" label="Bitrate וידאו (Mbps)" type="number" value={bitrate} disabled={disabled || draft.mode !== 'bitrate'} error={draft.mode === 'bitrate' && !valid}
              slotProps={{ htmlInput: { min: MIN_EXPORT_BITRATE, max: MAX_EXPORT_BITRATE, step: .25, dir: 'ltr', inputMode: 'decimal' } }} onChange={e => setBitrate(e.target.value)} />
          </Box>
          {draft.mode === 'bitrate' && <Box sx={{ px: 1 }}><Slider aria-label="קצב נתוני הווידאו" disabled={disabled} value={valid ? Number(bitrate) : MIN_EXPORT_BITRATE}
            min={MIN_EXPORT_BITRATE} max={MAX_EXPORT_BITRATE} step={.25} valueLabelDisplay="auto" sx={{ py: 1 }} onChange={(_, value) => setBitrate(String(value))} /></Box>}
          <Typography variant="caption" color={canSave ? 'text.secondary' : 'error'} sx={{ lineHeight: 1.5 }}>
            {!canSave ? 'יש להזין מספר בין 0.25 ל־100 Mbps.' : <>{output && <><bdi>{output.width}×{output.height}</bdi> · </>}{draft.mode === 'quality' ? `איכות ${qualityLabels[draft.quality]} · Bitrate אוטומטי, כ־` : 'Bitrate ממוצע: '}<bdi>{rate.toFixed(1)} Mbps</bdi> · MP4</>}
          </Typography>
          <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5, '& .MuiTextField-root': { width: '100%', minWidth: '0 !important' }, '& .MuiTypography-caption': { fontSize: 11, lineHeight: 1.4 } }}>{previewControls}</Box>
          <Box role="status" aria-live="polite" sx={{ p: 1.5, bgcolor: 'grey.50', border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
              <Typography variant="body2">{hasDuration ? 'גודל קובץ משוער' : 'גודל משוער לדקה'}</Typography>
              <Typography variant="h6" component="span" dir="ltr">{estimate ? `≈ ${sizeLabel(estimate.bytes)}` : '—'}</Typography>
            </Stack>
            <Typography variant="caption" display="block" color="text.secondary">{estimate && <>טווח: <bdi>{sizeLabel(estimate.minBytes)} – {sizeLabel(estimate.maxBytes)}</bdi>. </>}כולל אודיו; הגודל בפועל תלוי בתוכן.</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, lineHeight: 1.4 }}>הייצוא שומר על יחס התמונה ואינו מגדיל מעבר למקור. איכות התצוגה המקדימה משתנה מיד; הגדרות הייצוא נשמרות בלחיצה.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1, gap: 1 }}><Button onClick={() => setOpen(false)}>ביטול</Button><Button variant="contained" disabled={disabled || !canSave} onClick={() => { update({ exportSettings: next }); setOpen(false); }}>שמירת הגדרות</Button></DialogActions>
    </Dialog>
  </>;
}
