import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormLabel,
  List,
  ListItem,
  ListItemIcon,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  AccessTimeRounded,
  DownloadRounded,
  FormatListBulletedRounded,
  MovieFilterRounded,
  ReplayRounded,
  SubtitlesRounded,
  VideoLibraryRounded,
} from "@mui/icons-material";
import type { ApiResponse, Segment } from "../types";
import { formatTime } from "../utils/formatTime";

export type BurnOptions = {
  fontSize: number;
  fontColor: string;
  outlineColor: string;
  offsetYPercent: number;
  marginPercent: number;
};

type BurnResult = {
  blob: Blob;
  filename?: string;
};

type TranscriptionResultProps = {
  response: ApiResponse;
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
  mediaUrl: string | null;
  onBack: () => void;
  onBurn: (options: BurnOptions) => Promise<BurnResult>;
  onSaveSegments: (segments: Segment[], subtitleContent: string) => Promise<void>;
  videoId: number | null;
  isEditable: boolean;
};

type BurnedVideo = {
  url: string;
  name: string;
};

type SaveState = "idle" | "saving" | "success" | "error";

export function TranscriptionResult({
  response,
  subtitleFormatLabel,
  downloadUrl,
  downloadName,
  mediaUrl,
  onBack,
  onBurn,
  onSaveSegments,
  videoId,
  isEditable,
}: TranscriptionResultProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const responseSegments = response.segments ?? [];
  const [editableSegments, setEditableSegments] = useState<Segment[]>(responseSegments);
  const [activeSegmentId, setActiveSegmentId] = useState<Segment["id"] | null>(null);
  const [fontSize, setFontSize] = useState(36);
  const [fontColor, setFontColor] = useState("#ffffff");
  const [outlineColor, setOutlineColor] = useState("#000000");
  const [offsetYPercent, setOffsetYPercent] = useState(88);
  const [marginPercent, setMarginPercent] = useState(5);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [isBurning, setIsBurning] = useState(false);
  const [burnedVideo, setBurnedVideo] = useState<BurnedVideo | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditableSegments(responseSegments.map((segment) => ({ ...segment })));
  }, [responseSegments]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;
      const segment = findSegment(editableSegments, currentTime);
      setActiveSegmentId(segment?.id ?? null);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [editableSegments]);

  useEffect(() => {
    setActiveSegmentId(null);
  }, [mediaUrl]);

  useEffect(() => {
    return () => {
      if (burnedVideo) {
        URL.revokeObjectURL(burnedVideo.url);
      }
    };
  }, [burnedVideo]);

  const activeSegment = useMemo(
    () => editableSegments.find((segment) => segment.id === activeSegmentId) ?? null,
    [editableSegments, activeSegmentId],
  );

  const previewStyle = useMemo(() => {
    const clampedY = Math.min(100, Math.max(0, offsetYPercent));
    const clampedMargin = Math.min(40, Math.max(0, marginPercent));
    const widthPercent = Math.max(10, 100 - clampedMargin * 2);

    return {
      position: "absolute" as const,
      left: "50%",
      top: `${clampedY}%`,
      transform: "translate(-50%, -50%)",
      color: fontColor,
      fontSize: `${fontSize}px`,
      fontWeight: 600,
      lineHeight: 1.35,
      textAlign: "center" as const,
      whiteSpace: "pre-wrap" as const,
      pointerEvents: "none" as const,
      textShadow: createOutlineShadow(outlineColor),
      width: `${widthPercent}%`,
      maxWidth: `${widthPercent}%`,
    };
  }, [fontColor, fontSize, offsetYPercent, outlineColor, marginPercent]);

  const handleSegmentTextChange = (segmentId: Segment["id"], value: string) => {
    setEditableSegments((prev) =>
      prev.map((segment) => (segment.id === segmentId ? { ...segment, text: value } : segment)),
    );
  };

  const handleSegmentBlur = async (segmentId: Segment["id"]) => {
    if (!isEditable || !videoId) {
      return;
    }

    const original = responseSegments.find((segment) => segment.id === segmentId);
    const updated = editableSegments.find((segment) => segment.id === segmentId);

    if (!original || !updated || original.text === updated.text) {
      return;
    }

    setSaveState("saving");
    setSaveError(null);
    try {
      const subtitleContent = segmentsToSrt(editableSegments);
      await onSaveSegments(editableSegments, subtitleContent);
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (error) {
      console.error(error);
      setSaveState("error");
      setSaveError("שמירת השינויים נכשלה. נסו שוב.");
    }
  };

  const handleFontSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const numeric = Number(event.target.value);
    if (!Number.isFinite(numeric)) {
      return;
    }
    setFontSize(Math.min(96, Math.max(12, Math.round(numeric))));
  };

  const handleFontColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFontColor(event.target.value);
  };

  const handleOutlineColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    setOutlineColor(event.target.value);
  };

  const handleOffsetYChange = (_event: Event, value: number | number[]) => {
    setOffsetYPercent(Array.isArray(value) ? value[0] : value);
  };

  const handleMarginChange = (_event: Event, value: number | number[]) => {
    setMarginPercent(Array.isArray(value) ? value[0] : value);
  };

  const handleBurnVideo = async () => {
    if (!response.subtitle?.content) {
      setBurnError("לא נמצאו כתוביות מתאימות לצריבה.");
      return;
    }

    setIsBurning(true);
    setBurnError(null);
    try {
      const result = await onBurn({
        fontSize,
        fontColor,
        outlineColor,
        offsetYPercent,
        marginPercent,
      });
      if (burnedVideo) {
        URL.revokeObjectURL(burnedVideo.url);
      }
      const url = URL.createObjectURL(result.blob);
      const baseName = downloadName.replace(/\.[^.]+$/, "") || "video";
      const fallbackName = `${baseName}-burned.mp4`;
      setBurnedVideo({ url, name: result.filename ?? fallbackName });
    } catch (error) {
      setBurnError(error instanceof Error ? error.message : "אירעה שגיאה בזמן יצירת הווידאו.");
    } finally {
      setIsBurning(false);
    }
  };

  return (
    <Card elevation={3}>
      <CardContent>
        <Stack spacing={3}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems="center" gap={1}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <SubtitlesRounded color="primary" />
              <Typography variant="h5">שלב 2 – תצוגה מקדימה</Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip label={subtitleFormatLabel} color="primary" variant="outlined" />
              <Button variant="outlined" startIcon={<ReplayRounded />} onClick={onBack}>
                חזרה למסך ההעלאה
              </Button>
              {downloadUrl && (
                <Button
                  component="a"
                  href={downloadUrl}
                  download={downloadName}
                  variant="contained"
                  startIcon={<DownloadRounded />}
                >
                  הורידו את קובץ הכתוביות
                </Button>
              )}
            </Stack>
          </Stack>

          {response.warnings?.length ? (
            <Alert severity="warning" icon={<FormatListBulletedRounded />}>
              <Stack spacing={1}>
                <Typography variant="subtitle2">אזהרות אפשריות:</Typography>
                <List dense disablePadding>
                  {response.warnings.map((warning, index) => (
                    <ListItem key={index} disableGutters sx={{ py: 0 }}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <FormatListBulletedRounded fontSize="small" />
                      </ListItemIcon>
                      <Typography variant="body2">{warning}</Typography>
                    </ListItem>
                  ))}
                </List>
              </Stack>
            </Alert>
          ) : null}

          <Divider />

          <Stack direction={{ xs: "column", md: "row" }} spacing={3} alignItems="stretch">
            <Stack flex={1} spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center">
                <VideoLibraryRounded color="primary" />
                <Typography variant="h6">נגן תצוגה</Typography>
              </Stack>
              <Box
                position="relative"
                borderRadius={3}
                overflow="hidden"
                bgcolor="common.black"
                boxShadow={(theme) => theme.shadows[4]}
                minHeight={280}
              >
                {mediaUrl ? (
                  <>
                    <Box
                      component="video"
                      ref={videoRef}
                      controls
                      src={mediaUrl}
                      sx={{ width: "100%", display: "block", backgroundColor: "common.black" }}
                    />
                    {activeSegment?.text ? (
                      <Box sx={previewStyle}>{activeSegment.text}</Box>
                    ) : null}
                  </>
                ) : (
                  <Stack height="100%" alignItems="center" justifyContent="center" spacing={1}>
                    <Typography variant="body1">אין תצוגה זמינה לקובץ הנוכחי.</Typography>
                    <Typography variant="body2" color="text.secondary">
                      בדקו שהקובץ נטען בהצלחה ונסו שוב.
                    </Typography>
                  </Stack>
                )}
              </Box>
            </Stack>

            <Divider orientation="vertical" flexItem sx={{ display: { xs: "none", md: "block" } }} />

            <Stack flex={1} spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center">
                <AccessTimeRounded color="primary" />
                <Typography variant="h6">מקטעים מתוזמנים</Typography>
              </Stack>
              {editableSegments.length ? (
                <Stack spacing={2}>
                  {editableSegments.map((segment) => (
                    <Stack key={segment.id} spacing={1}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <AccessTimeRounded fontSize="small" color="primary" />
                        <Typography variant="body2" fontWeight={600}>
                          {`${formatTime(segment.start)} – ${formatTime(segment.end)}`}
                        </Typography>
                      </Stack>
                      <TextField
                        multiline
                        minRows={2}
                        value={segment.text}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          handleSegmentTextChange(segment.id, event.target.value)
                        }
                        onBlur={() => handleSegmentBlur(segment.id)}
                        fullWidth
                        disabled={!isEditable}
                      />
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Alert severity="info">לא נמצאו מקטעים להצגה.</Alert>
              )}
              {saveState === "saving" && <CircularProgress size={20} />}
              {saveState === "success" && <Typography variant="body2" color="success.main">השינויים נשמרו.</Typography>}
              {saveState === "error" && saveError ? <Alert severity="error">{saveError}</Alert> : null}
            </Stack>
          </Stack>

          <Divider />

          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <MovieFilterRounded color="primary" />
              <Typography variant="h6">ייצוא וידאו עם כתוביות צרובות</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              התאימו את הכתוביות – כל שינוי נראה מיד ויחול גם על הווידאו הסופי.
            </Typography>

            <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }}>
              <TextField
                label="גודל פונט"
                type="number"
                value={fontSize}
                onChange={handleFontSizeChange}
                inputProps={{ min: 12, max: 96 }}
                sx={{ width: { xs: "100%", md: 160 } }}
              />
              <TextField
                label="צבע טקסט"
                type="color"
                value={fontColor}
                onChange={handleFontColorChange}
                sx={{ width: { xs: "100%", md: 160 } }}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="צבע מסגרת"
                type="color"
                value={outlineColor}
                onChange={handleOutlineColorChange}
                sx={{ width: { xs: "100%", md: 160 } }}
                InputLabelProps={{ shrink: true }}
              />
            </Stack>

            <Stack spacing={2}>
              <FormLabel>גובה הכתוביות (% מהחלק העליון)</FormLabel>
              <Slider value={offsetYPercent} onChange={handleOffsetYChange} min={0} max={100} valueLabelDisplay="auto" />
              <FormLabel>שוליים אופקיים (% מכל צד)</FormLabel>
              <Slider value={marginPercent} onChange={handleMarginChange} min={0} max={40} valueLabelDisplay="auto" />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }}>
              <Button
                variant="contained"
                startIcon={isBurning ? <CircularProgress size={20} color="inherit" /> : <MovieFilterRounded />}
                onClick={handleBurnVideo}
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
        </Stack>
      </CardContent>
    </Card>
  );
}

function findSegment(segments: Segment[], time: number) {
  return segments.find((segment) => time >= segment.start && time <= segment.end);
}

function createOutlineShadow(color: string) {
  return [
    `-2px 0 0 ${color}`,
    `2px 0 0 ${color}`,
    `0 -2px 0 ${color}`,
    `0 2px 0 ${color}`,
    `-1px -1px 0 ${color}`,
    `1px -1px 0 ${color}`,
    `-1px 1px 0 ${color}`,
    `1px 1px 0 ${color}`,
  ].join(", ");
}

function segmentsToSrt(segments: Segment[]) {
  return segments
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}\n${segment.text}\n`,
    )
    .join("\n");
}

function formatSrtTimestamp(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return "00:00:00,000";
  }
  const totalMillis = Math.max(0, Math.round(seconds * 1000));
  const hrs = Math.floor(totalMillis / 3_600_000);
  const mins = Math.floor((totalMillis % 3_600_000) / 60_000);
  const secs = Math.floor((totalMillis % 60_000) / 1000);
  const millis = totalMillis % 1000;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

