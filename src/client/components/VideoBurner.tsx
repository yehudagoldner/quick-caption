import type { ChangeEvent } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  FormLabel,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { DownloadRounded, MovieFilterRounded } from "@mui/icons-material";

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

type VideoBurnerProps = {
  fontSize: number;
  fontColor: string;
  outlineColor: string;
  offsetYPercent: number;
  marginPercent: number;
  isBurning: boolean;
  burnError: string | null;
  burnedVideo: BurnedVideo | null;
  mediaUrl: string | null;
  videoDimensions: { width: number; height: number } | null;
  onFontSizeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFontColorChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOutlineColorChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOffsetYChange: (event: Event, value: number | number[]) => void;
  onMarginChange: (event: Event, value: number | number[]) => void;
  onBurnVideo: () => void;
};

export function VideoBurner({
  fontSize,
  fontColor,
  outlineColor,
  offsetYPercent,
  marginPercent,
  isBurning,
  burnError,
  burnedVideo,
  mediaUrl,
  videoDimensions,
  onFontSizeChange,
  onFontColorChange,
  onOutlineColorChange,
  onOffsetYChange,
  onMarginChange,
  onBurnVideo,
}: VideoBurnerProps) {
  return (
    <Stack
      spacing={1.5}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        p: { xs: 2, sm: 3 },
        bgcolor: "background.paper",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <MovieFilterRounded color="primary" />
        <Typography variant="h6">ייצוא וידאו עם כתוביות צרובות</Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        התאימו את הכתוביות – כל שינוי נראה מיד ויחול גם על הווידאו הסופי.
      </Typography>

      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
        <TextField
          label="גודל פונט"
          type="number"
          value={fontSize}
          onChange={onFontSizeChange}
          inputProps={{ min: 12, max: 96 }}
          size="small"
          sx={{ width: { xs: "100%", md: 140 } }}
        />
        <TextField
          label="צבע טקסט"
          type="color"
          value={fontColor}
          onChange={onFontColorChange}
          size="small"
          sx={{ width: { xs: "100%", md: 140 } }}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label="צבע מסגרת"
          type="color"
          value={outlineColor}
          onChange={onOutlineColorChange}
          size="small"
          sx={{ width: { xs: "100%", md: 140 } }}
          InputLabelProps={{ shrink: true }}
        />
      </Stack>

      <Stack spacing={1}>
        <Stack spacing={0.5}>
          <FormLabel sx={{ fontSize: 12 }}>גובה הכתוביות (% מהחלק התחתון)</FormLabel>
          <Slider
            value={offsetYPercent}
            onChange={onOffsetYChange}
            min={0}
            max={100}
            valueLabelDisplay="auto"
            size="small"
          />
        </Stack>
        <Stack spacing={0.5}>
          <FormLabel sx={{ fontSize: 12 }}>שוליים אופקיים (% מכל צד)</FormLabel>
          <Slider
            value={marginPercent}
            onChange={onMarginChange}
            min={0}
            max={40}
            valueLabelDisplay="auto"
            size="small"
          />
        </Stack>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
        <Button
          variant="contained"
          startIcon={isBurning ? <CircularProgress size={20} color="inherit" /> : <MovieFilterRounded />}
          onClick={onBurnVideo}
          disabled={isBurning || !mediaUrl}
        >
          {isBurning ? "יוצר וידאו..." : "יצירת וידאו עם כתוביות"}
        </Button>

        {burnedVideo && (
          <Button
            component="a"
            href={burnedVideo.url}
            download={burnedVideo.name}
            variant="outlined"
            startIcon={<DownloadRounded />}
          >
            הורידו את הווידאו הצרוב
          </Button>
        )}
      </Stack>

      {burnError && <Alert severity="error">{burnError}</Alert>}
    </Stack>
  );
}