import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, Box, Button, CssBaseline, ThemeProvider, createTheme, Typography } from "@mui/material";
import { UploadForm } from "../src/client/components/UploadForm";
import { TranscriptionResult } from "../src/client/components/TranscriptionResult";
import { EditorPreferencesProvider } from "../src/client/contexts/EditorPreferences";
import { limitSubtitleCharacters } from "../src/subtitleSegmentation.js";
import { serializeSubtitles } from "../src/client/utils/subtitleExport";
import type { ApiResponse, Segment, Word } from "../src/client/types";
import "../src/client/App.css";

// Vite-only integration harness. No authentication, API transcription, or user DB writes.
function Harness() {
  const [file, setFile] = useState<File | null>(null);
  const [dragFile, setDragFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const format = ".srt";
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [saveCount, setSaveCount] = useState(0);
  const [editorKey, setEditorKey] = useState(0);
  const [failSaves, setFailSaves] = useState(false);
  useEffect(() => {
    if (!file) return;
    const value = URL.createObjectURL(file); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return <Box sx={{ p: { xs: 1, md: 3 } }}>
    <Alert severity="info">בדיקת עורך מקומית — הכתוביות הן נתוני בדיקה, אינן תמלול של הקובץ. אין כתיבה לחשבון.</Alert>
    <Typography data-testid="save-count">שמירות בדיקה: {saveCount}</Typography>
    {!response && <Button onClick={() => {
      // Silent PCM fixture generated locally: exercise real native media seeking
      // across multiple 30-second windows, without downloads or server writes.
      const rate = 8000, seconds = 90, bytes = rate * seconds * 2;
      const buffer = new ArrayBuffer(44 + bytes), view = new DataView(buffer);
      const ascii = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
      ascii(0, "RIFF"); view.setUint32(4, 36 + bytes, true); ascii(8, "WAVE"); ascii(12, "fmt ");
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      ascii(36, "data"); view.setUint32(40, bytes, true);
      setFile(new File([buffer], "timeline-90s.wav", { type: "audio/wav" }));
      const segments = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, start: i * 3, end: (i + 1) * 3, text: `מקטע בדיקה ${i + 1}` }));
      setResponse({ segments, words: [], text: segments.map(s => s.text).join(" "), subtitle: { format, content: serializeSubtitles(segments, format) } });
    }}>בדיקת ציר ארוך — 90 שניות</Button>}
    {!response && <Button onClick={async () => {
      const result = await fetch("/tests/fixtures/portrait-short.mp4");
      if (!result.ok) return;
      const sample = new File([await result.blob()], "portrait-short.mp4", { type: "video/mp4" });
      setFile(sample); setDragFile(sample);
    }}>טען דוגמת בדיקה מקומית</Button>}
    {!response && dragFile && <Box sx={{ display: "flex", gap: 2, p: 1 }}>
      <Box data-testid="drag-source" draggable onDragStart={e => { e.dataTransfer.items.add(dragFile); }} sx={{ p: 1, border: "1px solid", cursor: "grab" }}>גררו קובץ בדיקה</Box>
      <Button onClick={() => setFile(null)}>נקה בחירת בדיקה</Button>
    </Box>}
    {!response && file && <Button onClick={() => {
      const segments = [
        { id: 1, start: 0, end: 2, text: "כן, כן עכשיו בדיקה!" },
        { id: 2, start: 2, end: 4, text: "מילה שנוספה נשארת כאן" },
        { id: 3, start: 4, end: 6, text: "שלום עולם." },
      ];
      const words = [
        { word: "כן", start: 0, end: .4 }, { word: "כן", start: .6, end: 1 }, { word: "בדיקה", start: 1.5, end: 2 },
        { word: "ישן", start: 4, end: 4.3 }, { word: "שלום", start: 4.3, end: 4.8 }, { word: "עולם", start: 4.8, end: 5.4 }, { word: ",", start: 5.4, end: 5.7 }, { word: "ישן", start: 5.7, end: 6 },
      ];
      setResponse({ segments, words, text: segments.map(s => s.text).join(" "), subtitle: { format, content: serializeSubtitles(segments, format) } });
    }}>בדיקת מילה אקטיבית אחרי תיקוני מודל</Button>}
    {response ? <>
      <Button onClick={() => setFailSaves(value => !value)}>{failSaves ? "בטל כשל שמירה לבדיקה" : "הפעל כשל שמירה לבדיקה"}</Button>
      <details><summary>נתוני בדיקה שמורים</summary><pre data-testid="saved-test-data">{JSON.stringify({ segments: response.segments, words: response.words }, null, 2)}</pre></details>
      <Button onClick={() => setResponse(null)}>בדיקת קובץ נוסף</Button>
      <Button onClick={() => { setResponse(JSON.parse(JSON.stringify(response))); setEditorKey(n => n + 1); }}>טעינה מחדש של נתוני הבדיקה</Button>
      <Button onClick={() => setResponse(previous => previous && ({ ...previous, warnings: previous.warnings?.length ? [] : ["לחלק מהמילים שהשתנו או שלא קיבלו תזמון מהמודל הותאם תזמון משוער. אפשר לדייק אותו בציר המילים.", "אזהרת בדיקה אחרת נשארת גלויה."] }))}>החלפת אזהרות שרת לבדיקה</Button>
      <TranscriptionResult key={editorKey} response={response} mediaUrl={url} subtitleFormatLabel={format} downloadUrl={null} downloadName={`editor-check${format}`} videoId={1} isEditable onBack={() => { setResponse(null); setFile(null); }}
        onSaveSegments={async (segments: Segment[], _content: string, words?: Word[]) => {
          if (failSaves) throw new Error("כשל שמירה יזום לבדיקה בלבד");
          setResponse(previous => previous && ({ ...previous, segments, words: words ?? previous.words }));
          setSaveCount(n => n + 1);
        }}
        onBurn={async options => {
          const data = new FormData(); data.append("media", file!);
          Object.entries(options).forEach(([key, value]) => { if (value != null) data.append(key, typeof value === "object" ? JSON.stringify(value) : String(value)); });
          const result = await fetch("/api/burn-subtitles", { method: "POST", body: data });
          if (!result.ok) throw new Error(await result.text());
          return { blob: await result.blob(), filename: "editor-check-burned.mp4" };
        }} />
    </> : <UploadForm file={file} isSubmitting={false} uploadProgress={null} stages={[]}
      onFileChange={next => { setFile(next); setDragFile(next); }}
      onSubmit={event => {
        event.preventDefault();
        const text = "שלום לכולם זו בדיקה של כתוביות בעברית מילהארוכהמאודהרבהיותר English words remain whole";
        const words = text.split(" ").map((word, i) => ({ word, start: i * .45, end: i * .45 + .4 }));
        const base = [{ id: 1, start: 0, end: words[words.length - 1].end, text }];
        const segments = limitSubtitleCharacters(base, words, 20);
        setResponse({ text, words, segments, subtitle: { format, content: serializeSubtitles(segments, format) } });
      }} />}
  </Box>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider theme={createTheme({ direction:"rtl", typography:{fontFamily:'"Assistant", sans-serif'} })}><CssBaseline/><EditorPreferencesProvider><Harness/></EditorPreferencesProvider></ThemeProvider>);
