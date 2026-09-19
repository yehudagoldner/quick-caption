import type { Segment } from "../types";
import { segmentsToSrt } from "./transcriptionUtils";
import type { TextDirection } from "../contexts/EditorPreferences";

export function serializeSubtitles(segments: Segment[], format: string, direction?: TextDirection) {
  const clean = segments.map(segment => ({ ...segment, text: segment.text.replace(/[\u202a-\u202e]/g, "") }));
  if (format === ".txt") return clean.map(s => s.text).join("\n");
  const directed = direction ? clean.map(s => ({ ...s, text: s.text.split("\n").map(line => `${direction === "rtl" ? "\u202b" : "\u202a"}${line}\u202c`).join("\n") })) : clean;
  const srt = segmentsToSrt(directed);
  if (format === ".vtt") return `WEBVTT\n\n${srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
  return srt;
}
