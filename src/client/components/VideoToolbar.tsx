import { useContext, useId, useState, type ChangeEvent, type ReactNode } from "react";
import { DownloadContext } from "../contexts/DownloadContext";
import type { Segment, Word } from "../types";
import { AUTO_CAPTION_FONT_SIZE, CAPTION_FONT_SIZES, type CaptionFontSizeSetting } from "../../captionStyle.js";
import { CaptionFontPicker } from "./CaptionFontPicker";
import type { CaptionMotion, PopIntensity } from "../../captionMotion.js";
import type { BurnProgress } from '../utils/burnRequest';
import {
  Box,
  Button,
  IconButton,
  FormLabel,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Select,
  Slider,
  Stack,
  TextField,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Typography,
} from "@mui/material";
import {
  DownloadRounded,
  HeightRounded,
  SpaceBarRounded,
  FormatSizeRounded,
  PaletteRounded,
  ViewSidebarRounded,
  MovieFilterRounded,
  SubtitlesRounded,
  RecordVoiceOverRounded,
  AutoFixHighRounded,
  SettingsRounded,
  CloseRounded,
} from "@mui/icons-material";

export type BurnOptions = {
  onProgress?: (progress: BurnProgress) => void;
  activeWordColor?: string;
  captionMotion?: CaptionMotion;
  popIntensity?: PopIntensity;
  activeWordEnabled?: boolean;
  segments?: Segment[];
  words?: Word[];
  subtitleContent?: string;
  textDirection?: "rtl" | "ltr";
  fontId?: string;
  fontSize: number;
  fontColor: string;
  outlineColor: string;
  offsetYPercent: number;
  marginPercent: number;
  videoWidth?: number | null;
  videoHeight?: number | null;
};

type BurnedVideo = {
  url: string;
  name: string;
};

type VideoToolbarProps = {
  fontReady?: boolean;
  pendingEdits?: boolean;
  editorSettings: ReactNode;
  captionStyles?: ReactNode;
  fontId?: string;
  onFontChange?: (id: string) => void;
  activeWordColor?: string;
  onActiveWordColorChange?: (color: string) => void;
  canBurn?: boolean;
  fontSize: CaptionFontSizeSetting;
  autoFontSize: number;
  fontColor: string;
  outlineColor: string;
  offsetYPercent: number;
  marginPercent: number;
  isBurning: boolean;
  burnError: string | null;
  burnedVideo: BurnedVideo | null;
  mediaUrl: string | null;
  downloadUrl: string | null;
  downloadName: string;
  sidebarOpen: boolean;
  activeWordEnabled: boolean;
  onFontSizeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFontColorChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOutlineColorChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOffsetYChange: (event: Event, value: number | number[]) => void;
  onMarginChange: (event: Event, value: number | number[]) => void;
  onBurnVideo: () => void;
  onToggleSidebar: () => void;
  onToggleActiveWord: () => void;
  onResegment?: (maxWords: number, customInstructions?: string) => Promise<void>;
  onAIEdit?: (instructions: string) => Promise<void>;
};

export function VideoToolbar({
  fontReady = true,
  pendingEdits = false,
  editorSettings,
  captionStyles, fontId, onFontChange, activeWordColor, onActiveWordColorChange,
  canBurn = true,
  fontSize,
  autoFontSize,
  fontColor,
  outlineColor,
  offsetYPercent,
  marginPercent,
  isBurning,
  burnError,
  burnedVideo,
  mediaUrl,
  downloadUrl,
  downloadName,
  sidebarOpen,
  activeWordEnabled,
  onFontSizeChange,
  onFontColorChange,
  onOutlineColorChange,
  onOffsetYChange,
  onMarginChange,
  onBurnVideo,
  onToggleSidebar,
  onToggleActiveWord,
  onAIEdit,
}: VideoToolbarProps) {
  const downloads = useContext(DownloadContext);
  // Download menu state
  const [downloadAnchorEl, setDownloadAnchorEl] = useState<null | HTMLElement>(null);
  const downloadMenuOpen = Boolean(downloadAnchorEl);
  const [settingsAnchorEl, setSettingsAnchorEl] = useState<HTMLElement | null>(null);
  const settingsId = useId();
  const settingsTitleId = useId();
  const [stylesAnchorEl, setStylesAnchorEl] = useState<HTMLElement | null>(null);
  const stylesId = useId();
  const stylesTitleId = useId();

  // Popover states
  const [positionAnchorEl, setPositionAnchorEl] = useState<null | HTMLElement>(null);
  const [marginAnchorEl, setMarginAnchorEl] = useState<null | HTMLElement>(null);
  const [fontAnchorEl, setFontAnchorEl] = useState<null | HTMLElement>(null);
  const [colorAnchorEl, setColorAnchorEl] = useState<null | HTMLElement>(null);
  const [aiEditAnchorEl, setAiEditAnchorEl] = useState<null | HTMLElement>(null);
  const [aiEditError, setAiEditError] = useState<string | null>(null);
  const [aiEditInstructions, setAiEditInstructions] = useState("");
  const [isAIEditing, setIsAIEditing] = useState(false);

  const handleDownloadClick = (event: React.MouseEvent<HTMLElement>) => {
    setDownloadAnchorEl(event.currentTarget);
  };

  const handleDownloadClose = () => {
    setDownloadAnchorEl(null);
  };

  const handleBurnAndDownload = async () => {
    handleDownloadClose();
    onBurnVideo();
  };

  const handleApplyAIEdit = async () => {
    if (onAIEdit && aiEditInstructions.trim()) {
      try {
        setIsAIEditing(true);
        setAiEditError(null);
        await onAIEdit(aiEditInstructions.trim());
        setAiEditAnchorEl(null);
        setAiEditInstructions("");
      } catch (error) {
        console.error("AI edit failed", error);
        setAiEditError("עריכת AI נכשלה. ההוראות נשמרו; אפשר לנסות שוב.");
      } finally {
        setIsAIEditing(false);
      }
    }
  };

  return (
    <>
      <Paper
        role="group"
        aria-label="כלי עריכת כתוביות"
        elevation={2}
        sx={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: { xs: 1, md: .5 },
          p: { xs: 1.5, md: .75 },
          borderRadius: 2,
          bgcolor: "background.paper",
          minWidth: 0,
          width: "100%",
          flexWrap: "wrap",
          "& > .MuiBox-root:empty": { display: "none" },
          flexShrink: 0,
          maxWidth: "100%",
        }}
      >
        {/* Download Button */}
        {captionStyles && <Button size="small" variant="contained" startIcon={<PaletteRounded />}
          aria-haspopup="dialog" aria-expanded={Boolean(stylesAnchorEl)} aria-controls={stylesAnchorEl ? stylesId : undefined}
          onClick={event => setStylesAnchorEl(event.currentTarget)}>סגנונות</Button>}
        <Button
          variant="outlined"
          startIcon={<DownloadRounded />}
          onClick={handleDownloadClick}
          disabled={pendingEdits}
          size="small"
          sx={{ justifyContent: "flex-start", minWidth: "fit-content" }}
        >
          הורדה
        </Button>

        <Button
          variant={settingsAnchorEl ? "outlined" : "text"}
          startIcon={<SettingsRounded />}
          onClick={event => setSettingsAnchorEl(event.currentTarget)}
          size="small"
          aria-haspopup="dialog"
          aria-expanded={Boolean(settingsAnchorEl)}
          aria-controls={settingsAnchorEl ? settingsId : undefined}
          sx={{ minWidth: "fit-content" }}
        >
          הגדרות כתוביות
        </Button>

        <Box sx={{ height: { xs: 24, md: 1 }, width: { xs: 1, md: "100%" }, bgcolor: "divider", my: { xs: 0, md: 0.5 }, mx: { xs: 0.5, md: 0 } }} />

        {/* Position Control */}
        <Button
          variant="text"
          startIcon={<HeightRounded />}
          onClick={(e) => setPositionAnchorEl(e.currentTarget)}
          size="small"
          sx={{ justifyContent: "flex-start", minWidth: "fit-content" }}
        >
          מיקום
        </Button>

        {/* Margins Control */}
        <Button
          variant="text"
          startIcon={<SpaceBarRounded />}
          onClick={(e) => setMarginAnchorEl(e.currentTarget)}
          size="small"
          sx={{ justifyContent: "flex-start", minWidth: "fit-content" }}
        >
          שוליים
        </Button>

        {/* Font Control */}
        <Button
          variant="text"
          startIcon={<FormatSizeRounded />}
          onClick={(e) => setFontAnchorEl(e.currentTarget)}
          size="small"
          sx={{ justifyContent: "flex-start", minWidth: "fit-content" }}
        >
          פונט
        </Button>

        {/* Color Control */}
        <Button
          variant="text"
          startIcon={<PaletteRounded />}
          onClick={(e) => setColorAnchorEl(e.currentTarget)}
          size="small"
          sx={{ justifyContent: "flex-start", minWidth: "fit-content" }}
        >
          צבעים
        </Button>

        <Box sx={{ height: { xs: 24, md: 1 }, width: { xs: 1, md: "100%" }, bgcolor: "divider", my: { xs: 0, md: 0.5 }, mx: { xs: 0.5, md: 0 } }} />

        {/* Active Word Toggle */}
        <Button
          variant="text"
          startIcon={<RecordVoiceOverRounded />}
          onClick={onToggleActiveWord}
          aria-pressed={activeWordEnabled}
          size="small"
          color={activeWordEnabled ? "primary" : "inherit"}
          sx={{ justifyContent: "flex-start", minWidth: "fit-content" }}
        >
          מילה אקטיבית
        </Button>

        {/* AI Edit Button */}
        {onAIEdit && (
          <Button
            variant="text"
            startIcon={<AutoFixHighRounded />}
            onClick={(e) => setAiEditAnchorEl(e.currentTarget)}
            disabled={pendingEdits}
            size="small"
            sx={{ justifyContent: "flex-start", minWidth: "fit-content" }}
          >
            עריכה עם AI
          </Button>
        )}

        {/* Sidebar Toggle */}
        <Button
          variant="text"
          startIcon={<ViewSidebarRounded />}
          onClick={onToggleSidebar}
          size="small"
          color={sidebarOpen ? "primary" : "inherit"}
          sx={{ justifyContent: "flex-start", minWidth: "fit-content" }}
        >
          {sidebarOpen ? "הסתר עורך" : "הצג עורך"}
        </Button>

        {/* Burn Status/Error */}
        {isBurning && (
          <Box sx={{ display: "flex", flexDirection: { xs: "row", md: "column" }, alignItems: "center", gap: 1, mt: { xs: 0, md: 1 }, ml: { xs: 1, md: 0 } }}>
            <CircularProgress size={20} />
            <Box component="span" sx={{ fontSize: 12, textAlign: "center", whiteSpace: "nowrap" }}>
              יוצר וידאו...
            </Box>
          </Box>
        )}
      </Paper>

      <Popover open={Boolean(stylesAnchorEl)} anchorEl={stylesAnchorEl} onClose={() => setStylesAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { id: stylesId, role: 'dialog', dir: 'rtl', 'aria-labelledby': stylesTitleId, sx: { width: 620, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 32px)', borderRadius: 3 } } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, pt: 1.5 }}>
          <Typography id={stylesTitleId} variant="subtitle1" fontWeight={700}>סגנונות כתוביות</Typography>
          <IconButton aria-label="סגירת סגנונות" onClick={() => setStylesAnchorEl(null)} size="small"><CloseRounded /></IconButton>
        </Stack>
        {stylesAnchorEl && <Box sx={{ p: 2 }}>{captionStyles}</Box>}
      </Popover>
      <Popover
        open={Boolean(settingsAnchorEl)}
        anchorEl={settingsAnchorEl}
        onClose={() => setSettingsAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        keepMounted
        slotProps={{ paper: {
          id: settingsId,
          role: "dialog",
          "aria-labelledby": settingsTitleId,
          sx: { width: 640, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 32px)" },
        } }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1 }}>
          <Typography id={settingsTitleId} variant="subtitle1" fontWeight={600}>הגדרות כתוביות</Typography>
          <IconButton aria-label="סגירת הגדרות כתוביות" onClick={() => setSettingsAnchorEl(null)} size="small"><CloseRounded /></IconButton>
        </Stack>
        {editorSettings}
      </Popover>

      {/* Error Alert */}
      {burnError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {burnError}
        </Alert>
      )}

      {/* Download Menu */}
      <Menu
        anchorEl={downloadAnchorEl}
        open={downloadMenuOpen}
        onClose={handleDownloadClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem component="a" href={downloadUrl ?? undefined} download={downloadName} onClick={event => {
          event.preventDefault(); handleDownloadClose();
          if (downloadUrl) void downloads.downloadSubtitles({ url: downloadUrl, name: downloadName });
        }} disabled={!downloadUrl}>
          <SubtitlesRounded sx={{ mr: 1 }} />
          הורד קובץ כתוביות
        </MenuItem>
        <MenuItem onClick={handleBurnAndDownload} disabled={isBurning || !mediaUrl || !canBurn || !fontReady}>
          <MovieFilterRounded sx={{ mr: 1 }} />
          {canBurn ? (fontReady ? "הורד סרטון עם כתוביות" : "ממתינים לטעינת הפונט") : "צריבה זמינה לקובץ וידאו בלבד"}
        </MenuItem>
        {burnedVideo && (
          <MenuItem
            component="a"
            href={burnedVideo.url}
            download={burnedVideo.name}
            onClick={event => { event.preventDefault(); handleDownloadClose(); void downloads.downloadVideo(burnedVideo); }}
          >
            <DownloadRounded sx={{ mr: 1 }} />
            הורד סרטון צרוב מוכן
          </MenuItem>
        )}
      </Menu>

      {/* Position Popover */}
      <Popover
        open={Boolean(positionAnchorEl)}
        anchorEl={positionAnchorEl}
        onClose={() => setPositionAnchorEl(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'left' }}
        transformOrigin={{ vertical: 'center', horizontal: 'right' }}
      >
        <Paper sx={{ p: 3, width: 300 }}>
          <Stack spacing={2}>
            <FormLabel sx={{ fontWeight: 600 }}>גובה הכתוביות (% מהחלק התחתון)</FormLabel>
            <Slider
              value={offsetYPercent}
              onChange={onOffsetYChange}
              min={0}
              max={100}
              valueLabelDisplay="auto"
              marks={[
                { value: 0, label: "0%" },
                { value: 50, label: "50%" },
                { value: 100, label: "100%" },
              ]}
            />
          </Stack>
        </Paper>
      </Popover>

      {/* Margin Popover */}
      <Popover
        open={Boolean(marginAnchorEl)}
        anchorEl={marginAnchorEl}
        onClose={() => setMarginAnchorEl(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'left' }}
        transformOrigin={{ vertical: 'center', horizontal: 'right' }}
      >
        <Paper sx={{ p: 3, width: 300 }}>
          <Stack spacing={2}>
            <FormLabel sx={{ fontWeight: 600 }}>שוליים אופקיים (% מכל צד)</FormLabel>
            <Slider
              value={marginPercent}
              onChange={onMarginChange}
              min={0}
              max={40}
              valueLabelDisplay="auto"
              marks={[
                { value: 0, label: "0%" },
                { value: 20, label: "20%" },
                { value: 40, label: "40%" },
              ]}
            />
          </Stack>
        </Paper>
      </Popover>

      {/* Font Popover */}
      <Popover
        open={Boolean(fontAnchorEl)}
        anchorEl={fontAnchorEl}
        onClose={() => setFontAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Paper sx={{ p: 2, width: 300, maxWidth: "calc(100vw - 32px)" }}>
          <Stack spacing={2}>
            <CaptionFontPicker disabled={isBurning} fontId={fontId} onFontChange={onFontChange} />
            <FormControl fullWidth size="small">
              <InputLabel>גודל פונט</InputLabel>
              <Select
                value={fontSize}
                label="גודל פונט"
                onChange={(e) => onFontSizeChange({ target: { value: String(e.target.value) } } as ChangeEvent<HTMLInputElement>)}
              >
                <MenuItem value={AUTO_CAPTION_FONT_SIZE}>אוטומטי ({autoFontSize})</MenuItem>
                {CAPTION_FONT_SIZES.map(size => <MenuItem key={size} value={size}>{size}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        </Paper>
      </Popover>

      {/* AI Edit Popover */}
      <Popover
        open={Boolean(aiEditAnchorEl)}
        anchorEl={aiEditAnchorEl}
        onClose={() => setAiEditAnchorEl(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'left' }}
        transformOrigin={{ vertical: 'center', horizontal: 'right' }}
      >
        <Paper sx={{ p: 3, width: 400 }}>
          <Stack spacing={2}>
            <Typography variant="subtitle1" fontWeight={600}>
              עריכת כתוביות עם AI
            </Typography>
            {aiEditError && <Alert severity="error">{aiEditError}</Alert>}

            <TextField
              label="מה לעשות?"
              multiline
              rows={4}
              value={aiEditInstructions}
              onChange={(e) => setAiEditInstructions(e.target.value)}
              fullWidth
              autoFocus
              placeholder="לדוגמה:
• תפצל את הכתוביות הארוכות
• תאחד כתוביות קצרות מדי
• תתקן שגיאות כתיב
• זה סטנדאפ - תשמור על הפאנצ'ים נפרדים
• תקצר את כל הכתוביות ל-5 מילים מקסימום"
            />

            <Button
              variant="contained"
              onClick={handleApplyAIEdit}
              fullWidth
              disabled={isAIEditing || !aiEditInstructions.trim()}
              size="large"
            >
              {isAIEditing ? "AI מעבד..." : "בצע עריכה"}
            </Button>

            <Typography variant="caption" color="text.secondary">
              ה-AI ישנה את הכתוביות הקיימות לפי ההוראות שלך. הוא ישמור על התזמון כמה שאפשר.
            </Typography>
          </Stack>
        </Paper>
      </Popover>

      {/* Color Popover */}
      <Popover
        open={Boolean(colorAnchorEl)}
        anchorEl={colorAnchorEl}
        onClose={() => setColorAnchorEl(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'left' }}
        transformOrigin={{ vertical: 'center', horizontal: 'right' }}
      >
        <Paper sx={{ p: 3, width: 250 }}>
          <Stack spacing={2}>
            <TextField
              label="צבע טקסט"
              type="color"
              value={fontColor}
              onChange={onFontColorChange}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="צבע מסגרת"
              type="color"
              value={outlineColor}
              onChange={onOutlineColorChange}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
            {onActiveWordColorChange && <TextField label="צבע מילה פעילה" type="color" value={activeWordColor ?? '#ffd700'} onChange={event => onActiveWordColorChange(event.target.value)} disabled={isBurning} fullWidth size="small" InputLabelProps={{ shrink: true }} />}
          </Stack>
        </Paper>
      </Popover>

    </>
  );
}
