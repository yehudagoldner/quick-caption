import { Alert, Autocomplete, Box, TextField, Typography } from "@mui/material";
import { CAPTION_FONTS } from "../../captionFonts.js";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { useCaptionFont } from "../hooks/useCaptionFont";

const categories: Record<string, string> = {
  "Sans Serif": "מודרניים וקריאים", "Serif": "קלאסיים", "Handwriting": "כתב יד",
  "Monospace": "רוחב קבוע", "Display": "דקורטיביים",
};

export function CaptionFontPicker({ disabled = false }: { disabled?: boolean }) {
  const { preferences, update } = useEditorPreferences();
  const { font: selected, ready, error } = useCaptionFont(preferences.fontId);
  return <Box sx={{ minWidth: 0 }}>
    <Autocomplete
      options={CAPTION_FONTS}
      value={selected}
      disabled={disabled}
      disableClearable
      autoHighlight
      size="small"
      groupBy={font => font.id === "assistant" ? "ברירת מחדל" : categories[font.category] ?? "נוספים"}
      getOptionLabel={font => font.label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_, font) => update({ fontId: font.id })}
      renderInput={params => <TextField {...params} label="סוג פונט" placeholder="חיפוש פונט" />}
      renderOption={(props, font) => <li {...props} key={font.id} dir="ltr">{font.label}</li>}
      slotProps={{ listbox: { sx: { maxHeight: 260 } }, popper: { sx: { zIndex: 1500 } } }}
    />
    <Typography data-testid="caption-font-sample" dir="rtl" sx={{
      fontFamily: `"${selected.cssFamily}"`, fontWeight: selected.weight, fontSize: 22,
      my: 0.75, lineHeight: 1.6, overflowWrap: "anywhere", textAlign: "center",
    }}>ככה ייראו הכתוביות שלך</Typography>
    <Typography variant="caption" color="text.secondary">{CAPTION_FONTS.length} פונטים בעברית</Typography>
    {error && <Alert severity="error" sx={{ mt: 1 }}>טעינת הפונט נכשלה. בחרו פונט אחר.</Alert>}
    {!ready && !error && <Typography variant="caption" display="block">טוען פונט...</Typography>}
  </Box>;
}
