import { useState, type ChangeEvent } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
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
  AddRounded,
} from "@mui/icons-material";

export type BurnOptions = {
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
  fontSize: number;
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
  currentTime: number;
  onFontSizeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFontColorChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOutlineColorChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOffsetYChange: (event: Event, value: number | number[]) => void;
  onMarginChange: (event: Event, value: number | number[]) => void;
  onBurnVideo: () => void;
  onToggleSidebar: () => void;
  onAddSubtitle: (text: string, startTime: number, endTime: number) => void;
};

export function VideoToolbar({
  fontSize,
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
  currentTime,
  onFontSizeChange,
  onFontColorChange,
  onOutlineColorChange,
  onOffsetYChange,
  onMarginChange,
  onBurnVideo,
  onToggleSidebar,
  onAddSubtitle,
}: VideoToolbarProps) {
  // Download menu state
  const [downloadAnchorEl, setDownloadAnchorEl] = useState<null | HTMLElement>(null);
  const downloadMenuOpen = Boolean(downloadAnchorEl);

  // Popover states
  const [positionAnchorEl, setPositionAnchorEl] = useState<null | HTMLElement>(null);
  const [marginAnchorEl, setMarginAnchorEl] = useState<null | HTMLElement>(null);
  const [fontAnchorEl, setFontAnchorEl] = useState<null | HTMLElement>(null);
  const [colorAnchorEl, setColorAnchorEl] = useState<null | HTMLElement>(null);
  const [addSubtitleDialogOpen, setAddSubtitleDialogOpen] = useState(false);

  // Add subtitle form state
  const [newSubtitleText, setNewSubtitleText] = useState("");
  const [newSubtitleStart, setNewSubtitleStart] = useState(0);
  const [newSubtitleEnd, setNewSubtitleEnd] = useState(0);

  const handleDownloadClick = (event: React.MouseEvent<HTMLElement>) => {
    setDownloadAnchorEl(event.currentTarget);
  };

  const handleDownloadClose = () => {
    setDownloadAnchorEl(null);
  };

  const handleDownloadSubtitles = () => {
    if (downloadUrl) {
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = downloadName;
      link.click();
    }
    handleDownloadClose();
  };

  const handleBurnAndDownload = async () => {
    handleDownloadClose();
    onBurnVideo();
  };

  const handleOpenAddSubtitleDialog = () => {
    setNewSubtitleText("");
    setNewSubtitleStart(currentTime);
    setNewSubtitleEnd(currentTime + 2); // Default 2 seconds duration
    setAddSubtitleDialogOpen(true);
  };

  const handleAddSubtitle = () => {
    if (newSubtitleText.trim()) {
      onAddSubtitle(newSubtitleText.trim(), newSubtitleStart, newSubtitleEnd);
      setAddSubtitleDialogOpen(false);
      setNewSubtitleText("");
    }
  };

  return (
    <>
      <Paper
        elevation={2}
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 1,
          p: 1.5,
          borderRadius: 2,
          bgcolor: "background.paper",
          minWidth: 140,
        }}
      >
        {/* Download Button */}
        <Button
          variant="outlined"
          startIcon={<DownloadRounded />}
          onClick={handleDownloadClick}
          size="small"
          sx={{ justifyContent: "flex-start" }}
        >
          הורדה
        </Button>

        <Box sx={{ height: 1, width: "100%", bgcolor: "divider", my: 0.5 }} />

        {/* Position Control */}
        <Button
          variant="text"
          startIcon={<HeightRounded />}
          onClick={(e) => setPositionAnchorEl(e.currentTarget)}
          size="small"
          sx={{ justifyContent: "flex-start" }}
        >
          מיקום
        </Button>

        {/* Margins Control */}
        <Button
          variant="text"
          startIcon={<SpaceBarRounded />}
          onClick={(e) => setMarginAnchorEl(e.currentTarget)}
          size="small"
          sx={{ justifyContent: "flex-start" }}
        >
          שוליים
        </Button>

        {/* Font Control */}
        <Button
          variant="text"
          startIcon={<FormatSizeRounded />}
          onClick={(e) => setFontAnchorEl(e.currentTarget)}
          size="small"
          sx={{ justifyContent: "flex-start" }}
        >
          פונט
        </Button>

        {/* Color Control */}
        <Button
          variant="text"
          startIcon={<PaletteRounded />}
          onClick={(e) => setColorAnchorEl(e.currentTarget)}
          size="small"
          sx={{ justifyContent: "flex-start" }}
        >
          צבעים
        </Button>

        <Box sx={{ height: 1, width: "100%", bgcolor: "divider", my: 0.5 }} />

        {/* Add Subtitle Button */}
        <Button
          variant="text"
          startIcon={<AddRounded />}
          onClick={handleOpenAddSubtitleDialog}
          size="small"
          sx={{ justifyContent: "flex-start" }}
        >
          הוסף כתובית
        </Button>

        {/* Sidebar Toggle */}
        <Button
          variant="text"
          startIcon={<ViewSidebarRounded />}
          onClick={onToggleSidebar}
          size="small"
          color={sidebarOpen ? "primary" : "inherit"}
          sx={{ justifyContent: "flex-start" }}
        >
          {sidebarOpen ? "הסתר עורך" : "הצג עורך"}
        </Button>

        {/* Burn Status/Error */}
        {isBurning && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, mt: 1 }}>
            <CircularProgress size={20} />
            <Box component="span" sx={{ fontSize: 12, textAlign: "center" }}>
              יוצר וידאו...
            </Box>
          </Box>
        )}
      </Paper>

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
        <MenuItem onClick={handleDownloadSubtitles} disabled={!downloadUrl}>
          <SubtitlesRounded sx={{ mr: 1 }} />
          הורד קובץ כתוביות
        </MenuItem>
        <MenuItem onClick={handleBurnAndDownload} disabled={isBurning || !mediaUrl}>
          <MovieFilterRounded sx={{ mr: 1 }} />
          הורד סרטון עם כתוביות
        </MenuItem>
        {burnedVideo && (
          <MenuItem
            component="a"
            href={burnedVideo.url}
            download={burnedVideo.name}
            onClick={handleDownloadClose}
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
        anchorOrigin={{ vertical: 'center', horizontal: 'left' }}
        transformOrigin={{ vertical: 'center', horizontal: 'right' }}
      >
        <Paper sx={{ p: 3, width: 250 }}>
          <Stack spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>גודל פונט</InputLabel>
              <Select
                value={fontSize}
                label="גודל פונט"
                onChange={(e) => onFontSizeChange({ target: { value: String(e.target.value) } } as ChangeEvent<HTMLInputElement>)}
              >
                <MenuItem value={24}>24 - קטן מאוד</MenuItem>
                <MenuItem value={32}>32 - קטן</MenuItem>
                <MenuItem value={40}>40 - בינוני קטן</MenuItem>
                <MenuItem value={48}>48 - בינוני</MenuItem>
                <MenuItem value={56}>56 - בינוני גדול</MenuItem>
                <MenuItem value={64}>64 - גדול</MenuItem>
                <MenuItem value={72}>72 - גדול מאוד</MenuItem>
                <MenuItem value={80}>80 - ענק</MenuItem>
                <MenuItem value={96}>96 - ענק מאוד</MenuItem>
              </Select>
            </FormControl>
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
          </Stack>
        </Paper>
      </Popover>

      {/* Add Subtitle Dialog */}
      <Dialog
        open={addSubtitleDialogOpen}
        onClose={() => setAddSubtitleDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>הוסף כתובית חדשה</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 2 }}>
            <TextField
              label="טקסט הכתובית"
              multiline
              rows={3}
              value={newSubtitleText}
              onChange={(e) => setNewSubtitleText(e.target.value)}
              fullWidth
              autoFocus
              placeholder="הקלד את הטקסט של הכתובית..."
            />
            <TextField
              label="זמן התחלה (שניות)"
              type="number"
              value={newSubtitleStart}
              onChange={(e) => setNewSubtitleStart(Number(e.target.value))}
              inputProps={{ min: 0, step: 0.1 }}
              fullWidth
            />
            <TextField
              label="זמן סיום (שניות)"
              type="number"
              value={newSubtitleEnd}
              onChange={(e) => setNewSubtitleEnd(Number(e.target.value))}
              inputProps={{ min: 0, step: 0.1 }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddSubtitleDialogOpen(false)}>ביטול</Button>
          <Button
            onClick={handleAddSubtitle}
            variant="contained"
            disabled={!newSubtitleText.trim() || newSubtitleEnd <= newSubtitleStart}
          >
            הוסף
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
