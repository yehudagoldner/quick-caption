import { Autocomplete, Box, Checkbox, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { TRANSCRIPTION_LANGUAGE_CODES, type SecondaryLanguageMode } from "../../transcriptionSettings.js";
import { useEffect, useState } from "react";

export type SubtitleLimitMode = "characters" | "words" | "none";
export type InitialTranscriptionSettingsProps = {
  subtitleLimitMode: SubtitleLimitMode;
  maxCharactersPerSubtitle: number;
  maxWordsPerSubtitle: number;
  languages: string[];
  secondaryLanguageMode: SecondaryLanguageMode;
  onSubtitleLimitModeChange: (mode: SubtitleLimitMode) => void;
  onMaxCharactersChange: (value: number) => void;
  onMaxWordsChange: (value: number) => void;
  onLanguagesChange: (languages: string[]) => void;
  onSecondaryLanguageModeChange: (mode: SecondaryLanguageMode) => void;
};

const hebrewNames = new Intl.DisplayNames(["he"], { type: "language" });
const englishNames = new Intl.DisplayNames(["en"], { type: "language" });
const fallbackNames: Record<string, [string, string]> = { ba: ["בשקירית", "Bashkir"], bo: ["טיבטית", "Tibetan"] };
const hebrewName = (code: string) => fallbackNames[code]?.[0] || hebrewNames.of(code) || code;
const languageLabel = (code: string) => `${hebrewName(code)} · ${fallbackNames[code]?.[1] || englishNames.of(code) || code}`;
const languageOptions = [...TRANSCRIPTION_LANGUAGE_CODES.slice(0, 4), ...TRANSCRIPTION_LANGUAGE_CODES.slice(4).sort((a, b) => languageLabel(a).localeCompare(languageLabel(b), "he"))];

function SubtitleLimitInput({ mode, value, onChange }: { mode: "characters" | "words"; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const min = mode === "characters" ? 7 : 1;
  const max = mode === "characters" ? 20 : 30;
  useEffect(() => setDraft(String(value)), [value]);
  return <TextField type="number" required size="small" label={mode === "characters" ? "מספר תווים" : "מספר מילים"} value={draft} onChange={e => {
    setDraft(e.target.value);
    const next = Number(e.target.value);
    if (e.target.value && Number.isInteger(next) && next >= min && next <= max) onChange(next);
  }} onBlur={() => {
    const next = draft ? Math.min(max, Math.max(min, Math.round(Number(draft)))) : value;
    onChange(Number.isFinite(next) ? next : value);
    setDraft(String(Number.isFinite(next) ? next : value));
  }} slotProps={{ htmlInput: { min, max, step: 1 } }} sx={{ width: 125, flexShrink: 0 }} />;
}

export function InitialTranscriptionSettings({ subtitleLimitMode, maxCharactersPerSubtitle, maxWordsPerSubtitle, languages, secondaryLanguageMode, onSubtitleLimitModeChange, onMaxCharactersChange, onMaxWordsChange, onLanguagesChange, onSecondaryLanguageModeChange }: InitialTranscriptionSettingsProps) {
  return <Stack spacing={0.75} sx={{ p: 1, borderRadius: 2, bgcolor: "action.hover", minWidth: 0, "@media (max-width: 599px) and (max-height: 650px)": { py: 0.75, "& > :not(style) ~ :not(style)": { mt: 0.25 } } }}>
    <Typography variant="subtitle2" fontWeight={700}>אורך הכתובית</Typography>
    <ToggleButtonGroup exclusive fullWidth color="primary" size="small" value={subtitleLimitMode} onChange={(_, value: SubtitleLimitMode | null) => value && onSubtitleLimitModeChange(value)} aria-label="הגבלת אורך כתובית" sx={{ gap: 0.5, "&& .MuiToggleButton-root": { m: 0, border: "1px solid", borderColor: "divider", borderRadius: 1, px: 0.75, py: 0.5, whiteSpace: "nowrap", color: "text.primary", "&.Mui-selected": { bgcolor: "primary.main", color: "primary.contrastText", borderColor: "primary.main", "&:hover": { bgcolor: "primary.dark" } } } }}>
      <ToggleButton value="characters">לפי תווים</ToggleButton>
      <ToggleButton value="words">לפי מילים</ToggleButton>
      <ToggleButton value="none">ללא הגבלה</ToggleButton>
    </ToggleButtonGroup>
    <Box sx={{ minHeight: 40, display: "flex", alignItems: "center", gap: 1 }}>
      {subtitleLimitMode === "none" ? <Typography variant="caption" color="text.secondary">חלוקה טבעית לפי הדיבור, ללא הגבלת אורך.</Typography> : <>
        <SubtitleLimitInput key={subtitleLimitMode} mode={subtitleLimitMode} value={subtitleLimitMode === "characters" ? maxCharactersPerSubtitle : maxWordsPerSubtitle} onChange={subtitleLimitMode === "characters" ? onMaxCharactersChange : onMaxWordsChange} />
        <Typography variant="caption" color="text.secondary">{subtitleLimitMode === "characters" ? "כולל רווחים, בלי לחתוך מילים" : "מילים לכל כתובית"}</Typography>
      </>}
    </Box>
    <Autocomplete disableClearable size="small" options={languageOptions} value={languages[0] || "he"} onChange={(_, value) => onLanguagesChange([value, ...languages.slice(1).filter(code => code !== value)])} getOptionLabel={languageLabel} noOptionsText="לא נמצאה שפה" openText="בחירת שפת תמלול" closeText="סגירה" renderInput={params => <TextField {...params} label="שפת התמלול" />} slotProps={{ listbox: { sx: { maxHeight: "min(240px, 35dvh)", direction: "rtl" } } }} />
    <Autocomplete multiple disableCloseOnSelect size="small" options={languageOptions.filter(code => code !== languages[0])} value={languages.slice(1)} onChange={(_, value) => onLanguagesChange([languages[0] || "he", ...value])} getOptionLabel={languageLabel} noOptionsText="לא נמצאה שפה" clearText="ניקוי השפות הנוספות" openText="בחירת שפות נוספות" closeText="סגירה" renderValue={(value) => <Typography variant="body2" noWrap sx={{ maxWidth: "calc(100% - 66px)", flexShrink: 0 }}>{value.length === 1 ? hebrewName(value[0]) : `${value.length} שפות נוספות`}</Typography>} renderOption={(props, code, { selected }) => {
      const { key, ...optionProps } = props;
      return <li key={key} {...optionProps}><Checkbox checked={selected} size="small" sx={{ p: 0.5, mr: 0.5 }} />{languageLabel(code)}</li>;
    }} renderInput={params => <TextField {...params} label="שפות נוספות בסרטון" placeholder={languages.length > 1 ? "חיפוש" : "בחירה מרובה"} />} slotProps={{ listbox: { sx: { maxHeight: "min(240px, 35dvh)", direction: "rtl" } } }} sx={{ "& .MuiAutocomplete-inputRoot": { flexWrap: "nowrap" }, "& .MuiAutocomplete-input": { minWidth: "20px !important" } }} />
    <Typography variant="caption" fontWeight={700}>הצגת השפות הלא ראשיות</Typography>
    <ToggleButtonGroup exclusive fullWidth color="primary" size="small" value={secondaryLanguageMode} onChange={(_, value: SecondaryLanguageMode | null) => value && onSecondaryLanguageModeChange(value)} aria-label="הצגת השפות הלא ראשיות" sx={{ "& .MuiToggleButton-root": { px: 0.5, py: 0.5, fontSize: "0.75rem", whiteSpace: "nowrap", "&.Mui-selected": { bgcolor: "primary.main", color: "primary.contrastText", "&:hover": { bgcolor: "primary.dark" } } } }}>
      <ToggleButton value="original">מקור</ToggleButton>
      <ToggleButton value="translate">תרגום לעברית</ToggleButton>
      <ToggleButton value="transliterate">תעתיק עברי</ToggleButton>
    </ToggleButtonGroup>
    <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.6875rem", lineHeight: 1.3 }}>{secondaryLanguageMode === "original" ? "כל שפה מוצגת בכתב המקורי שלה." : secondaryLanguageMode === "translate" ? "השפות הלא ראשיות מתורגמות לעברית; השפה הראשית נשמרת." : "לפי ההגייה: Good morning ← גוד מורנינג."}</Typography>
  </Stack>;
}
