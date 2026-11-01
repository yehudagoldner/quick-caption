import { Box, Slider, Stack, TextField, Typography } from '@mui/material';
import type { CaptionBackground } from '../../captionBackground.js';

export function CaptionBackgroundSettings({ backgroundColor, backgroundOpacity, onChange, onCommit, disabled = false }: CaptionBackground & {
  onChange: (patch: Partial<CaptionBackground>) => void;
  onCommit?: (patch: Partial<CaptionBackground>) => void;
  disabled?: boolean;
}) {
  return <Stack spacing={1} dir="rtl" data-testid="caption-background-settings">
    <TextField label="צבע רקע הכתוביות" type="color" value={backgroundColor} disabled={disabled}
      onChange={event => onChange({ backgroundColor: event.target.value })} fullWidth size="small" InputLabelProps={{ shrink: true }} />
    <Box sx={{ px: 1 }}>
      <Typography variant="body2">שקיפות הרקע: {Math.round(100 - backgroundOpacity)}%</Typography>
      <Slider aria-label="שקיפות רקע הכתוביות" value={100 - backgroundOpacity} min={0} max={100} step={1} disabled={disabled}
        valueLabelDisplay="auto" valueLabelFormat={value => `${value}%`}
        onChange={(_, value) => onChange({ backgroundOpacity: 100 - (value as number) })}
        onChangeCommitted={onCommit ? (_, value) => onCommit({ backgroundOpacity: 100 - (value as number) }) : undefined} />
      <Typography variant="caption" color="text.secondary">0% — רקע אטום · 100% — ללא רקע</Typography>
    </Box>
  </Stack>;
}
