import type { Segment } from "../types";

export function findSegment(segments: Segment[], time: number) {
  return segments.find((segment) => time >= segment.start && time <= segment.end);
}

export function createOutlineShadow(color: string) {
  return [
    `-2px 0 0 ${color}`,
    `2px 0 0 ${color}`,
    `0 -2px 0 ${color}`,
    `0 2px 0 ${color}`,
    `-1px -1px 0 ${color}`,
    `1px -1px 0 ${color}`,
    `-1px 1px 0 ${color}`,
    `1px 1px 0 ${color}`,
  ].join(", ");
}

export function segmentsToSrt(segments: Segment[]) {
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