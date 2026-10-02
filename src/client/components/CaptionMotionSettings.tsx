import { MenuItem, Stack, TextField, Typography } from "@mui/material";
import type { CaptionMotion, PopIntensity } from "../../captionMotion.js";

export function CaptionMotionSettings({ motion, intensity, onMotionChange, onIntensityChange, disabled = false }: {
  motion: CaptionMotion; intensity: PopIntensity; onMotionChange: (value: CaptionMotion) => void;
  onIntensityChange: (value: PopIntensity) => void; disabled?: boolean;
}) {
  return <Stack spacing={1.5} sx={{ p: 2 }}>
    <TextField select size="small" label="אנימציית כתוביות" value={motion} disabled={disabled}
      onChange={event => onMotionChange(event.target.value as CaptionMotion)}>
      <MenuItem value="none">ללא אנימציה</MenuItem>
      <MenuItem value="pop">מילה בודדת עם קפיצה</MenuItem>
    </TextField>
    {motion === "pop" && <>
      <TextField select size="small" label="עוצמת הקפיצה" value={intensity} disabled={disabled}
        onChange={event => onIntensityChange(event.target.value as PopIntensity)}>
        <MenuItem value="gentle">עדינה</MenuItem><MenuItem value="strong">חזקה</MenuItem>
      </TextField>
      <Typography variant="caption" color="text.secondary">כל מילה מופיעה לבדה, גדלה ומתייצבת לפי תזמון הדיבור. האנימציה נכללת בסרטון עם הכתוביות; קובצי SRT ו־VTT נשארים עם הטקסט המלא.</Typography>
    </>}
  </Stack>;
}
