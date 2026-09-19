import { useState } from "react";
import { Alert, Box, Button, FormControlLabel, MenuItem, Slider, Stack, Switch, TextField, Typography } from "@mui/material";
import { FRAME_RATES, useEditorPreferences } from "../contexts/EditorPreferences";

type EditorSettingsProps = {
  onApply: (limit: number | null) => Promise<void>;
  onUndo: () => Promise<void>;
  canUndo: boolean;
  exportFormat: string;
  onExportFormatChange: (format: string) => void;
  disabled?: boolean;
};

export function EditorSettings({ onApply, onUndo, canUndo, exportFormat, onExportFormatChange, disabled = false }: EditorSettingsProps) {
  const { preferences, update } = useEditorPreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runAction = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); } catch { setError("שמירת החלוקה נכשלה. נסו שוב או בטלו את החלוקה."); } finally { setBusy(false); }
  };
  return <Stack spacing={2} sx={{ width: "100%", minWidth: 0, p: 2, bgcolor: "grey.50", borderRadius: 2 }}>
    <Stack component="fieldset" disabled={disabled || busy} direction="row" useFlexGap flexWrap="wrap" gap={2} alignItems="center" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <TextField disabled={disabled || busy} select size="small" label="FPS של הפרויקט" value={preferences.fps} onChange={e => update({ fps: Number(e.target.value) })} sx={{ minWidth: 150 }}>
        {FRAME_RATES.map(fps => <MenuItem key={fps} value={fps}>{fps} FPS</MenuItem>)}
      </TextField>
      <TextField disabled={disabled || busy} select size="small" label="כיוון הכתוביות" value={preferences.direction} onChange={e => update({ direction: e.target.value as "rtl" | "ltr" })} sx={{ minWidth: 175 }}>
        <MenuItem value="rtl">עברית — RTL</MenuItem><MenuItem value="ltr">English — LTR</MenuItem>
      </TextField>
      <TextField disabled={busy} select size="small" label="פורמט ההורדה" value={exportFormat} onChange={e => onExportFormatChange(e.target.value)} sx={{ minWidth: 150 }}>
        <MenuItem value=".srt">SRT</MenuItem><MenuItem value=".vtt">VTT</MenuItem><MenuItem value=".txt">TXT</MenuItem>
      </TextField>
      <FormControlLabel control={<Switch disabled={disabled || busy} checked={preferences.limitCharacters} onChange={(_, checked) => update({ limitCharacters: checked })} />} label="הגבלת תווים בכתובית" />
    </Stack>
    {preferences.limitCharacters && <Stack direction={{ xs: "column", sm: "row" }} gap={3} alignItems={{ sm: "center" }}>
      <Box sx={{ flex: 1, minWidth: 0, px: 1 }}>
        <Typography id="character-limit-label" variant="body2">עד {preferences.maxCharacters} תווים, כולל רווחים</Typography>
        <Slider disabled={disabled || busy} aria-labelledby="character-limit-label" value={preferences.maxCharacters} min={7} max={20} step={1} valueLabelDisplay="auto" marks={[{ value: 7, label: "7" }, { value: 20, label: "20" }]} onChange={(_, value) => update({ maxCharacters: value as number })} />
        <Typography variant="caption" color="text.secondary">מילים נשארות שלמות. מילה ארוכה מהמגבלה תופיע לבדה, ללא חיתוך.</Typography>
      </Box>
    </Stack>}
    {!preferences.limitCharacters && <Typography variant="body2">ללא הגבלת תווים: החלוקה תהיה לקבוצות של עד 5 מילים.</Typography>}
    <Typography variant="caption" color="text.secondary">שינוי המגבלה יחול רק בלחיצה על ״חלוקה מחדש״. מקטעים יפוצלו או יאוחדו לפי הטקסט הנוכחי, בלי לחצות הפסקות ארוכות או סופי משפטים. כשאין תזמון מילים תואם לטקסט שתוקן, התזמון הפנימי יחושב בקירוב.</Typography>
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
      <Button variant="outlined" disabled={busy || disabled} onClick={() => runAction(() => onApply(preferences.limitCharacters ? preferences.maxCharacters : null))}>{busy ? "שומר..." : "חלוקה מחדש"}</Button>
      <Button disabled={busy || disabled || !canUndo} onClick={() => runAction(onUndo)}>ביטול החלוקה האחרונה</Button>
    </Stack>
    <Typography variant="caption" color="text.secondary">אפשר לבטל את החלוקה האחרונה עד לעריכה הבאה. השינויים אינם דורשים תמלול נוסף.</Typography>
    <Typography variant="caption" color="text.secondary">FPS קובע את תצוגת הזמן ואת דיוק העריכה בפריימים. מהירות המדיה אינה משתנה.</Typography>
    {error && <Alert severity="error">{error}</Alert>}
  </Stack>;
}
