import { useMemo } from "react";
import type { Segment } from "../types";
import { captionTextLines, fitCaptionFontSize } from "../../captionStyle.js";
import { useCaptionFont } from "./useCaptionFont";

const MEASURE_SIZE = 100;

type UseAutoCaptionFontSizeProps = {
  fontId?: string;
  segments: Segment[];
  videoDimensions: { width: number; height: number } | null;
  marginPercent: number;
  offsetYPercent: number;
};

export function useAutoCaptionFontSize({ segments, videoDimensions, marginPercent, offsetYPercent, fontId }: UseAutoCaptionFontSizeProps) {
  const { font, ready: fontReady } = useCaptionFont(fontId);

  const { maxLineEmWidth, maxLineCount } = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return { maxLineEmWidth: 0, maxLineCount: 1 };
    context.font = `${font.weight} ${MEASURE_SIZE}px "${font.cssFamily}"`;
    const widths = new Map<string, number>();
    let widest = 0;
    let lineCount = 1;
    for (const segment of segments) {
      const lines = captionTextLines(segment.text);
      lineCount = Math.max(lineCount, lines.length);
      for (const line of lines) {
        let width = widths.get(line);
        if (width === undefined) {
          width = context.measureText(line).width / MEASURE_SIZE;
          widths.set(line, width);
        }
        widest = Math.max(widest, width);
      }
    }
    return { maxLineEmWidth: widest, maxLineCount: lineCount };
  }, [segments, font, fontReady]);

  return useMemo(() => fitCaptionFontSize({
    maxLineEmWidth,
    maxLineCount,
    videoWidth: videoDimensions?.width ?? 0,
    videoHeight: videoDimensions?.height ?? 0,
    marginPercent,
    offsetYPercent,
    emRatio: font.emRatio,
  }), [maxLineEmWidth, maxLineCount, videoDimensions?.width, videoDimensions?.height, marginPercent, offsetYPercent, font]);
}
