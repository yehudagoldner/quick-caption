import { Box, ToggleButton, ToggleButtonGroup, alpha } from "@mui/material";
import LanguageRounded from "@mui/icons-material/LanguageRounded";
import TranslateRounded from "@mui/icons-material/TranslateRounded";
import RecordVoiceOverRounded from "@mui/icons-material/RecordVoiceOverRounded";
import type { SecondaryLanguageMode } from "../../transcriptionSettings.js";

const modes = [
  { value: "original", label: "מקור", accessibleLabel: "מקור", Icon: LanguageRounded },
  { value: "translate", label: "תרגום", accessibleLabel: "תרגום לעברית", Icon: TranslateRounded },
  { value: "transliterate", label: "תעתיק", accessibleLabel: "תעתיק עברי", Icon: RecordVoiceOverRounded },
] as const;

export function SecondaryLanguageModePicker({ value, onChange }: {
  value: SecondaryLanguageMode;
  onChange: (value: SecondaryLanguageMode) => void;
}) {
  const activeIndex = modes.findIndex(mode => mode.value === value);

  return <ToggleButtonGroup
    exclusive fullWidth value={value} dir="rtl"
    onChange={(_, next: SecondaryLanguageMode | null) => next && onChange(next)}
    aria-label="הצגת השפות הלא ראשיות"
    sx={theme => ({
      position: "relative", isolation: "isolate", display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      height: 34, p: "3px", boxSizing: "border-box", borderRadius: "999px",
      bgcolor: alpha(theme.palette.primary.main, 0.065),
      border: "1px solid", borderColor: alpha(theme.palette.primary.main, 0.09),
      "&::before": {
        content: '""', position: "absolute", insetBlock: "3px",
        right: `calc(3px + (100% - 6px) * ${activeIndex} / 3)`,
        width: "calc((100% - 6px) / 3)", borderRadius: "999px",
        bgcolor: "background.paper",
        boxShadow: `0 1px 4px ${alpha(theme.palette.primary.main, 0.16)}`,
        transition: "right 180ms ease-out",
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
      },
      "&& .MuiToggleButton-root": {
        position: "relative", m: 0, p: 0, minWidth: 0,
        border: 0, borderRadius: "999px", gap: 0.5,
        fontSize: "0.75rem", fontWeight: 500, lineHeight: 1,
        whiteSpace: "nowrap", textTransform: "none", color: "text.secondary",
        transition: "color 180ms ease-out", bgcolor: "transparent",
        "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.05) },
        "&.Mui-selected": { color: "primary.main", fontWeight: 700, bgcolor: "transparent" },
        "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "-2px" },
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
      },
    })}
  >
    {modes.map(({ value: mode, label, accessibleLabel, Icon }) => <ToggleButton key={mode} value={mode} aria-label={accessibleLabel}>
      <Icon sx={{ fontSize: 15 }} />
      <Box component="span">{label}</Box>
    </ToggleButton>)}
  </ToggleButtonGroup>;
}
