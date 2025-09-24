import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { FormEvent } from "react";
import { io } from "socket.io-client";
import type { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  CssBaseline,
  Divider,
  Fade,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
  createTheme,
} from "@mui/material";
import { CloudUploadRounded } from "@mui/icons-material";
import { UploadForm } from "./components/UploadForm";
import { TranscriptionResult } from "./components/TranscriptionResult";
import type { BurnOptions } from "./components/TranscriptionResult";
import type { ApiResponse, StageEvent, StageState, StageStatus, Segment } from "./types";
import { useAuth } from "./contexts/AuthContext";
import "./App.css";

const DEFAULT_FORMAT = ".srt";
const SUPPORTED_FORMATS = [
  { value: ".srt", label: "SRT (SubRip)" },
  { value: ".vtt", label: "VTT (WebVTT)" },
  { value: ".txt", label: "Text" },
];

const STAGE_DEFINITIONS: StageState[] = [
  { id: "upload", label: "העלאה", status: "idle", message: null },
  { id: "timed-transcription", label: "תמלול מתוזמן", status: "idle", message: null },
  { id: "high-accuracy", label: "שיפור דיוק", status: "idle", message: null },
  { id: "correction", label: "תיקון שפה", status: "idle", message: null },
  { id: "complete", label: "הושלם", status: "idle", message: null },
];

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
const API_BASE_URL = RAW_API_BASE.replace(/\/?$/, "");
const TRANSCRIBE_ENDPOINT = `${API_BASE_URL || ""}/api/transcribe`;
const BURN_ENDPOINT = `${API_BASE_URL || ""}/api/burn-subtitles`;

const theme = createTheme({
  direction: "rtl",
  typography: {
    fontFamily: '"Rubik", "Assistant", "Segoe UI", sans-serif',
  },
  shape: {
    borderRadius: 16,
  },
});

const STEPS = ["העלאת קובץ", "תצוגה מקדימה"];

function mapStageStatus(status: StageStatus | "start" | "done" | "skipped" | "error"): StageStatus {
  switch (status) {
    case "start":
      return "active";
    case "done":
      return "done";
    case "skipped":
      return "skipped";
    case "error":
      return "error";
    default:
      return status as StageStatus;
  }
}

const SOCKET_OPTIONS: Partial<ManagerOptions & SocketOptions> = {
  transports: ["websocket"],
  autoConnect: true,
};

function App() {
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const [profileAnchorEl, setProfileAnchorEl] = useState<HTMLElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<string>(DEFAULT_FORMAT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>("subtitle.srt");
  const [videoId, setVideoId] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [stages, setStages] = useState<StageState[]>(() => STAGE_DEFINITIONS.map((stage) => ({ ...stage })));
  const [activePage, setActivePage] = useState<"upload" | "preview">("upload");
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);

  const requestRef = useRef<XMLHttpRequest | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!file) {
      setMediaPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setMediaPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const socket = API_BASE_URL ? io(API_BASE_URL, SOCKET_OPTIONS) : io(undefined, SOCKET_OPTIONS);
    socketRef.current = socket;

    const handleStageEvent = (event: StageEvent) => {
      setStages((prev) => {
        const stageOrder = STAGE_DEFINITIONS.map((stage) => stage.id);
        const targetIndex = stageOrder.indexOf(event.stage);
        return prev.map((stage, index) => {
          if (stage.id === event.stage) {
            return {
              ...stage,
              status: mapStageStatus(event.status),
              message: event.message ?? stage.message,
            };
          }
          if (event.status === "start" && index < targetIndex && stage.status === "active") {
            return { ...stage, status: "done" };
          }
          return stage;
        });
      });
    };

    socket.on("connect", () => {
      setSocketId(socket.id ?? null);
    });

    socket.on("disconnect", () => {
      setSocketId(null);
    });

    socket.on("transcribe-status", handleStageEvent);

    return () => {
      socket.off("transcribe-status", handleStageEvent);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  useEffect(() => {
    if (!response?.subtitle?.content) {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
      setDownloadUrl(null);
      return;
    }

    const blob = new Blob([response.subtitle.content], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const extension = response.subtitle.format.replace(/^\./, "") || "txt";
    const baseName = file?.name ? file.name.replace(/\.[^.]+$/, "") : "subtitle";
    setDownloadUrl(url);
    setDownloadName(`${baseName}.${extension}`);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [response, file]);

  const subtitleFormatLabel = useMemo(() => {
    const activeFormat = response?.subtitle?.format ?? format;
    return SUPPORTED_FORMATS.find((option) => option.value === activeFormat)?.label ?? activeFormat;
  }, [response, format]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError("לא נבחר קובץ או שהפורמט אינו נתמך.");
      return;
    }

    const formData = new FormData();
    formData.append("media", file);
    formData.append("format", format);
    if (socketId) {
      formData.append("socketId", socketId);
    }
    if (user?.uid) {
      formData.append("userUid", user.uid);
    }

    setIsSubmitting(true);
    setVideoId(null);
    setResponse(null);
    setUploadProgress(0);
    setActivePage("upload");
    setStages(
      STAGE_DEFINITIONS.map((stage) => ({
        ...stage,
        status: stage.id === "upload" ? "active" : "idle",
        message: null,
      })),
    );

    requestRef.current?.abort();

    const xhr = new XMLHttpRequest();
    requestRef.current = xhr;

    xhr.open("POST", TRANSCRIBE_ENDPOINT);
    xhr.responseType = "json";
    xhr.setRequestHeader("Accept", "application/json");

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const percent = Math.round((ev.loaded / ev.total) * 100);
        setUploadProgress(percent);
      }
    };

    const finalize = () => {
      requestRef.current = null;
      setIsSubmitting(false);
      setUploadProgress(null);
    };

    xhr.onerror = () => {
      setError("פעולת ההעלאה נכשלה. נסו שוב.");
      setStages((prev) =>
        prev.map((stage) =>
          stage.id === "complete" ? { ...stage, status: "error", message: "פעולת ההעלאה נכשלה" } : stage,
        ),
      );
      finalize();
    };

    xhr.onabort = () => {
      setError("הבקשה בוטלה.");
      setStages((prev) =>
        prev.map((stage) =>
          stage.id === "complete" ? { ...stage, status: "error", message: "הבקשה בוטלה" } : stage,
        ),
      );
      finalize();
    };

    xhr.onload = () => {
      const payload: ApiResponse = xhr.response ?? (xhr.responseText ? JSON.parse(xhr.responseText) : {});

      if (xhr.status >= 200 && xhr.status < 300) {
        setResponse(payload);
        setVideoId(payload?.videoId ?? null);
        setError(null);
        setActivePage("preview");
      } else {
        setError(payload?.error ?? `אירעה שגיאה (${xhr.status})`);
        setVideoId(null);
        setStages((prev) =>
          prev.map((stage) =>
            stage.id === "complete"
              ? { ...stage, status: "error", message: payload?.error ?? "אירעה שגיאה" }
              : stage,
          ),
        );
      }

      finalize();
    };

    xhr.send(formData);
  };

  const handleSegmentsUpdate = useCallback(
    async (updatedSegments: Segment[], subtitleContent: string) => {
      setResponse((prev) =>
        prev
          ? {
              ...prev,
              segments: updatedSegments,
              subtitle: prev.subtitle
                ? { ...prev.subtitle, content: subtitleContent }
                : prev.subtitle,
              text: updatedSegments.map((segment) => segment.text).join("\n"),
            }
          : prev,
      );

      if (!videoId || !user?.uid) {
        return;
      }

      const response = await fetch(`/api/videos/${videoId}/subtitles`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userUid: user.uid,
          subtitleJson: JSON.stringify(updatedSegments),
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
    },
    [videoId, user?.uid],
  );

  const handleBackToUpload = () => {
    setActivePage("upload");
  };

  const handleBurnVideoRequest = async (options: BurnOptions) => {
    if (!file || !response?.subtitle?.content) {
      throw new Error("לא נמצאו נתונים מתאימים ליצירת וידאו.");
    }

    const formData = new FormData();
    formData.append("media", file);
    formData.append("subtitleContent", response.subtitle.content);
    formData.append("fontSize", String(options.fontSize));
    formData.append("fontColor", options.fontColor);
    formData.append("outlineColor", options.outlineColor);
    formData.append("offsetYPercent", String(options.offsetYPercent));
    formData.append("marginPercent", String(options.marginPercent));

    const burnResponse = await fetch(BURN_ENDPOINT, {
      method: "POST",
      body: formData,
    });

    if (!burnResponse.ok) {
      throw new Error(await readErrorMessage(burnResponse));
    }

    const blob = await burnResponse.blob();
    const filename = parseContentDispositionFilename(burnResponse.headers.get("Content-Disposition"));
    return { blob, filename };
  };

  const handleProfileClick = (event: MouseEvent<HTMLElement>) => {
    setProfileAnchorEl(event.currentTarget);
  };

  const handleProfileClose = () => setProfileAnchorEl(null);

  const handleSignIn = async () => {
    try {
      await signIn();
      setError(null);
    } catch (err) {
      console.error("Sign-in failed", err);
      setError("פעולת ההתחברות נכשלה. נסו שוב.");
    }
  };

  const handleSignOutClick = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error("Sign-out failed", err);
      setError("התנתקות נכשלה. נסו שוב.");
    } finally {
      handleProfileClose();
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <AppBar position="fixed" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Toolbar>
            <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center" }}>
              <Box
                component="img"
                src="/quickcaption-logo.svg"
                alt="QuickCaption"
                sx={{ height: 32 }}
              />
            </Box>
            {user ? (
              <>
                <Tooltip title={user.displayName ?? user.email ?? "משתמש"}>
                  <IconButton onClick={handleProfileClick} size="small" sx={{ ml: 1 }}>
                    <Avatar src={user.photoURL ?? undefined} alt={user.displayName ?? user.email ?? "User"} sx={{ width: 38, height: 38 }} />
                  </IconButton>
                </Tooltip>
                <Menu
                  anchorEl={profileAnchorEl}
                  open={Boolean(profileAnchorEl)}
                  onClose={handleProfileClose}
                  anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
                  transformOrigin={{ horizontal: "right", vertical: "top" }}
                >
                  <MenuItem disabled>{user.displayName ?? user.email ?? "משתמש"}</MenuItem>
                  <MenuItem onClick={handleSignOutClick}>התנתקות</MenuItem>
                </Menu>
              </>
            ) : (
              <Button
                color="primary"
                variant="contained"
                onClick={handleSignIn}
                disabled={authLoading}
                startIcon={authLoading ? <CircularProgress size={18} color="inherit" /> : undefined}
              >
                {authLoading ? "מתחבר..." : "התחברות"}
              </Button>
            )}
          </Toolbar>
        </AppBar>

        <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 }, mt: { xs: 12, md: 10 } }}>
          <Stack spacing={4}>
            <Stack spacing={1} textAlign="center">
              <Typography variant="h4" component="h1">
                QuickCaption
              </Typography>
              <Typography variant="subtitle1" color="text.secondary">
                הפלטפורמה החכמה ליצירת כתוביות מתוזמנות ומוכנות לפרסום.
              </Typography>
            </Stack>

            <Stepper activeStep={activePage === "upload" ? 0 : 1} alternativeLabel>
              {STEPS.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            <Fade in={activePage === "upload"} mountOnEnter unmountOnExit>
              <Card elevation={3}>
                <CardContent>
                  <Stack spacing={3}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <CloudUploadRounded color="primary" />
                      <Typography variant="h5">שלב 1 – העלאת מקור</Typography>
                    </Stack>

                    <Divider />

                    <UploadForm
                      file={file}
                      format={format}
                      isSubmitting={isSubmitting}
                      uploadProgress={uploadProgress}
                      stages={stages}
                      formatOptions={SUPPORTED_FORMATS}
                      onFileChange={setFile}
                      onFormatChange={setFormat}
                      onSubmit={handleSubmit}
                    />

                    {error && activePage === "upload" && <Alert severity="error">{error}</Alert>}
                  </Stack>
                </CardContent>
              </Card>
            </Fade>

            <Fade in={activePage === "preview"} mountOnEnter unmountOnExit>
              <Stack>
                {response && (
                  <TranscriptionResult
                    response={response}
                    subtitleFormatLabel={subtitleFormatLabel}
                    downloadUrl={downloadUrl}
                    downloadName={downloadName}
                    mediaUrl={mediaPreviewUrl}
                    onBack={handleBackToUpload}
                    onBurn={handleBurnVideoRequest}
                    onSaveSegments={handleSegmentsUpdate}
                    videoId={videoId}
                    isEditable={Boolean(videoId && user)}
                  />
                )}
              </Stack>
            </Fade>

            {error && activePage === "preview" && <Alert severity="error">{error}</Alert>}
          </Stack>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default App;

function parseContentDispositionFilename(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const utfMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch (error) {
      console.warn("Failed to decode filename from header:", error);
    }
  }
  const quotedMatch = value.match(/filename="?([^";]+)"?/i);
  return quotedMatch?.[1] ?? undefined;
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const data = await response.json();
      const message = typeof data?.error === "string" ? data.error : undefined;
      if (message) {
        return message;
      }
    } catch (error) {
      console.warn("Failed to parse error JSON:", error);
    }
  }
  const text = (await response.text()).trim();
  if (text) {
    return text;
  }
  return `HTTP ${response.status}`;
}













