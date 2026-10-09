import type { Segment } from "../types";
export { segmentsToSrt } from '../../subtitleSrt.js';

export function findSegment(segments: Segment[], time: number) {
  return segments.find((segment) => time >= segment.start && time < segment.end);
}

export function createOutlineShadow(color: string, radius?: number) {
  if (radius !== undefined) return Array.from({ length: 16 }, (_, index) => {
    const angle = index * Math.PI / 8;
    return `${(Math.cos(angle) * radius).toFixed(3)}px ${(Math.sin(angle) * radius).toFixed(3)}px 0 ${color}`;
  }).join(", ");
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

/**
 * Cleans segment text by trimming whitespace and normalizing line breaks.
 */
export function cleanSegmentText(text: string): string {
  return text
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Fixes overlapping segments by adjusting end times to not exceed the next segment's start time.
 * Ensures segments don't overlap with each other.
 */
export function fixSegmentOverlaps(segments: Segment[]): Segment[] {
  if (segments.length === 0) return segments;

  const sorted = [...segments].sort((a, b) => a.start - b.start);

  return sorted.map((segment, index) => {
    if (index < sorted.length - 1) {
      const nextSegment = sorted[index + 1];
      if (segment.end > nextSegment.start) {
        return { ...segment, end: nextSegment.start };
      }
    }
    return segment;
  });
}
