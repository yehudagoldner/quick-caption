import { useContext, useRef } from "react";
import { Alert, Box, Button, ButtonBase, FormControlLabel, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { AddPhotoAlternateRounded, DeleteOutlineRounded } from "@mui/icons-material";
import { AudiogramContext } from "../contexts/AudiogramContext";
import { AUDIOGRAM_IMAGE_TYPES, type AudiogramFormat } from "../../audiogram.js";

const BACKGROUNDS = ["#111827", "#000000", "#ffffff", "#1e3a8a", "#7c3aed", "#be123c", "#065f46"];
const FORMATS: { id: AudiogramFormat; label: string }[] = [
  { id: "vertical", label: "אנכי 9:16" }, { id: "square", label: "ריבוע 1:1" }, { id: "landscape", label: "רוחבי 16:9" },
];

function ColorChoice({ label, value, colors, disabled, onChange }: { label: string; value: string; colors: string[]; disabled: boolean; onChange: (color: string) => void }) {
  const swatch = { width: 28, height: 28, borderRadius: "50%", flexShrink: 0, border: "1px solid rgba(15, 23, 42, .2)" };
  return <Stack spacing={.5}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Stack direction="row" spacing={.75} alignItems="center" sx={{ flexWrap: "wrap", rowGap: .75 }}>
      {colors.map(color => <ButtonBase key={color} aria-label={`${label}: ${color}`} aria-pressed={value === color} disabled={disabled} onClick={() => onChange(color)}
        sx={{ ...swatch, bgcolor: color, outline: value === color ? "2px solid #2563eb" : "none", outlineOffset: 2 }} />)}
      <Box component="label" sx={{ ...swatch, position: "relative", overflow: "hidden", cursor: disabled ? "default" : "pointer",
        background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)", outline: colors.includes(value) ? "none" : "2px solid #2563eb", outlineOffset: 2 }}>
        <Box component="input" type="color" aria-label={label} value={value} disabled={disabled} onChange={event => onChange((event.target as HTMLInputElement).value)}
          sx={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "inherit" }} />
      </Box>
    </Stack>
  </Stack>;
}

export function AudiogramSettings() {
  const audiogram = useContext(AudiogramContext);
  const fileInput = useRef<HTMLInputElement>(null);
  if (!audiogram) return null;
  const { settings, update, disabled } = audiogram;
  return <Stack component="section" aria-label="רקע לסרטון מאודיו" spacing={1.5} data-testid="audiogram-settings">
    <Box>
      <Typography variant="subtitle2" fontWeight={700}>רקע לסרטון</Typography>
      <Typography variant="caption" color="text.secondary">קובץ האודיו יורד כסרטון עם הרקע, גל הקול והכתוביות.</Typography>
    </Box>
    <ToggleButtonGroup exclusive fullWidth size="small" value={settings.format} disabled={disabled} aria-label="פורמט הסרטון"
      onChange={(_, format: AudiogramFormat | null) => { if (format) update({ format }); }}>
      {FORMATS.map(format => <ToggleButton key={format.id} value={format.id} sx={{ py: .5 }}>{format.label}</ToggleButton>)}
    </ToggleButtonGroup>
    <ColorChoice label="צבע רקע" value={settings.background} colors={BACKGROUNDS} disabled={disabled} onChange={background => update({ background })} />
    <Stack spacing={.75}>
      <Typography variant="body2" color="text.secondary">תמונה</Typography>
      <input ref={fileInput} type="file" hidden accept={AUDIOGRAM_IMAGE_TYPES.join(",")} aria-label="בחירת תמונת רקע"
        onChange={event => { const file = event.target.files?.[0] ?? null; event.target.value = ""; if (file) void audiogram.setImage(file); }} />
      {audiogram.imageUrl ? <Stack direction="row" spacing={1} alignItems="center">
        <Box component="img" src={audiogram.imageUrl} alt="תמונת הרקע" sx={{ width: 44, height: 44, objectFit: "cover", borderRadius: 1, border: 1, borderColor: "divider" }} />
        <ToggleButtonGroup exclusive size="small" value={settings.imageFit} disabled={disabled} aria-label="התאמת התמונה"
          onChange={(_, imageFit: "contain" | "cover" | null) => { if (imageFit) update({ imageFit }); }}>
          <ToggleButton value="contain" sx={{ py: .25 }}>תמונה מלאה</ToggleButton>
          <ToggleButton value="cover" sx={{ py: .25 }}>מילוי המסך</ToggleButton>
        </ToggleButtonGroup>
        <Button size="small" color="inherit" aria-label="הסרת תמונת הרקע" disabled={disabled} onClick={() => void audiogram.setImage(null)} sx={{ minWidth: 0 }}><DeleteOutlineRounded fontSize="small" /></Button>
      </Stack> : <Button variant="outlined" size="small" startIcon={<AddPhotoAlternateRounded />} disabled={disabled} onClick={() => fileInput.current?.click()} sx={{ alignSelf: "flex-start" }}>העלאת תמונה</Button>}
      {audiogram.imageUrl && <Button size="small" disabled={disabled} onClick={() => fileInput.current?.click()} sx={{ alignSelf: "flex-start", p: 0, minWidth: 0 }}>החלפת תמונה</Button>}
      {audiogram.error && <Alert severity="error" sx={{ py: 0 }}>{audiogram.error}</Alert>}
    </Stack>
    <FormControlLabel control={<Switch checked={settings.waveform} disabled={disabled} onChange={(_, waveform) => update({ waveform })} />} label="גל קול" />
    {settings.waveform && <ColorChoice label="צבע גל הקול" value={settings.waveColor} colors={["#ffffff", "#000000", "#facc15", "#38bdf8", "#f472b6"]} disabled={disabled} onChange={waveColor => update({ waveColor })} />}
    {settings.waveform && <Typography variant="caption" color="text.secondary">בתצוגה המקדימה הגל להמחשה; בסרטון הוא עוקב אחרי הקול.</Typography>}
  </Stack>;
}
