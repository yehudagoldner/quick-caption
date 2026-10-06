import { apiFetch } from "../api";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  CheckCircleRounded,
  CloseRounded,
  EditRounded,
  ErrorRounded,
  FileDownloadRounded,
  GraphicEqRounded,
  HourglassTopRounded,
  MovieRounded,
  ScheduleRounded,
  SearchRounded,
  UploadFileOutlined,
  VideoLibraryRounded,
} from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { useDownloadExperience } from "../hooks/useDownloadExperience";
import { formatDuration } from "../utils/formatTime";
import {
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
  thumbnail_url?: string | null;
};

type VideosPageProps = {
  onEditVideo?: (videoId: number) => void;
  onNewVideo?: () => void;
};

type Filter = "all" | "ready" | "working" | "failed";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "הכול" },
  { id: "ready", label: "מוכנים" },
  { id: "working", label: "בעבודה" },
  { id: "failed", label: "נכשלו" },
];

const COVERS = [
  ["#2563eb", "#7c3aed"],
  ["#7c3aed", "#db2777"],
  ["#0891b2", "#2563eb"],
  ["#059669", "#0d9488"],
  ["#ea580c", "#db2777"],
  ["#4f46e5", "#0ea5e9"],
  ["#9333ea", "#4f46e5"],
  ["#e11d48", "#f59e0b"],
];

function normalizeVideo(video: Video & { has_subtitles?: number | boolean }): Video {
  return {
    ...video,
    duration_seconds: video.duration_seconds == null ? null : Number(video.duration_seconds),
    has_subtitles: video.has_subtitles == null ? video.status === "completed" : Boolean(Number(video.has_subtitles)),
  };
}

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

function formatRelativeDate(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
  const time = hasTime ? `, ${date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}` : "";
  if (days <= 0) return `היום${time}`;
  if (days === 1) return `אתמול${time}`;
  if (days < 7) return `לפני ${days} ימים`;
  return date.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function formatSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return null;
  const megabytes = bytes / 1024 / 1024;
  return megabytes >= 1 ? `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

const EXTENSION = /\.([a-z0-9]{2,4})$/i;

function fileExtension(video: Video) {
  return (EXTENSION.exec(video.original_filename)?.[1] ?? video.format?.replace(".", "") ?? "").toUpperCase();
}

function displayName(video: Video) {
  return video.original_filename.replace(EXTENSION, "") || video.original_filename;
}

function coverFor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [from, to] = COVERS[hash % COVERS.length];
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
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

function matchesFilter(video: Video, filter: Filter) {
  switch (filter) {
    case "ready":
      return canOpenProject(video);
    case "working":
      return video.status === "uploaded" || video.status === "processing";
    case "failed":
      return video.status === "failed";
    default:
      return true;
  }
}

function StatusBadge({ video }: { video: Video }) {
  const ready = canOpenProject(video);
  const tone = video.status === "failed"
    ? { color: "#b91c1c", background: "#fef2f2", icon: <ErrorRounded /> }
    : ready
      ? { color: "#15803d", background: "#f0fdf4", icon: <CheckCircleRounded /> }
      : { color: "#b45309", background: "#fffbeb", icon: <HourglassTopRounded /> };
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1, py: 0.25, borderRadius: 99, fontSize: 12.5, fontWeight: 600, color: tone.color, bgcolor: tone.background, "& svg": { fontSize: 15 } }}>
      {tone.icon}
      {ready ? "מוכן לעריכה" : getStatusLabel(video.status)}
    </Box>
  );
}

function Cover({ video, onOpen }: { video: Video; onOpen?: () => void }) {
  const working = video.status === "uploaded" || video.status === "processing";
  const thumbnail = video.media_type !== 'audio' && video.thumbnail_url ? `${API_BASE_URL}${video.thumbnail_url}` : null;
  const [loadedThumbnail, setLoadedThumbnail] = useState<string | null>(null);
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
  const imageLoaded = Boolean(thumbnail && loadedThumbnail === thumbnail && failedThumbnail !== thumbnail);
  const content = (
    <>
      {thumbnail && failedThumbnail !== thumbnail && <Box component="img" src={thumbnail}
        alt={`תמונה מקדימה של ${displayName(video)}`} loading="lazy" decoding="async" referrerPolicy="no-referrer"
        onLoad={() => setLoadedThumbnail(thumbnail)} onError={() => setFailedThumbnail(thumbnail)}
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: imageLoaded ? 1 : 0 }} />}
      {!imageLoaded && <>
      <Box sx={{ position: "absolute", inset: 0, opacity: 0.22, backgroundImage: "radial-gradient(circle at 20% 20%, #fff 0, transparent 45%), repeating-linear-gradient(90deg, #ffffff22 0 2px, transparent 2px 14px)" }} />
      <Box sx={{ position: "relative", display: "grid", placeItems: "center", width: { xs: 34, md: 56 }, height: { xs: 34, md: 56 }, borderRadius: "50%", bgcolor: "#ffffff2e", backdropFilter: "blur(4px)", "& svg": { fontSize: { xs: 20, md: 30 } } }}>
        {video.media_type === "audio" ? <GraphicEqRounded /> : <MovieRounded />}
      </Box>
      </>}
      {video.duration_seconds != null && (
        <Box component="span" dir="ltr" sx={{ position: "absolute", bottom: { xs: 4, md: 8 }, insetInlineStart: { xs: 4, md: 8 }, px: 0.75, py: 0.125, borderRadius: "6px", fontSize: { xs: 10.5, md: 12 }, fontWeight: 600, bgcolor: "#000000a6", fontVariantNumeric: "tabular-nums" }}>
          {formatDuration(video.duration_seconds)}
        </Box>
      )}
      {working && <LinearProgress sx={{ position: "absolute", insetInline: 0, bottom: 0, height: 3, bgcolor: "#ffffff40", "& .MuiLinearProgress-bar": { bgcolor: "#fff" } }} />}
    </>
  );
  const sx = {
    position: "relative",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    width: "100%",
    aspectRatio: { xs: "16 / 11", md: "16 / 9" },
    borderRadius: { xs: "12px", md: "14px" },
    color: "#fff",
    background: coverFor(video.original_filename),
    filter: video.status === "failed" ? "grayscale(.85)" : undefined,
  } as const;
  return onOpen
    ? <ButtonBase onClick={onOpen} aria-label={`פתיחת ${video.original_filename}`} sx={{ ...sx, "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 } }}>{content}</ButtonBase>
    : <Box sx={sx}>{content}</Box>;
}

function ProjectSkeleton() {
  return (
    <Box component="li" sx={{ listStyle: "none", display: "grid", gridTemplateColumns: { xs: "104px 1fr", md: "1fr" }, gap: 1.5, p: { xs: 1.25, md: 1.5 }, borderRadius: { xs: "18px", md: "20px" }, border: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      <Skeleton variant="rounded" sx={{ width: "100%", height: "auto", aspectRatio: { xs: "16 / 11", md: "16 / 9" }, borderRadius: { xs: "12px", md: "14px" } }} />
      <Box>
        <Skeleton width="75%" height={26} />
        <Skeleton width="45%" />
        <Skeleton variant="rounded" height={32} sx={{ mt: 1.5, borderRadius: "10px" }} />
      </Box>
    </Box>
  );
}

export function VideosPage({ onEditVideo, onNewVideo }: VideosPageProps) {
  const { user } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const paginationRequest = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [exportMenu, setExportMenu] = useState<{ anchor: HTMLElement; video: Video } | null>(null);
  const [exportVideoId, setExportVideoId] = useState<number | null>(null);
  const downloads = useDownloadExperience(exportVideoId);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    paginationRequest.current?.abort();
    setLoadingMore(false);
    setVideos([]);
    setHasMore(false);
    let cancelled = false;
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    const fetchVideos = async () => {
      try {
        setLoading(true);
        setError(null);
        const url = `${API_BASE_URL || ""}/api/videos?userUid=${encodeURIComponent(user.uid)}`;
        const response = await apiFetch(url);
        if (!response.ok) {
          throw new Error("Failed to fetch videos");
        }
        const data = await response.json();
        if (cancelled) return;
        setHasMore(Boolean(data.hasMore));
        setVideos((data.videos || []).map(normalizeVideo));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "אירעה שגיאה בטעינת הווידאו");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchVideos();
    return () => { cancelled = true; paginationRequest.current?.abort(); };
  }, [user?.uid, reloadKey]);

  const loadMore = async () => {
    if (!user || loadingMore) return;
    const controller = new AbortController();
    paginationRequest.current = controller;
    setLoadingMore(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/videos?offset=${videos.length}&limit=50`, { signal: controller.signal });
      if (!response.ok) throw new Error("טעינת פרויקטים נוספים נכשלה. נסו שוב.");
      const data = await response.json();
      if (controller.signal.aborted) return;
      setVideos(previous => [...previous, ...(data.videos ?? []).map(normalizeVideo)]);
      setHasMore(Boolean(data.hasMore));
    } catch (error) { if (!controller.signal.aborted) setActionMessage((error as Error).message); }
    finally { if (!controller.signal.aborted) setLoadingMore(false); }
  };

  const handleExport = async (video: Video, format: string) => {
    if (!user?.uid) return;
    setExportMenu(null);
    setExportingId(video.id);
    setActionMessage(null);

    try {
      const response = await apiFetch(`${API_BASE_URL || ""}/api/videos/${video.id}?userUid=${encodeURIComponent(user.uid)}`);
      if (!response.ok) {
        throw new Error("לא ניתן לטעון את הכתוביות לייצוא");
      }
      const data = await response.json();
      const segments = parseSubtitleSegments(data.video?.subtitle_json);
      const content = serializeSubtitles(segments, format);
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
      try { await downloads.actions.downloadSubtitles({ url, name: subtitleDownloadName(video.original_filename, format) }); }
      finally { URL.revokeObjectURL(url); }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "הייצוא נכשל");
    } finally {
      setExportingId(null);
    }
  };

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(({ id }) => [id, videos.filter(video => matchesFilter(video, id)).length])) as Record<Filter, number>, [videos]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("he");
    return videos.filter(video => matchesFilter(video, filter) && (!needle || video.original_filename.toLocaleLowerCase("he").includes(needle)));
  }, [videos, filter, query]);
  const filtered = filter !== "all" || query.trim() !== "";
  const firstName = user?.displayName?.split(" ")[0];

  if (!user) {
    return (
      <Card elevation={3}>
        <CardContent>
          <Alert severity="info">יש להתחבר כדי לצפות בהיסטוריית הסרטונים</Alert>
        </CardContent>
      </Card>
    );
  }

  const newVideoButton = onNewVideo && (
    <Button variant="contained" size="large" startIcon={<UploadFileOutlined />} onClick={onNewVideo}
      sx={{ flexShrink: 0, px: { xs: 2, md: 3 }, py: { xs: 1, md: 1.25 }, fontWeight: 700, borderRadius: "12px", boxShadow: "0 10px 24px -12px rgba(25,118,210,.7)" }}>
      סרטון חדש
    </Button>
  );

  const renderProject = (video: Video) => {
    const open = canOpenProject(video) && onEditVideo ? () => onEditVideo(video.id) : undefined;
    const details = [fileExtension(video), formatSize(video.size_bytes)].filter(Boolean);
    return (
      <Box component="li" key={video.id} sx={{
        listStyle: "none",
        display: "grid",
        gridTemplateColumns: { xs: "104px minmax(0, 1fr)", md: "1fr" },
        gridTemplateRows: { md: "auto 1fr" },
        columnGap: 1.5,
        rowGap: { xs: 1.25, md: 1.5 },
        p: { xs: 1.25, md: 1.5 },
        borderRadius: { xs: "18px", md: "20px" },
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        transition: "box-shadow .2s, transform .2s, border-color .2s",
        "@media (hover: hover)": { "&:hover": { borderColor: "transparent", boxShadow: "0 18px 40px -22px rgba(30,41,99,.45)", transform: "translateY(-2px)" } },
      }}>
        <Cover video={video} onOpen={open} />
        <Stack useFlexGap spacing={0.75} sx={{ minWidth: 0 }}>
          <Typography component="h3" title={video.original_filename} sx={{ fontWeight: 600, fontSize: { xs: 15, md: 16 }, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: { xs: 1, md: 2 }, WebkitBoxOrient: "vertical", wordBreak: "break-word" }}>
            <bdi>{displayName(video)}</bdi>
          </Typography>
          <Stack direction="row" alignItems="center" useFlexGap spacing={0.75} sx={{ color: "text.secondary", fontSize: 13, whiteSpace: "nowrap" }} title={formatDate(video.created_at)}>
            <ScheduleRounded sx={{ fontSize: 15 }} />
            <span>{formatRelativeDate(video.created_at)}</span>
            {details.map(detail => <span key={detail}><span aria-hidden="true">· </span>{detail}</span>)}
          </Stack>
          <Box><StatusBadge video={video} /></Box>
        </Stack>
        <Stack direction="row" useFlexGap spacing={1} sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, alignSelf: "end" }}>
          {open ? (
            <Button size="small" variant="contained" disableElevation startIcon={<EditRounded />} onClick={open} sx={{ flex: 1, borderRadius: "10px", fontWeight: 600 }}>
              המשך עריכה
            </Button>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1, alignSelf: "center", fontSize: 13 }}>
              {video.status === "failed" ? "העיבוד לא הושלם. אפשר להעלות את הקובץ שוב." : "הכתוביות בדרך. הפרויקט ייפתח כשהעיבוד יסתיים."}
            </Typography>
          )}
          {canExport(video) && (
            <Button
              size="small"
              variant="outlined"
              startIcon={exportingId === video.id ? <CircularProgress size={16} /> : <FileDownloadRounded />}
              disabled={exportingId === video.id}
              onClick={(event) => { setExportVideoId(video.id); setExportMenu({ anchor: event.currentTarget, video }); }}
              sx={{ borderRadius: "10px", fontWeight: 600 }}
            >
              ייצוא
            </Button>
          )}
        </Stack>
      </Box>
    );
  };

  const gridSx = {
    m: 0,
    p: 0,
    display: "grid",
    gap: { xs: 1.25, md: 2.5 },
    gridTemplateColumns: { xs: "1fr", md: "repeat(auto-fill, minmax(250px, 1fr))" },
  } as const;

  return (
    <Box dir="rtl" sx={{
      maxWidth: 1240,
      mx: "auto",
      "& .MuiButton-startIcon": { marginLeft: 0, marginRight: 0, marginInlineStart: "-4px", marginInlineEnd: "8px" },
      "& .MuiInputAdornment-positionStart": { marginRight: 0, marginInlineEnd: "8px" },
      "& .MuiInputAdornment-positionEnd": { marginLeft: 0, marginInlineStart: "8px" },
      "& .MuiInputBase-adornedStart": { paddingLeft: 0, paddingInlineStart: "14px" },
      "& .MuiInputBase-adornedEnd": { paddingRight: 0, paddingInlineEnd: "8px" },
      "& .MuiAlert-icon": { marginRight: 0, marginInlineEnd: "12px" },
      "& .MuiAlert-action": { marginLeft: 0, marginRight: 0, paddingLeft: 0, marginInlineStart: "auto", marginInlineEnd: "-8px", paddingInlineStart: "16px" },
    }}>
      <Stack direction="row" justifyContent="space-between" alignItems={{ xs: "center", sm: "flex-end" }} useFlexGap spacing={2} sx={{ mb: { xs: 2, md: 3 } }}>
        <Box sx={{ minWidth: 0 }}>
          {firstName && <Typography variant="body2" color="text.secondary" sx={{ mb: 0.25, display: { xs: "none", sm: "block" } }}>שלום, {firstName}</Typography>}
          <Typography component="h1" sx={{ fontSize: { xs: 24, md: 34 }, fontWeight: 800, lineHeight: 1.15, letterSpacing: "-.01em" }}>הסרטונים שלי</Typography>
          <Stack direction="row" alignItems="center" useFlexGap spacing={1} sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
            {!loading && !error && <Chip size="small" color="primary" variant="outlined" label={`${videos.length}${hasMore ? "+" : ""} פרויקטים`} sx={{ fontWeight: 600 }} />}
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
              פרויקטים נשמרים 30 יום מהפתיחה או העריכה האחרונה.
            </Typography>
          </Stack>
        </Box>
        {newVideoButton}
      </Stack>

      {loading ? (
        <>
          <Typography role="status" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>טוען את הפרויקטים שלך...</Typography>
          <Box component="ul" aria-hidden="true" sx={gridSx}>{Array.from({ length: 6 }, (_, index) => <ProjectSkeleton key={index} />)}</Box>
        </>
      ) : error ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setReloadKey(key => key + 1)}>נסו שוב</Button>}>
          טעינת הפרויקטים נכשלה. בדקו את החיבור ונסו שוב.
        </Alert>
      ) : videos.length === 0 ? (
        <Box sx={{ textAlign: "center", px: 3, py: { xs: 6, md: 9 }, borderRadius: "24px", border: "2px dashed", borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "inline-grid", placeItems: "center", width: 72, height: 72, borderRadius: "50%", mb: 2, color: "primary.main", bgcolor: "rgba(25,118,210,.08)" }}>
            <VideoLibraryRounded sx={{ fontSize: 36 }} />
          </Box>
          <Typography component="h2" sx={{ fontSize: 22, fontWeight: 700 }}>עוד אין כאן סרטונים</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 3, maxWidth: 420, mx: "auto" }}>
            העלו סרטון או קובץ אודיו, ותקבלו כתוביות מתוזמנות שאפשר לערוך, לעצב ולהוריד.
          </Typography>
          {onNewVideo && <Button variant="outlined" size="large" startIcon={<UploadFileOutlined />} onClick={onNewVideo} sx={{ borderRadius: "12px", fontWeight: 700 }}>העלו סרטון ראשון</Button>}
        </Box>
      ) : (
        <>
          <Stack direction={{ xs: "column", md: "row" }} useFlexGap spacing={{ xs: 1.25, md: 2 }} alignItems={{ md: "center" }} sx={{ mb: { xs: 1.5, md: 2.5 } }}>
            <TextField
              size="small"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="חיפוש לפי שם קובץ"
              slotProps={{
                htmlInput: { "aria-label": "חיפוש סרטונים" },
                input: {
                  startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment>,
                  endAdornment: query && <InputAdornment position="end"><Button size="small" onClick={() => setQuery("")} aria-label="ניקוי החיפוש" sx={{ minWidth: 0, p: 0.5 }}><CloseRounded fontSize="small" /></Button></InputAdornment>,
                },
              }}
              sx={{ width: { xs: "100%", md: 320 }, "& .MuiOutlinedInput-root": { borderRadius: "12px", bgcolor: "background.paper" } }}
            />
            <Stack direction="row" useFlexGap spacing={1} role="group" aria-label="סינון לפי מצב" sx={{ overflowX: "auto", pb: { xs: 0.25, md: 0 }, mx: { xs: -1.5, md: 0 }, px: { xs: 1.5, md: 0 }, scrollbarWidth: "none" }}>
              {FILTERS.filter(({ id }) => id === "all" || counts[id] > 0).map(({ id, label }) => (
                <Chip key={id} clickable onClick={() => setFilter(id)} aria-pressed={filter === id}
                  color={filter === id ? "primary" : "default"} variant={filter === id ? "filled" : "outlined"}
                  label={<>{label} <Box component="span" sx={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>{counts[id]}</Box></>}
                  sx={{ fontWeight: 600, flexShrink: 0, bgcolor: filter === id ? undefined : "background.paper" }} />
              ))}
            </Stack>
          </Stack>

          {visible.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
              <Typography sx={{ fontWeight: 600, color: "text.primary" }}>לא נמצאו סרטונים שתואמים לחיפוש</Typography>
              <Button sx={{ mt: 1 }} onClick={() => { setQuery(""); setFilter("all"); }}>ניקוי הסינון</Button>
            </Box>
          ) : (
            <Box component="ul" aria-label="רשימת הסרטונים" sx={gridSx}>{visible.map(renderProject)}</Box>
          )}

          {filtered && hasMore && <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: "center" }}>החיפוש כולל רק את הפרויקטים שנטענו.</Typography>}
          {hasMore && (
            <Stack alignItems="center" sx={{ mt: 3 }}>
              <Button variant="outlined" onClick={loadMore} disabled={loadingMore} startIcon={loadingMore ? <CircularProgress size={16} /> : undefined} sx={{ borderRadius: "12px", px: 3, fontWeight: 600 }}>
                {loadingMore ? "טוען..." : "טען פרויקטים נוספים"}
              </Button>
            </Stack>
          )}
        </>
      )}

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
        open={Boolean(actionMessage || downloads.error)}
        autoHideDuration={5000}
        onClose={() => { setActionMessage(null); downloads.clearError(); }}
        message={actionMessage || downloads.error}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
