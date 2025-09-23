import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import {
  AccessTimeRounded,
  DownloadRounded,
  ReplayRounded,
  SubtitlesRounded,
  VideoLibraryRounded,
} from "@mui/icons-material";
import type { ApiResponse, Segment } from "../types";
import { formatTime } from "../utils/formatTime";

type TranscriptionResultProps = {
  response: ApiResponse;
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
  mediaUrl: string | null;
  onBack: () => void;
};

export function TranscriptionResult({
  response,
  subtitleFormatLabel,
  downloadUrl,
  downloadName,
  mediaUrl,
  onBack,
}: TranscriptionResultProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const segments = useMemo(() => response.segments ?? [], [response.segments]);
  const [activeSegmentId, setActiveSegmentId] = useState<Segment["id"] | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleTimeUpdate = () => {
      const currentTime = video.currentTime;
      const segment = findSegment(segments, currentTime);
      setActiveSegmentId(segment?.id ?? null);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [segments]);

  useEffect(() => {
    setActiveSegmentId(null);
  }, [mediaUrl]);

  const activeSegment = useMemo(
    () => segments.find((segment) => segment.id === activeSegmentId) ?? null,
    [segments, activeSegmentId],
  );

  const handleSegmentClick = (segment: Segment) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.currentTime = Math.max(segment.start - 0.1, 0);
    void video.play();
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
                  הורידו קובץ
                </Button>
              )}
            </Stack>
          </Stack>

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
                      <Box
                        position="absolute"
                        bottom={0}
                        width="100%"
                        bgcolor="rgba(0,0,0,0.65)"
                        px={3}
                        py={2}
                      >
                        <Typography variant="subtitle1" color="common.white" textAlign="center">
                          {activeSegment.text}
                        </Typography>
                      </Box>
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
              {segments.length ? (
                <List disablePadding sx={{ borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                  {segments.map((segment) => (
                    <ListItem key={segment.id} disablePadding divider>
                      <ListItemButton
                        selected={segment.id === activeSegmentId}
                        onClick={() => handleSegmentClick(segment)}
                        sx={{ alignItems: "flex-start" }}
                      >
                        <ListItemIcon sx={{ minWidth: 48, mt: 0.5 }}>
                          <AccessTimeRounded fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary={`${formatTime(segment.start)} – ${formatTime(segment.end)}`}
                          secondary={segment.text}
                          secondaryTypographyProps={{ component: "span" }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Alert severity="info">לא נמצאו מקטעים להצגה.</Alert>
              )}
            </Stack>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function findSegment(segments: Segment[], time: number) {
  return segments.find((segment) => time >= segment.start && time <= segment.end);
}
