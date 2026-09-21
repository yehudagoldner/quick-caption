import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Menu,
  MenuItem,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import {
  VideoLibraryRounded,
  AudioFileRounded,
  CheckCircleRounded,
  ErrorRounded,
  PendingRounded,
  EditRounded,
  FileDownloadRounded,
  UploadFileOutlined,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { formatDuration } from "../utils/formatTime";
import {
  downloadTextFile,
  parseSubtitleSegments,
  serializeSubtitles,
  subtitleDownloadName,
  SUBTITLE_EXPORT_FORMATS,
} from "../utils/subtitleExport";

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
const API_BASE_URL = RAW_API_BASE.replace(/\/?$/, "");

type Video = {
  id: number;
  original_filename: string;
  status: "uploaded" | "processing" | "completed" | "failed";
  media_type: "video" | "audio";
  format: string | null;
  duration_seconds: number | null;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
  has_subtitles: boolean;
};

type VideosPageProps = {
  variant?: "workspace" | "history";
  onEditVideo?: (videoId: number) => void;
  onNewVideo?: () => void;
};

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleString("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusIcon(status: Video["status"]) {
  switch (status) {
    case "completed":
      return <CheckCircleRounded color="success" />;
    case "failed":
      return <ErrorRounded color="error" />;
    case "processing":
      return <PendingRounded color="warning" />;
    default:
      return <PendingRounded color="action" />;
  }
}

function getStatusLabel(status: Video["status"]) {
  switch (status) {
    case "completed":
      return "הושלם";
    case "failed":
      return "נכשל";
    case "processing":
      return "מעבד";
    case "uploaded":
      return "הועלה";
    default:
      return status;
  }
}

function canOpenProject(video: Video) {
  return video.status === "completed" && video.has_subtitles;
}

function canExport(video: Video) {
  return video.status === "completed" && video.has_subtitles;
}

export function VideosPage({ variant = "history", onEditVideo, onNewVideo }: VideosPageProps) {
  const { user } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportMenu, setExportMenu] = useState<{ anchor: HTMLElement; video: Video } | null>(null);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    const fetchVideos = async () => {
      try {
        setLoading(true);
        setError(null);
        const url = `${API_BASE_URL || ""}/api/videos?userUid=${encodeURIComponent(user.uid)}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error("Failed to fetch videos");
        }
        const data = await response.json();
        setVideos(
          (data.videos || []).map((video: Video & { has_subtitles?: number | boolean }) => ({
            ...video,
            duration_seconds: video.duration_seconds == null ? null : Number(video.duration_seconds),
            has_subtitles: video.has_subtitles == null ? video.status === "completed" : Boolean(Number(video.has_subtitles)),
          })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "אירעה שגיאה בטעינת הווידאו");
      } finally {
        setLoading(false);
      }
    };

    fetchVideos();
  }, [user?.uid]);

  const handleExport = async (video: Video, format: string) => {
    if (!user?.uid) return;
    setExportMenu(null);
    setExportingId(video.id);
    setActionMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL || ""}/api/videos/${video.id}?userUid=${encodeURIComponent(user.uid)}`);
      if (!response.ok) {
        throw new Error("לא ניתן לטעון את הכתוביות לייצוא");
      }
      const data = await response.json();
      const segments = parseSubtitleSegments(data.video?.subtitle_json);
      const content = serializeSubtitles(segments, format);
      downloadTextFile(content, subtitleDownloadName(video.original_filename, format));
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "הייצוא נכשל");
    } finally {
      setExportingId(null);
    }
  };

  const firstName = user?.displayName?.split(" ")[0];
  const isWorkspace = variant === "workspace";

  if (!user) {
    return (
      <Card elevation={3}>
        <CardContent>
          <Alert severity="info">יש להתחבר כדי לצפות בהיסטוריית הסרטונים</Alert>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card elevation={3}>
        <CardContent>
          <Stack alignItems="center" spacing={2} py={4}>
            <CircularProgress />
            <Typography>טוען את הפרויקטים שלך...</Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card elevation={3}>
        <CardContent>
          <Alert severity="error">{error}</Alert>
        </CardContent>
      </Card>
    );
  }

  const renderActions = (video: Video) => (
    <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
      {canOpenProject(video) && onEditVideo && (
        <Button
          size="small"
          variant="contained"
          startIcon={<EditRounded />}
          onClick={() => onEditVideo(video.id)}
        >
          המשך עריכה
        </Button>
      )}
      {canExport(video) && (
        <Button
          size="small"
          variant="outlined"
          startIcon={exportingId === video.id ? <CircularProgress size={16} /> : <FileDownloadRounded />}
          disabled={exportingId === video.id}
          onClick={(event) => setExportMenu({ anchor: event.currentTarget, video })}
        >
          ייצוא
        </Button>
      )}
    </Stack>
  );

  return (
    <Card elevation={3}>
      <CardContent>
        <Stack spacing={3}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "stretch", sm: "flex-start" }}
            spacing={2}
          >
            <Stack spacing={0.5}>
              {isWorkspace && (
                <Typography variant="h5" fontWeight={700}>
                  {firstName ? `שלום, ${firstName}` : "הפרויקטים שלך"}
                </Typography>
              )}
              <Stack direction="row" alignItems="center" spacing={1}>
                <VideoLibraryRounded color="primary" fontSize="large" />
                <Typography variant={isWorkspace ? "h6" : "h5"}>
                  {isWorkspace ? "המשך עבודה" : "היסטוריית סרטונים"}
                </Typography>
                <Chip label={`${videos.length} פרויקטים`} color="primary" variant="outlined" />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {isWorkspace
                  ? "כאן אפשר לחזור לפרויקט קיים, לייצא כתוביות או להעלות סרטון חדש."
                  : "כל הסרטונים שעבדת עליהם, כולל תאריך, אורך וייצוא."}
              </Typography>
            </Stack>
            {onNewVideo && (
              <Button variant="contained" startIcon={<UploadFileOutlined />} onClick={onNewVideo} sx={{ alignSelf: { sm: "center" } }}>
                סרטון חדש
              </Button>
            )}
          </Stack>

          {videos.length === 0 ? (
            <Alert severity="info">
              אין עדיין סרטונים בחשבון. העלו סרטון חדש כדי ליצור כתוביות.
            </Alert>
          ) : (
            <>
              <TableContainer sx={{ display: { xs: "none", md: "block" } }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>סוג</TableCell>
                      <TableCell>שם הקובץ</TableCell>
                      <TableCell>סטטוס</TableCell>
                      <TableCell>אורך</TableCell>
                      <TableCell>תאריך</TableCell>
                      <TableCell align="center">פעולות</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {videos.map((video) => (
                      <TableRow key={video.id} hover>
                        <TableCell>
                          {video.media_type === "video" ? (
                            <VideoLibraryRounded color="primary" />
                          ) : (
                            <AudioFileRounded color="secondary" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" noWrap component="bdi" sx={{ display: "block" }}>
                            {video.original_filename}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {getStatusIcon(video.status)}
                            <Typography variant="body2">{getStatusLabel(video.status)}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{formatDuration(video.duration_seconds)}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {formatDate(video.created_at)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">{renderActions(video)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <Stack spacing={2} sx={{ display: { xs: "flex", md: "none" } }}>
                {videos.map((video) => (
                  <Card key={video.id} variant="outlined">
                    <CardContent sx={{ pb: 2 }}>
                      <Stack spacing={2}>
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ maxWidth: "80%" }}>
                            {video.media_type === "video" ? (
                              <VideoLibraryRounded color="primary" />
                            ) : (
                              <AudioFileRounded color="secondary" />
                            )}
                            <Typography variant="subtitle1" fontWeight={600} noWrap component="bdi">
                              {video.original_filename}
                            </Typography>
                          </Stack>
                          {getStatusIcon(video.status)}
                        </Stack>

                        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ color: "text.secondary" }}>
                          <Typography variant="body2">{formatDate(video.created_at)}</Typography>
                          <Typography variant="body2">•</Typography>
                          <Typography variant="body2">{formatDuration(video.duration_seconds)}</Typography>
                          <Typography variant="body2">•</Typography>
                          <Typography variant="body2">{getStatusLabel(video.status)}</Typography>
                        </Stack>

                        {renderActions(video)}
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </>
          )}
        </Stack>
      </CardContent>

      <Menu
        anchorEl={exportMenu?.anchor}
        open={Boolean(exportMenu)}
        onClose={() => setExportMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {SUBTITLE_EXPORT_FORMATS.map((format) => (
          <MenuItem
            key={format.value}
            disabled={!exportMenu}
            onClick={() => exportMenu && handleExport(exportMenu.video, format.value)}
          >
            ייצוא {format.label}
          </MenuItem>
        ))}
      </Menu>

      <Snackbar
        open={Boolean(actionMessage)}
        autoHideDuration={5000}
        onClose={() => setActionMessage(null)}
        message={actionMessage}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Card>
  );
}
