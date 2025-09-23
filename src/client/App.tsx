import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ManagerOptions, SocketOptions } from "socket.io-client";
import "./App.css";

type Segment = {
  id: number | string;
  start: number;
  end: number;
  text: string;
};

type SubtitlePayload = {
  format: string;
  content: string;
};

type ApiResponse = {
  text: string;
  segments: Segment[];
  subtitle: SubtitlePayload;
  warnings?: string[];
  error?: string;
};

type StageId = "upload" | "timed-transcription" | "high-accuracy" | "correction" | "complete";
type StageStatus = "idle" | "active" | "done" | "skipped" | "error";

type StageState = {
  id: StageId;
  label: string;
  status: StageStatus;
  message: string | null;
};

type StageEvent = {
  stage: StageId;
  status: "start" | "done" | "skipped" | "error";
  message?: string;
};

const DEFAULT_FORMAT = ".srt";
const SUPPORTED_FORMATS = [
  { value: ".srt", label: "SRT (SubRip)" },
  { value: ".vtt", label: "VTT (WebVTT)" },
  { value: ".txt", label: "Text" },
];

const STAGE_DEFINITIONS: StageState[] = [
  { id: "upload", label: "העלאה", status: "idle", message: null },
  { id: "timed-transcription", label: "תמלול ראשוני", status: "idle", message: null },
  { id: "high-accuracy", label: "שיפור תמלול", status: "idle", message: null },
  { id: "correction", label: "תיקון טקסט", status: "idle", message: null },
  { id: "complete", label: "סיום", status: "idle", message: null },
];

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
const API_BASE_URL = RAW_API_BASE.replace(/\/?$/, "");
const TRANSCRIBE_ENDPOINT = `${API_BASE_URL || ""}/api/transcribe`;

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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError("בחר/י קובץ וידאו או אודיו לפני השליחה");
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
      setError("שגיאת רשת. נסה/י שוב.");
      setStages((prev) =>
        prev.map((stage) =>
          stage.id === "complete" ? { ...stage, status: "error", message: "שגיאת רשת" } : stage,
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
        setError(payload?.error ?? `שגיאת שרת (${xhr.status})`);
        setStages((prev) =>
          prev.map((stage) =>
            stage.id === "complete"
              ? { ...stage, status: "error", message: payload?.error ?? "שגיאת שרת" }
              : stage,
          ),
        );
      }

      finalize();
    };

    xhr.send(formData);
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1>הפקת כתוביות באמצעות OpenAI</h1>
        <p>העלו קובץ וידאו או אודיו וקבלו תמלול עם תזמונים מדויקים.</p>
      </header>

      <main className="app__content">
        <section className="card">
          <h2>שלב 1 – העלאת קובץ</h2>
          <form className="form" onSubmit={handleSubmit}>
            <label className="form__field">
              <span>קובץ וידאו/אודיו</span>
              <input
                type="file"
                accept="video/*,audio/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <label className="form__field">
              <span>פורמט כתוביות</span>
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                {SUPPORTED_FORMATS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {uploadProgress !== null && (
              <>
              <div className="progress" role="status" aria-live="polite">
                <div className="progress__track">
                  <div className="progress__bar" style={{ width: `${uploadProgress}%` }} />
                </div>
                <span className="progress__label">העלאה: {uploadProgress}%</span>
              </div>
            <ul className="steps">
              {stages.map((stage) => (
                <li key={stage.id} className={`steps__item steps__item--${stage.status}`}>
                  <span className="steps__indicator" />
                  <div className="steps__content">
                    <span className="steps__label">{stage.label}</span>
                    {stage.message && <small className="steps__message">{stage.message}</small>}
                  </div>
                </li>
              ))}
            </ul>
            </>
            )}


            <button className="button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "מעבד…" : "הפק כתוביות"}
            </button>
          </form>

          {error && <div className="alert alert--error">{error}</div>}
        </section>

        {response && (
          <section className="card">
            <h2>שלב 2 – התוצאה</h2>

            {response.warnings?.length ? (
              <div className="alert alert--warning">
                <p>התקבלו התרעות:</p>
                <ul>
                  {response.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="result">
              <div className="result__section">
                <h3>כתוביות ({subtitleFormatLabel})</h3>
                <textarea readOnly value={response.subtitle?.content ?? ""} />
                {downloadUrl && (
                  <a className="button button--secondary" download={downloadName} href={downloadUrl}>
                    הורדה כקובץ
                  </a>
                )}
              </div>

              <div className="result__section">
                <h3>תמלול מלא</h3>
                <textarea readOnly value={response.text ?? ""} />
              </div>

              <div className="result__section result__section--segments">
                <h3>מקטעים</h3>
                {response.segments?.length ? (
                  <ul className="segments">
                    {response.segments.map((segment) => (
                      <li key={segment.id}>
                        <span className="segments__time">
                          {formatTime(segment.start)} → {formatTime(segment.end)}
                        </span>
                        <span className="segments__text">{segment.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>לא נמצאו מקטעים להצגה.</p>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function formatTime(seconds: number) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "00:00";
  }
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export default App;











