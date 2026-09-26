import { Box, Stack } from "@mui/material";
import { ZoomInRounded } from "@mui/icons-material";

/** A thin visible rail with a larger touch target, independent of the app's RTL theme. */
export function CompactTimelineZoom({ label, value, min, max, step, valueText, disabled, onChange }: {
  label: string; value: number; min: number; max: number; step: number; valueText: string;
  disabled?: boolean; onChange: (value: number) => void;
}) {
  const thumb = { appearance: "none", width: 12, height: 12, borderRadius: "50%", bgcolor: "primary.main", border: 0 };
  return <Stack direction="row" dir="ltr" alignItems="center" spacing={0.5} title={`${label}: ${valueText}`}
    sx={{ height: 24, minWidth: 0, width: "100%", flexShrink: 0 }}>
    <ZoomInRounded aria-hidden sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
    <Box component="input" type="range" aria-label={label} aria-valuetext={valueText}
      min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={event => onChange(Number(event.target.value))}
      sx={{ appearance: "none", direction: "ltr", flex: 1, minWidth: 0, width: 0, height: 24, p: 0, m: 0,
        bgcolor: "transparent", cursor: "pointer", touchAction: "none", borderRadius: 1,
        "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 },
        "&:disabled": { opacity: 0.4, cursor: "default" },
        "&::-webkit-slider-runnable-track": { height: 2, borderRadius: 99, bgcolor: "#b8c9dd" },
        "&::-webkit-slider-thumb": { ...thumb, mt: "-5px" },
        "&::-moz-range-track": { height: 2, borderRadius: 99, bgcolor: "#b8c9dd" },
        "&::-moz-range-thumb": thumb,
      }} />
  </Stack>;
}
