import { useEffect, useMemo } from "react";
import { createOutlineShadow } from "../utils/transcriptionUtils";

type UsePreviewStyleProps = {
  fontColor: string;
  fontSize: number;
  offsetYPercent: number;
  outlineColor: string;
  marginPercent: number;
  videoDimensions: { width: number; height: number } | null;
  renderDimensions: { width: number; height: number } | null;
};

export function usePreviewStyle({
  fontColor,
  fontSize,
  offsetYPercent,
  outlineColor,
  marginPercent,
  videoDimensions,
  renderDimensions,
}: UsePreviewStyleProps) {
  const previewStyle = useMemo(() => {
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    const clampedBottomPercent = clamp(offsetYPercent, 0, 100);
    const clampedMarginPercent = clamp(marginPercent, 0, 40);

    if (!videoDimensions || !renderDimensions) {
      const widthPercent = Math.max(10, 100 - clampedMarginPercent * 2);

      return {
        position: "absolute" as const,
        left: "50%",
        bottom: `${clampedBottomPercent}%`,
        transform: "translate(-50%, 0)",
        color: fontColor,
        fontSize: `${fontSize}px`,
        fontWeight: 600,
        lineHeight: 1.35,
        textAlign: "center" as const,
        whiteSpace: "pre-wrap" as const,
        pointerEvents: "none" as const,
        textShadow: createOutlineShadow(outlineColor),
        width: `${widthPercent}%`,
        maxWidth: `${widthPercent}%`,
      };
    }

    const scaleX = renderDimensions.width / videoDimensions.width;
    const scaleY = renderDimensions.height / videoDimensions.height;

    const marginValueVideo = Math.round(clampedMarginPercent * (videoDimensions.width / 100));
    const bottomVideo = (clampedBottomPercent / 100) * videoDimensions.height;
    const widthVideo = Math.max(1, videoDimensions.width - marginValueVideo * 2);

    const fontSizePx = fontSize * scaleY;
    const widthPx = widthVideo * scaleX;
    const bottomPx = bottomVideo * scaleY;

    return {
      position: "absolute" as const,
      left: "50%",
      bottom: `${bottomPx}px`,
      transform: "translate(-50%, 0)",
      color: fontColor,
      fontSize: `${fontSizePx}px`,
      fontWeight: 600,
      lineHeight: 1.35,
      textAlign: "center" as const,
      whiteSpace: "pre-wrap" as const,
      pointerEvents: "none" as const,
      textShadow: createOutlineShadow(outlineColor),
      width: `${widthPx}px`,
      maxWidth: `${widthPx}px`,
    };
  }, [fontColor, fontSize, offsetYPercent, outlineColor, marginPercent, videoDimensions, renderDimensions]);

  useEffect(() => {
    if (import.meta.env.DEV && videoDimensions && renderDimensions) {
      const scaleX = renderDimensions.width / videoDimensions.width;
      const scaleY = renderDimensions.height / videoDimensions.height;
      console.debug("Subtitle preview metrics", {
        videoDimensions,
        renderDimensions,
        scaleX,
        scaleY,
        fontSize,
        scaledFontSize: fontSize * scaleY,
        offsetYPercent,
        marginPercent,
      });
    }
  }, [videoDimensions, renderDimensions, fontSize, offsetYPercent, marginPercent]);

  return previewStyle;
}