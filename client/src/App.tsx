import { useEffect, useMemo, useState } from "react";
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
};

const DEFAULT_FORMAT = ".srt";
const SUPPORTED_FORMATS = [
  { value: ".srt", label: "SRT (SubRip)" },
  { value: ".vtt", label: "VTT (WebVTT)" },
  { value: ".txt", label: "Text" },
];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<string>(DEFAULT_FORMAT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
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

  const subtitleFormatLabel = useMemo(() => {
    const activeFormat = response?.subtitle?.format ?? format;
    return SUPPORTED_FORMATS.find((option) => option.value === activeFormat)?.label ?? activeFormat;
  }, [response, format]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError("??? ???? ????? ?? ????? ???? ??????");
      return;
    }

    const formData = new FormData();
    formData.append("media", file);
    formData.append("format", format);

    setIsSubmitting(true);
    setResponse(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/transcribe`, {
        method: "POST",
        body: formData,
      });

      const payload = (await res.json()) as ApiResponse & { error?: string };

      if (!res.ok) {
        throw new Error(payload.error ?? "????? ?? ????? ?????");
      }

      setResponse(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "???? ????? ?? ?????");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1>???? ??????? ??????? OpenAI</h1>
        <p>???? ???? ????? ?? ????? ???? ????? ?? ??????? ???????.</p>
      </header>

      <main className="app__content">
        <section className="card">
          <h2>1. ???? ????</h2>
          <form className="form" onSubmit={handleSubmit}>
            <label className="form__field">
              <span>???? ?????/?????</span>
              <input
                type="file"
                accept="video/*,audio/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <label className="form__field">
              <span>????? ???????</span>
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                {SUPPORTED_FORMATS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button className="button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "????..." : "??? ???????"}
            </button>
          </form>

          {error && <div className="alert alert--error">{error}</div>}
        </section>

        {response && (
          <section className="card">
            <h2>2. ?????</h2>

            {response.warnings?.length ? (
              <div className="alert alert--warning">
                <p>??????:</p>
                <ul>
                  {response.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="result">
              <div className="result__section">
                <h3>??????? ({subtitleFormatLabel})</h3>
                <textarea readOnly value={response.subtitle?.content ?? ""} />
                {downloadUrl && (
                  <a className="button button--secondary" download={downloadName} href={downloadUrl}>
                    ???? ???? ???????
                  </a>
                )}
              </div>

              <div className="result__section">
                <h3>????? ???</h3>
                <textarea readOnly value={response.text ?? ""} />
              </div>

              <div className="result__section result__section--segments">
                <h3>??????</h3>
                {response.segments?.length ? (
                  <ul className="segments">
                    {response.segments.map((segment) => (
                      <li key={segment.id}>
                        <span className="segments__time">
                          {formatTime(segment.start)} ? {formatTime(segment.end)}
                        </span>
                        <span className="segments__text">{segment.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>?? ????? ?????? ?????.</p>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="app__footer">
        <p>
          API ????? ?? ?????? <code>{API_BASE_URL}</code>. ???? ????? ??? ???????
          <code> VITE_API_BASE_URL</code> ????? ?????? ?? Vite.
        </p>
      </footer>
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
