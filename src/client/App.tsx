import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io } from "socket.io-client";
import type { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
import {
  Alert,
  Card,
  CardContent,
  Container,
  CssBaseline,
  Divider,
  Fade,
  Stack,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";
import { CloudUploadRounded } from "@mui/icons-material";
import { UploadForm } from "./components/UploadForm";
import { TranscriptionResult } from "./components/TranscriptionResult";
import type { ApiResponse, StageEvent, StageState, StageStatus } from "./types";
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

const theme = createTheme({
  typography: {
    fontFamily: '"Rubik", "Assistant", "Segoe UI", sans-serif',
  },
  shape: {
    borderRadius: 16,
  },
});

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
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<string>(DEFAULT_FORMAT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>("subtitle.srt");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [stages, setStages] = useState<StageState[]>(() =>
    STAGE_DEFINITIONS.map((stage) => ({ ...stage }))
  );

  const requestRef = useRef<XMLHttpRequest | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = API_BASE_URL
      ? io(API_BASE_URL, SOCKET_OPTIONS)
      : io(undefined, SOCKET_OPTIONS);
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
      setError("לא נבחר קובץ או שהפורמט אינו נתמך");
      return;
    }

    const formData = new FormData();
    formData.append("media", file);
    formData.append("format", format);
    if (socketId) {
      formData.append("socketId", socketId);
    }

    setIsSubmitting(true);
    setResponse(null);
    setUploadProgress(0);
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
      const payload: ApiResponse = xhr.response ??
        (xhr.responseText ? JSON.parse(xhr.responseText) : {});

      if (xhr.status >= 200 && xhr.status < 300) {
        setResponse(payload);
        setError(null);
      } else {
        setError(payload?.error ?? `אירעה שגיאה (${xhr.status})`);
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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 }, direction: "rtl" }}>
        <Stack spacing={4}>
          <Stack spacing={1} textAlign="center">
            <Typography variant="h3" component="h1">
              מערכת כתוביות חכמה
            </Typography>
            <Typography variant="subtitle1" color="text.secondary">
              העלו קבצי מדיה, עקבו אחר ההתקדמות וקבלו כתוביות מתוזמנות ותמלול מלא.
            </Typography>
          </Stack>

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

                {error && <Alert severity="error">{error}</Alert>}
              </Stack>
            </CardContent>
          </Card>

          <Fade in={Boolean(response)}>
            <Stack>{response && (
              <TranscriptionResult
                response={response}
                subtitleFormatLabel={subtitleFormatLabel}
                downloadUrl={downloadUrl}
                downloadName={downloadName}
              />
            )}</Stack>
          </Fade>
        </Stack>
      </Container>
    </ThemeProvider>
  );
}

export default App;
