import { useEffect, useMemo, useState } from "react";
import type { Segment } from "../types";
import { CAPTION_FONT_FAMILY, CAPTION_FONT_WEIGHT, captionTextLines, fitCaptionFontSize } from "../../captionStyle.js";

const MEASURE_SIZE = 100;
const MEASURE_FONT = `${CAPTION_FONT_WEIGHT} ${MEASURE_SIZE}px "${CAPTION_FONT_FAMILY}"`;

function useCaptionFontReady() {
  const [ready, setReady] = useState(() => typeof document === "undefined" || !document.fonts || document.fonts.check(MEASURE_FONT));
  useEffect(() => {
    if (ready) return;
    let live = true;
    const done = () => { if (live) setReady(true); };
    document.fonts.load(MEASURE_FONT).then(done, done);
    return () => { live = false; };
  }, [ready]);
  return ready;
}

type UseAutoCaptionFontSizeProps = {
  segments: Segment[];
  videoDimensions: { width: number; height: number } | null;
  marginPercent: number;
  offsetYPercent: number;
};

export function useAutoCaptionFontSize({ segments, videoDimensions, marginPercent, offsetYPercent }: UseAutoCaptionFontSizeProps) {
  const fontReady = useCaptionFontReady();

  const { maxLineEmWidth, maxLineCount } = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return { maxLineEmWidth: 0, maxLineCount: 1 };
    context.font = MEASURE_FONT;
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
  }, [segments, fontReady]);

  return useMemo(() => fitCaptionFontSize({
    maxLineEmWidth,
    maxLineCount,
    videoWidth: videoDimensions?.width ?? 0,
    videoHeight: videoDimensions?.height ?? 0,
    marginPercent,
    offsetYPercent,
  }), [maxLineEmWidth, maxLineCount, videoDimensions?.width, videoDimensions?.height, marginPercent, offsetYPercent]);
}
