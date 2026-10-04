import { apiFetch, apiHeaders } from "../api";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { io } from "socket.io-client";
import type { ManagerOptions, SocketOptions } from "socket.io-client";
import type { BurnOptions } from "../components/TranscriptionResult";
import type { ApiResponse, StageEvent, StageState, StageStatus, Segment, Word } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useUploadProtection } from "./useUploadProtection";
import { subtitleDownloadName } from "../utils/subtitleExport";
import { reportClientError } from "../errorReporting";
import type { SubtitleLimitMode } from "../components/InitialTranscriptionSettings";
import { normalizeTranscriptionLanguages } from "../../transcriptionSettings.js";

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
  { id: "correction", label: "תיקון ותרגום", status: "idle", message: null },
  { id: "complete", label: "הושלם", status: "idle", message: null },
];

export const STEPS = ["העלאת קובץ", "תצוגה מקדימה"];

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
const API_BASE_URL = RAW_API_BASE.replace(/\/?$/, "");
const TRANSCRIBE_ENDPOINT = `${API_BASE_URL || ""}/api/transcribe`;
const BURN_ENDPOINT = `${API_BASE_URL || ""}/api/burn-subtitles`;
const INITIAL_CHARACTER_LIMIT_KEY = "quickcaption:initial-character-limit";
const INITIAL_SETTINGS_KEY = "quickcaption:initial-transcription-settings";
const jobStorageKey = (uid: string) => `${import.meta.env.BASE_URL === "/" ? "" : import.meta.env.BASE_URL}quickcaption:transcription-job:${uid}`;

function readInitialCharacterLimit() {
  try {
    const saved = Number(localStorage.getItem(INITIAL_CHARACTER_LIMIT_KEY));
    if (Number.isInteger(saved) && saved >= 7 && saved <= 20) return saved;
  } catch { /* Storage may be disabled. */ }
  return 20;
}

function readInitialSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(INITIAL_SETTINGS_KEY) || "{}");
    return {
      mode: (["characters", "words", "none"].includes(saved.mode) ? saved.mode : "characters") as SubtitleLimitMode,
      words: Number.isInteger(saved.words) && saved.words >= 1 && saved.words <= 30 ? saved.words as number : 5,
      languages: normalizeTranscriptionLanguages(saved.languages || []),
    };
  } catch { return { mode: "characters" as SubtitleLimitMode, words: 5, languages: ["he"] }; }
}

function savePendingJob(uid: string, jobId: string) {
  try { localStorage.setItem(jobStorageKey(uid), jobId); } catch { /* Storage may be disabled. */ }
}

function clearPendingJob(uid: string, jobId: string) {
  try {
    if (localStorage.getItem(jobStorageKey(uid)) === jobId) localStorage.removeItem(jobStorageKey(uid));
  } catch { /* Storage may be disabled. */ }
}

const SOCKET_OPTIONS: Partial<ManagerOptions & SocketOptions> = {
  path: `${import.meta.env.BASE_URL}socket.io`,
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
  maxCharactersPerSubtitle: number;
  subtitleLimitMode: SubtitleLimitMode;
  maxWordsPerSubtitle: number;
  languages: string[];
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
  onMaxCharactersChange: (value: number) => void;
  onSubtitleLimitModeChange: (mode: SubtitleLimitMode) => void;
  onMaxWordsChange: (value: number) => void;
  onLanguagesChange: (languages: string[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBackToUpload: () => void;
  onBurnVideoRequest: (options: BurnOptions) => Promise<{ blob: Blob; filename?: string | undefined }>;
  onSaveSegments: (segments: Segment[], subtitleContent: string, words?: Word[]) => Promise<void>;
  onProfileClick: (event: MouseEvent<HTMLElement>) => void;
  onProfileClose: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onLoadVideo: (data: { videoId: number; segments: Segment[]; words?: Word[]; format: string; filename: string; mediaUrl?: string | null }) => void;
};

export function useTranscriptionWorkflow(): TranscriptionWorkflow {
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const [profileAnchorEl, setProfileAnchorEl] = useState<HTMLElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<string>(DEFAULT_FORMAT);
  const [maxCharactersPerSubtitle, setMaxCharactersPerSubtitle] = useState(readInitialCharacterLimit);
  const [initialSettings] = useState(readInitialSettings);
  const [subtitleLimitMode, setSubtitleLimitMode] = useState(initialSettings.mode);
  const [maxWordsPerSubtitle, setMaxWordsPerSubtitle] = useState(initialSettings.words);
  const [languages, setLanguages] = useState(initialSettings.languages);
  useEffect(() => {
    try { localStorage.setItem(INITIAL_SETTINGS_KEY, JSON.stringify({ mode: subtitleLimitMode, words: maxWordsPerSubtitle, languages })); } catch { /* Storage may be disabled. */ }
  }, [subtitleLimitMode, maxWordsPerSubtitle, languages]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [videoId, setVideoId] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [stages, setStages] = useState<StageState[]>(() => cloneStages(STAGE_DEFINITIONS));
  const [activePage, setActivePage] = useState<ActivePage>("upload");
  const [socketId, setSocketId] = useState<string | null>(null);
  const [loadedMediaUrl, setLoadedMediaUrl] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const currentJobRef = useRef<{ uid: string; jobId: string } | null>(null);
  const previousUserRef = useRef(user?.uid);
  const uploadConfirmed = stages.some(stage => stage.id === "upload" && stage.status === "done");
  useUploadProtection(isSubmitting && !uploadConfirmed);

  const releaseCurrentJob = useCallback(() => {
    const job = currentJobRef.current;
    // Invalidate callbacks before aborting: abort itself dispatches an event.
    currentJobRef.current = null;
    if (job) clearPendingJob(job.uid, job.jobId);
    const request = requestRef.current;
    requestRef.current = null;
    request?.abort();
    setActiveJobId(null);
    setIsSubmitting(false);
    setUploadProgress(null);
  }, []);

  const mediaPreviewUrl = useMediaPreview(file);
  const effectiveMediaUrl = loadedMediaUrl || mediaPreviewUrl;
  const { downloadUrl, downloadName } = useSubtitleDownload(response, file);

  const handleMaxCharactersChange = useCallback((value: number) => {
    if (!Number.isInteger(value) || value < 7 || value > 20) return;
    setMaxCharactersPerSubtitle(value);
    try { localStorage.setItem(INITIAL_CHARACTER_LIMIT_KEY, String(value)); } catch { /* Storage may be disabled. */ }
  }, []);

  const handleMaxWordsChange = useCallback((value: number) => {
    if (Number.isInteger(value) && value >= 1 && value <= 30) setMaxWordsPerSubtitle(value);
  }, []);

  useEffect(() => {
    const socketOrigin = API_BASE_URL ? new URL(API_BASE_URL, window.location.origin).origin : undefined;
    const socket = io(socketOrigin, SOCKET_OPTIONS);

    const handleStageEvent = (event: StageEvent) => {
      if (!currentJobRef.current || event.jobId !== currentJobRef.current.jobId) return;
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
      currentJobRef.current = null;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (previousUserRef.current !== user?.uid) {
      currentJobRef.current = null;
      requestRef.current?.abort();
      requestRef.current = null;
      setActiveJobId(null);
      setIsSubmitting(false);
      setUploadProgress(null);
      setResponse(null);
      setVideoId(null);
      setLoadedMediaUrl(null);
      setFile(null);
      setError(null);
      setActivePage("upload");
      setStages(cloneStages(STAGE_DEFINITIONS));
      previousUserRef.current = user?.uid;
    }
    if (!user?.uid) return;
    let savedJobId: string | null = null;
    try { savedJobId = localStorage.getItem(jobStorageKey(user.uid)); } catch { /* Storage may be disabled. */ }
    if (!savedJobId) return;
    currentJobRef.current = { uid: user.uid, jobId: savedJobId };
    setActiveJobId(savedJobId);
    setIsSubmitting(true);
    setUploadProgress(100);
    // A saved job ID may belong to an interrupted upload. Wait for the server
    // before telling the user it is safe to leave or let the screen sleep.
    setStages(createUploadActiveStages());
  }, [user?.uid]);

  useEffect(() => {
    if (!activeJobId || !user?.uid) return;
    const uid = user.uid;
    let cancelled = false;
    let inFlight = false;
    let controller: AbortController | null = null;
    const isCurrentJob = () => !cancelled && currentJobRef.current?.jobId === activeJobId;
    const startedChecking = Date.now();
    const stopWatching = (message?: string) => {
      if (!isCurrentJob()) return;
      releaseCurrentJob();
      if (message) {
        setError(message);
        setStages((prev) => prev.map((stage) =>
          stage.id === "complete" ? { ...stage, status: "error", message } : stage,
        ));
      }
    };
    const poll = async () => {
      if (!isCurrentJob() || inFlight || document.hidden) return;
      if (Date.now() - startedChecking >= 20 * 60 * 1000) {
        stopWatching("לא ניתן לאמת את מצב העיבוד כרגע. בדקו את הווידאו שלי לפני העלאה נוספת.");
        return;
      }
      if (!navigator.onLine) {
        setError("אין חיבור לאינטרנט. נבדוק את העיבוד שוב כשהחיבור יחזור.");
        return;
      }
      inFlight = true;
      controller = new AbortController();
      const requestController = controller;
      const timeout = window.setTimeout(() => requestController.abort(), 10_000);
      try {
        const url = `${TRANSCRIBE_ENDPOINT}/jobs/${activeJobId}?userUid=${encodeURIComponent(uid)}`;
        const res = await apiFetch(url, { cache: "no-store", signal: requestController.signal });
        if (!isCurrentJob()) return;
        if (res.status === 404 && Date.now() - startedChecking < 120_000) return;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) stopWatching("נדרשת התחברות מחדש כדי לבדוק את העיבוד.");
          else if (res.status === 404) stopWatching("העלאת הקובץ לא הושלמה. יש לבחור אותו מחדש.");
          else setError("לא ניתן לבדוק כרגע את העיבוד בשרת. מנסים להתחבר שוב; אפשר גם לחזור לבחירת קובץ.");
          return;
        }
        const job = await res.json() as { status: "processing" | "completed" | "failed"; result?: ApiResponse; error?: string; stages?: StageEvent[] };
        if (!isCurrentJob()) return;
        if (job.status === "completed" && job.result) {
          setResponse(job.result);
          setVideoId(job.result.videoId ?? null);
          if (job.result.videoId) {
            setLoadedMediaUrl(`${API_BASE_URL || ""}/api/videos/${job.result.videoId}/media?mediaToken=${encodeURIComponent(job.result.mediaToken ?? "")}`);
          }
          setActivePage("preview");
          setError(null);
          stopWatching();
        } else if (job.status === "failed") {
          stopWatching(job.error || "העיבוד נכשל. נסו שוב.");
        } else if (job.status === "processing") {
          // Jobs are created only after Multer has received the entire file.
          setUploadProgress(100);
          setStages(previous => (Array.isArray(job.stages) && job.stages.length ? cloneStages(STAGE_DEFINITIONS) : previous).map(stage => {
            if (stage.id === "upload") return { ...stage, status: "done" };
            const event = job.stages?.find(item => item.stage === stage.id);
            return event ? { ...stage, status: mapStageStatus(event.status), message: event.message ?? null } : stage;
          }));
          setError(null);
        }
      } catch {
        if (isCurrentJob()) setError("החיבור לשרת נקטע. מנסים לבדוק שוב את העיבוד; אפשר לחזור לבחירת קובץ בכל שלב.");
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
      }
    };
    const interval = window.setInterval(poll, 2500);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("online", poll);
    window.addEventListener("pageshow", poll);
    void poll();
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("online", poll);
      window.removeEventListener("pageshow", poll);
    };
  }, [activeJobId, user?.uid, releaseCurrentJob]);

  const subtitleFormatLabel = useMemo(() => {
    const activeFormat = response?.subtitle?.format ?? format;
    return SUPPORTED_FORMATS.find((option) => option.value === activeFormat)?.label ?? activeFormat;
  }, [response, format]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (currentJobRef.current) return;
      setError(null);

      if (!file) {
        setError("לא נבחר קובץ או שהפורמט אינו נתמך.");
        return;
      }
      if (!user?.uid) {
        setError("יש להתחבר לפני העלאת סרטון.");
        return;
      }

      const jobId = crypto.randomUUID();
      currentJobRef.current = { uid: user.uid, jobId };
      savePendingJob(user.uid, jobId);
      setLoadedMediaUrl(null);

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
      formData.append("format", DEFAULT_FORMAT);
      formData.append("maxWordsPerSubtitle", subtitleLimitMode === "words" ? String(maxWordsPerSubtitle) : "0");
      if (subtitleLimitMode === "characters") formData.append("maxCharactersPerSubtitle", String(maxCharactersPerSubtitle));
      formData.append("languages", JSON.stringify(languages));
      formData.append("jobId", jobId);

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
      const isCurrentRequest = () => currentJobRef.current?.jobId === jobId && requestRef.current === xhr;

      xhr.open("POST", TRANSCRIBE_ENDPOINT);
      xhr.responseType = "json";
      xhr.timeout = 20 * 60 * 1000;
      xhr.setRequestHeader("Accept", "application/json");

      xhr.upload.onprogress = (ev) => {
        if (!isCurrentRequest()) return;
        if (ev.lengthComputable) {
          const percent = Math.round((ev.loaded / ev.total) * 100);
          setUploadProgress(percent);
        }
      };
      xhr.upload.onload = () => {
        if (!isCurrentRequest()) return;
        setUploadProgress(100);
        setActiveJobId(jobId);
      };

      xhr.onerror = () => {
        if (!isCurrentRequest()) return;
        reportClientError('upload-connection-lost');
        setError("החיבור נותק. בודקים אם העיבוד ממשיך בשרת...");
        setActiveJobId(jobId);
      };

      xhr.onabort = () => {
        if (!isCurrentRequest()) return;
        setActiveJobId(jobId);
      };
      xhr.ontimeout = () => {
        if (!isCurrentRequest()) return;
        reportClientError('upload-timeout');
        setError("זמן ההמתנה הסתיים. בודקים אם העיבוד ממשיך בשרת...");
        setActiveJobId(jobId);
      };

      xhr.onload = () => {
        if (!isCurrentRequest()) return;
        if (xhr.status === 0) {
          setActiveJobId(jobId);
          return;
        }
        let recoverThroughJob = false;
        try {
          const payload: ApiResponse = xhr.response && typeof xhr.response === "object" ? xhr.response : {} as ApiResponse;
          if (!xhr.response || (xhr.status >= 200 && xhr.status < 300 &&
              (!Array.isArray(payload.segments) || typeof payload.subtitle?.content !== 'string'))) {
            recoverThroughJob = true;
            reportClientError('upload-invalid-response', xhr.status);
            setError("התקבלה תשובה לא תקינה. בודקים אם העיבוד ממשיך בשרת; אפשר לחזור לבחירת קובץ.");
            setActiveJobId(jobId);
            return;
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            setResponse(payload);
            setVideoId(payload?.videoId ?? null);
            setError(null);
            setActivePage("preview");
          } else {
            // Handle insufficient credits error (402 Payment Required)
            let errorMessage = payload?.error ?? `אירעה שגיאה (${xhr.status})`;
            if (/incorrect api key|invalid_api_key|authentication.*401/i.test(errorMessage)) {
              errorMessage = "שירות התמלול אינו זמין: מפתח הגישה של השרת נדחה. יש לעדכן את הגדרת השירות ולנסות שוב.";
            }
            if (xhr.status === 402) {
              const { required, available, shortfall, cost } = payload as any;
              if (required && available !== undefined) {
                errorMessage = `אין מספיק קרדיטים! נדרשים ${required} קרדיטים (${cost || ''}), יש לך רק ${available}. חסרים ${shortfall} קרדיטים.`;
              } else {
                errorMessage = `אין מספיק קרדיטים לביצוע הפעולה. ${payload?.error || ''}`;
              }
            }

            setError(errorMessage);
            setVideoId(null);
            setStages((prev) =>
              prev.map((stage) =>
                stage.id === "complete"
                  ? { ...stage, status: "error", message: errorMessage }
                  : stage,
              ),
            );
          }

        } catch {
          reportClientError('upload-invalid-response', xhr.status);
          setError("לא ניתן לקרוא את תשובת השרת. הקובץ נשאר זמין לניסיון נוסף.");
        } finally {
          if (!recoverThroughJob) releaseCurrentJob();
        }
      };

      try {
        const headers = await apiHeaders();
        if (!isCurrentRequest()) return;
        headers.forEach((value, key) => xhr.setRequestHeader(key, value));
        xhr.send(formData);
      } catch {
        if (!isCurrentRequest()) return;
        releaseCurrentJob();
        setError("לא ניתן לאמת את החשבון. התחברו מחדש ונסו שוב.");
      }
    },
    [file, maxCharactersPerSubtitle, maxWordsPerSubtitle, subtitleLimitMode, languages, socketId, user?.uid, releaseCurrentJob],
  );

  const handleSegmentsUpdate = useCallback(
    async (updatedSegments: Segment[], subtitleContent: string, words?: Word[]) => {
      const publishSavedRevision = () => setResponse((prev) =>
        prev
          ? {
              ...prev,
              segments: updatedSegments,
              words: words ?? prev.words,
              subtitle: prev.subtitle ? { ...prev.subtitle, content: subtitleContent } : prev.subtitle,
              text: updatedSegments.map((segment) => segment.text).join("\n"),
            }
          : prev,
      );

      if (!videoId || !user?.uid) {
        publishSavedRevision();
        return;
      }

      const result = await apiFetch(`${API_BASE_URL}/api/videos/${videoId}/subtitles`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userUid: user.uid,
          subtitleJson: JSON.stringify(updatedSegments),
          wordsJson: words ? JSON.stringify(words) : undefined,
        }),
      });

      if (!result.ok) {
        throw new Error(await readErrorMessage(result));
      }
      publishSavedRevision();
    },
    [videoId, user?.uid],
  );

  const handleBackToUpload = useCallback(() => {
    releaseCurrentJob();
    setActivePage("upload");
    setFile(null);
    setLoadedMediaUrl(null);
    setResponse(null);
    setVideoId(null);
    setError(null);
    setUploadProgress(null);
    setStages(cloneStages(STAGE_DEFINITIONS));
  }, [releaseCurrentJob]);

  const handleBurnVideoRequest = useCallback(
    async (options: BurnOptions) => {
      if (!response?.subtitle?.content) {
        throw new Error("לא ניתן לשרוף כתוביות ללא תוצאות תקינות.");
      }

      let media = file;
      if (!media && videoId && user?.uid) {
        const mediaResponse = await apiFetch(`${API_BASE_URL || ""}/api/videos/${videoId}/media?userUid=${encodeURIComponent(user.uid)}`);
        if (!mediaResponse.ok) throw new Error("לא ניתן לטעון את הסרטון השמור לצריבת כתוביות.");
        const blob = await mediaResponse.blob();
        media = new File([blob], response.originalFilename || "video.mp4", { type: blob.type });
      }
      if (!media) throw new Error("קובץ הסרטון אינו זמין לצריבת כתוביות.");

      const formData = new FormData();
      formData.append("media", media);
      formData.append("subtitleContent", options.subtitleContent ?? response.subtitle.content);
      formData.append("textDirection", options.textDirection ?? "rtl");
      formData.append("captionMotion", options.captionMotion ?? "none");
      formData.append("popIntensity", options.popIntensity ?? "gentle");
      formData.append("activeWordColor", options.activeWordColor ?? "#ffd700");
      if (options.activeWordEnabled) formData.append("activeWordEnabled", "true");
      if (options.activeWordEnabled || options.captionMotion === "pop") {
        formData.append("segments", JSON.stringify(options.segments ?? []));
        formData.append("words", JSON.stringify(options.words ?? []));
      }
      formData.append("fontSize", String(options.fontSize));
      if (options.fontId) formData.append("fontId", options.fontId);
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

      const burnResponse = await apiFetch(BURN_ENDPOINT, {
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
    [file, response?.subtitle?.content, response?.originalFilename, videoId, user?.uid],
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

  const handleLoadVideo = useCallback(
    (data: { videoId: number; segments: Segment[]; words?: Word[]; format: string; filename: string; mediaUrl?: string | null }) => {
      setVideoId(data.videoId);
      setFormat(data.format);
      setLoadedMediaUrl(data.mediaUrl || null);

      const subtitleContent = segmentsToSrt(data.segments);
      setResponse({
        text: data.segments.map((s) => s.text).join("\n"),
        segments: data.segments,
        words: data.words,
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
    maxCharactersPerSubtitle,
    subtitleLimitMode,
    maxWordsPerSubtitle,
    languages,
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
    onMaxCharactersChange: handleMaxCharactersChange,
    onSubtitleLimitModeChange: setSubtitleLimitMode,
    onMaxWordsChange: handleMaxWordsChange,
    onLanguagesChange: setLanguages,
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
    setDownloadUrl(url);
    setDownloadName(subtitleDownloadName(file?.name || response.originalFilename || "", response.subtitle.format || ".txt"));

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










