import { useEffect, useState } from "react";
import {
  Alert,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  VideoLibraryRounded,
  AudioFileRounded,
  CheckCircleRounded,
  ErrorRounded,
  PendingRounded,
  EditRounded,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";

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
};

type VideosPageProps = {
  onEditVideo?: (videoId: number) => void;
};

export function VideosPage({ onEditVideo }: VideosPageProps) {
  const { user } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setVideos(data.videos || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "אירעה שגיאה בטעינת הווידאו");
      } finally {
        setLoading(false);
      }
    };

    fetchVideos();
  }, [user?.uid]);

  const getStatusIcon = (status: Video["status"]) => {
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
  };

  const getStatusLabel = (status: Video["status"]) => {
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
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "—";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("he-IL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!user) {
    return (
      <Card elevation={3}>
        <CardContent>
          <Alert severity="info">יש להתחבר כדי לצפות בווידאו שלך</Alert>
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
            <Typography>טוען את הווידאו שלך...</Typography>
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

  if (videos.length === 0) {
    return (
      <Card elevation={3}>
        <CardContent>
          <Alert severity="info">עדיין לא העלית ווידאו. התחל על ידי העלאת קובץ מדיה!</Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card elevation={3}>
      <CardContent>
        <Stack spacing={3}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <VideoLibraryRounded color="primary" fontSize="large" />
            <Typography variant="h5">הווידאו שלי</Typography>
            <Chip label={`${videos.length} קבצים`} color="primary" variant="outlined" />
          </Stack>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>סוג</TableCell>
                  <TableCell>שם הקובץ</TableCell>
                  <TableCell>סטטוס</TableCell>
                  <TableCell>פורמט</TableCell>
                  <TableCell>גודל</TableCell>
                  <TableCell>תאריך יצירה</TableCell>
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
                      <Typography variant="body2" noWrap>
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
                      {video.format ? (
                        <Chip label={video.format} size="small" variant="outlined" />
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{formatFileSize(video.size_bytes)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatDate(video.created_at)}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      {video.status === "completed" && onEditVideo && (
                        <Tooltip title="עריכת כתוביות">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => onEditVideo(video.id)}
                          >
                            <EditRounded />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      </CardContent>
    </Card>
  );
}