import type { Segment } from "../types";
import { segmentsToSrt } from "./transcriptionUtils";
import type { TextDirection } from "../contexts/EditorPreferences";

export const SUBTITLE_EXPORT_FORMATS = [
  { value: ".srt", label: "SRT" },
  { value: ".vtt", label: "VTT" },
  { value: ".txt", label: "TXT" },
] as const;

export function serializeSubtitles(segments: Segment[], format: string, direction?: TextDirection) {
  const clean = segments.map(segment => ({ ...segment, text: segment.text.replace(/[\u202a-\u202e]/g, "") }));
  if (format === ".txt") return clean.map(s => s.text).join("\n");
  const directed = direction ? clean.map(s => ({ ...s, text: s.text.split("\n").map(line => `${direction === "rtl" ? "\u202b" : "\u202a"}${line}\u202c`).join("\n") })) : clean;
  const srt = segmentsToSrt(directed);
  if (format === ".vtt") return `WEBVTT\n\n${srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
  return srt;
}

export function subtitleDownloadName(originalFilename: string, format: string) {
  const base = originalFilename.replace(/\.[^.]+$/, "") || "subtitles";
  const extension = format.startsWith(".") ? format : `.${format}`;
  return `${base}${extension}`;
}

export function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function parseSubtitleSegments(subtitleJson: unknown): Segment[] {
  const parsed = typeof subtitleJson === "string" ? JSON.parse(subtitleJson) : subtitleJson;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("לא נמצאו כתוביות לייצוא");
  }
  return parsed as Segment[];
}
