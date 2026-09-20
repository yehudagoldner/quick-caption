import { useEffect, useState } from "react";
import { Box, IconButton, Stack, TextField } from "@mui/material";
import { formatTimecode, parseTimecode } from "../utils/timecode";

export function TimecodeField({ label, value, fps, onChange, onValidityChange, disabled = false }: {
  label: string; value: number; fps: number; onChange: (value: number) => void;
  onValidityChange?: (valid: boolean) => void; disabled?: boolean;
}) {
  const [text, setText] = useState(formatTimecode(value, fps));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(formatTimecode(value, fps)); setInvalid(false); onValidityChange?.(true); }, [value, fps]);
  const update = (next: string) => {
    setText(next);
    const parsed = parseTimecode(next, fps);
    setInvalid(parsed === null); onValidityChange?.(parsed !== null);
    if (parsed !== null) onChange(parsed);
  };
  return <Box sx={{ flex: 1, minWidth: 190 }}>
    <TextField size="small" fullWidth label={label} value={text} disabled={disabled}
      onChange={e => update(e.target.value)} error={invalid}
      helperText={invalid ? `הזינו HH:MM:SS:FF; פריימים 0–${fps - 1}` : `${fps} FPS · HH:MM:SS:FF`}
      inputProps={{ dir: "ltr", spellCheck: false }} />
    <Stack direction="row" justifyContent="center">
      <IconButton size="small" disabled={disabled || invalid} aria-label={`${label}: פריים אחורה`} onClick={() => onChange(Math.max(0, value - 1 / fps))}>−</IconButton>
      <IconButton size="small" disabled={disabled || invalid} aria-label={`${label}: פריים קדימה`} onClick={() => onChange(value + 1 / fps)}>+</IconButton>
    </Stack>
  </Box>;
}
