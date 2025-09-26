import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { io } from "socket.io-client";
import type { ManagerOptions, SocketOptions } from "socket.io-client";
import type { BurnOptions } from "../components/TranscriptionResult";
import type { ApiResponse, StageEvent, StageState, StageStatus, Segment } from "../types";
import { useAuth } from "../contexts/AuthContext";

export type AuthUser = ReturnType<typeof useAuth>["user"];

type ActivePage = "upload" | "preview";

export type FormatOption = {
  value: string;
  label: string;
};

export const DEFAULT_FORMAT = ".srt";

export const SUPPORTED_FORMATS: FormatOption[] = [
  { value: ".srt", label: "SRT (SubRip)" },
  { value: ".vtt", label: "VTT (WebVTT)" },
  { value: ".txt", label: "Text" },
];

export const STAGE_DEFINITIONS: StageState[] = [
  { id: "upload", label: "העלאה", status: "idle", message: null },
  { id: "timed-transcription", label: "תמלול מתוזמן", status: "idle", message: null },
  { id: "high-accuracy", label: "שיפור דיוק", status: "idle", message: null },
  { id: "correction", label: "תיקון שפה", status: "idle", message: null },
  { id: "complete", label: "הושלם", status: "idle", message: null },
];

export const STEPS = ["העלאת קובץ", "תצוגה מקדימה"];

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
const API_BASE_URL = RAW_API_BASE.replace(/\/?$/, "");
const TRANSCRIBE_ENDPOINT = `${API_BASE_URL || ""}/api/transcribe`;
const BURN_ENDPOINT = `${API_BASE_URL || ""}/api/burn-subtitles`;

const SOCKET_OPTIONS: Partial<ManagerOptions & SocketOptions> = {
  transports: ["websocket"],
  autoConnect: true,
};

const STAGE_ORDER = STAGE_DEFINITIONS.map((stage) => stage.id);

export type TranscriptionWorkflow = {
  user: AuthUser;
  authLoading: boolean;
  profileAnchorEl: HTMLElement | null;
  file: File | null;
  format: string;
  supportedFormats: FormatOption[];
  isSubmitting: boolean;
  uploadProgress: number | null;
  stages: StageState[];
  activePage: ActivePage;
  error: string | null;
  response: ApiResponse | null;
  subtitleFormatLabel: string;
  downloadUrl: string | null;
  downloadName: string;
  mediaPreviewUrl: string | null;
  videoId: number | null;
  steps: string[];
  onFileChange: (file: File | null) => void;
  onFormatChange: (format: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBackToUpload: () => void;
  onBurnVideoRequest: (options: BurnOptions) => Promise<{ blob: Blob; filename?: string | undefined }>;
  onSaveSegments: (segments: Segment[], subtitleContent: string) => Promise<void>;
  onProfileClick: (event: MouseEvent<HTMLElement>) => void;
  onProfileClose: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onLoadVideo: (data: { videoId: number; segments: Segment[]; format: string; filename: string; mediaUrl?: string | null }) => void;
};

export function useTranscriptionWorkflow(): TranscriptionWorkflow {
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const [profileAnchorEl, setProfileAnchorEl] = useState<HTMLElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<string>(DEFAULT_FORMAT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [videoId, setVideoId] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [stages, setStages] = useState<StageState[]>(() => cloneStages(STAGE_DEFINITIONS));
  const [activePage, setActivePage] = useState<ActivePage>("upload");
  const [socketId, setSocketId] = useState<string | null>(null);
  const [loadedMediaUrl, setLoadedMediaUrl] = useState<string | null>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);

  const mediaPreviewUrl = useMediaPreview(file);
  const effectiveMediaUrl = loadedMediaUrl || mediaPreviewUrl;
  const { downloadUrl, downloadName } = useSubtitleDownload(response, file);

  useEffect(() => {
    const socket = API_BASE_URL ? io(API_BASE_URL, SOCKET_OPTIONS) : io(undefined, SOCKET_OPTIONS);

    const handleStageEvent = (event: StageEvent) => {
      const targetIndex = STAGE_ORDER.indexOf(event.stage);
      setStages((prev) =>
        prev.map((stage, index) => {
          if (stage.id === event.stage) {
            return {
              ...stage,
              status: mapStageStatus(event.status),
              message: event.message ?? stage.message,
            };
          }

          if (
            event.status === "start" &&
            targetIndex !== -1 &&
            index < targetIndex &&
            stage.status === "active"
          ) {
            return { ...stage, status: "done" };
          }

          return stage;
        }),
      );
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
    };
  }, []);

  const subtitleFormatLabel = useMemo(() => {
    const activeFormat = response?.subtitle?.format ?? format;
    return SUPPORTED_FORMATS.find((option) => option.value === activeFormat)?.label ?? activeFormat;
  }, [response, format]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (!file) {
        setError("לא נבחר קובץ או שהפורמט אינו נתמך.");
        return;
      }

      // Log file details for debugging
      console.log('Uploading file:', {
        name: file.name,
        size: file.size,
        type: file.type,
        nameBytes: Array.from(file.name).map(c => c.charCodeAt(0)),
        nameUTF8: encodeURIComponent(file.name)
      });

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
      setStages(createUploadActiveStages());

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
                ? { ...stage, status: "error", message: payload?.error ?? "הבקשה בוטלה" }
                : stage,
            ),
          );
        }

        finalize();
      };

      xhr.send(formData);
    },
    [file, format, socketId, user?.uid],
  );

  const handleSegmentsUpdate = useCallback(
    async (updatedSegments: Segment[], subtitleContent: string) => {
      setResponse((prev) =>
        prev
          ? {
              ...prev,
              segments: updatedSegments,
              subtitle: prev.subtitle ? { ...prev.subtitle, content: subtitleContent } : prev.subtitle,
              text: updatedSegments.map((segment) => segment.text).join("\n"),
            }
          : prev,
      );

      if (!videoId || !user?.uid) {
        return;
      }

      const result = await fetch(`/api/videos/${videoId}/subtitles`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userUid: user.uid,
          subtitleJson: JSON.stringify(updatedSegments),
        }),
      });

      if (!result.ok) {
        throw new Error(await readErrorMessage(result));
      }
    },
    [videoId, user?.uid],
  );

  const handleBackToUpload = useCallback(() => {
    setActivePage("upload");
  }, []);

  const handleBurnVideoRequest = useCallback(
    async (options: BurnOptions) => {
      if (!file || !response?.subtitle?.content) {
        throw new Error("לא ניתן לשרוף כתוביות ללא תוצאות תקינות.");
      }

      const formData = new FormData();
      formData.append("media", file);
      formData.append("subtitleContent", response.subtitle.content);
      formData.append("fontSize", String(options.fontSize));
      formData.append("fontColor", options.fontColor);
      formData.append("outlineColor", options.outlineColor);
      formData.append("offsetYPercent", String(options.offsetYPercent));
      formData.append("marginPercent", String(options.marginPercent));
      if (typeof options.videoWidth === "number" && options.videoWidth > 0) {
        formData.append("videoWidth", String(Math.round(options.videoWidth)));
      }
      if (typeof options.videoHeight === "number" && options.videoHeight > 0) {
        formData.append("videoHeight", String(Math.round(options.videoHeight)));
      }

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
    },
    [file, response?.subtitle?.content],
  );

  const handleProfileClick = useCallback((event: MouseEvent<HTMLElement>) => {
    setProfileAnchorEl(event.currentTarget);
  }, []);

  const handleProfileClose = useCallback(() => {
    setProfileAnchorEl(null);
  }, []);

  const handleSignIn = useCallback(async () => {
    try {
      await signIn();
      setError(null);
    } catch (err) {
      console.error("Sign-in failed", err);
      setError("פעולת ההתחברות נכשלה. נסו שוב.");
    }
  }, [signIn]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } catch (err) {
      console.error("Sign-out failed", err);
      setError("התנתקות נכשלה. נסו שוב.");
    } finally {
      handleProfileClose();
    }
  }, [signOut, handleProfileClose]);

  const handleFileChange = useCallback((nextFile: File | null) => {
    setFile(nextFile);
  }, []);

  const handleFormatChange = useCallback((nextFormat: string) => {
    setFormat(nextFormat);
  }, []);

  const handleLoadVideo = useCallback(
    (data: { videoId: number; segments: Segment[]; format: string; filename: string; mediaUrl?: string | null }) => {
      setVideoId(data.videoId);
      setFormat(data.format);
      setLoadedMediaUrl(data.mediaUrl || null);

      const subtitleContent = segmentsToSrt(data.segments);
      setResponse({
        text: data.segments.map((s) => s.text).join("\n"),
        segments: data.segments,
        subtitle: {
          format: data.format,
          content: subtitleContent,
        },
        videoId: data.videoId,
      });

      setActivePage("preview");
      setError(null);
    },
    [],
  );

  return {
    user,
    authLoading,
    profileAnchorEl,
    file,
    format,
    supportedFormats: SUPPORTED_FORMATS,
    isSubmitting,
    uploadProgress,
    stages,
    activePage,
    error,
    response,
    subtitleFormatLabel,
    downloadUrl,
    downloadName,
    mediaPreviewUrl: effectiveMediaUrl,
    videoId,
    steps: STEPS,
    onFileChange: handleFileChange,
    onFormatChange: handleFormatChange,
    onSubmit: handleSubmit,
    onBackToUpload: handleBackToUpload,
    onBurnVideoRequest: handleBurnVideoRequest,
    onSaveSegments: handleSegmentsUpdate,
    onProfileClick: handleProfileClick,
    onProfileClose: handleProfileClose,
    onSignIn: handleSignIn,
    onSignOut: handleSignOut,
    onLoadVideo: handleLoadVideo,
  };
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

function useMediaPreview(file: File | null) {
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);

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

  return mediaPreviewUrl;
}

function useSubtitleDownload(response: ApiResponse | null, file: File | null) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>("subtitle.srt");

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

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  return { downloadUrl, downloadName };
}

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

function cloneStages(stages: StageState[]): StageState[] {
  return stages.map((stage) => ({ ...stage }));
}

function createUploadActiveStages(): StageState[] {
  return STAGE_DEFINITIONS.map((stage) => ({
    ...stage,
    status: stage.id === "upload" ? ("active" as StageStatus) : ("idle" as StageStatus),
    message: null,
  }));
}

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










