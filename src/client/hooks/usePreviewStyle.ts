import { useEffect, useMemo } from "react";
import { createOutlineShadow } from "../utils/transcriptionUtils";
import { useEditorPreferences } from "../contexts/EditorPreferences";
import { captionMarginPixels } from "../../captionStyle.js";
import { getCaptionFont } from "../../captionFonts.js";

type UsePreviewStyleProps = {
  fontId?: string;
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
  fontId,
}: UsePreviewStyleProps) {
  const { preferences } = useEditorPreferences();
  const font = getCaptionFont(fontId);
  const fontStack = `"${font.cssFamily}", "Assistant", sans-serif`;
  // libass advances a full ASS Fontsize per line, independently of the font em.
  const lineHeight = 1 / font.emRatio;
  const previewStyle = useMemo(() => {
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    const clampedBottomPercent = clamp(offsetYPercent, 0, 100);
    const clampedMarginPercent = clamp(marginPercent, 0, 40);

    if (!videoDimensions?.width || !videoDimensions.height || !renderDimensions) {
      const widthPercent = Math.max(10, 100 - clampedMarginPercent * 2);

      return {
        position: "absolute" as const,
        left: "50%",
        bottom: `${clampedBottomPercent}%`,
        transform: "translate(-50%, 0)",
        color: fontColor,
        fontFamily: fontStack,
        fontSize: `${fontSize * font.emRatio}px`,
        fontWeight: font.weight,
        lineHeight,
        textAlign: "center" as const,
        whiteSpace: "pre-wrap" as const,
        pointerEvents: "none" as const,
        textShadow: createOutlineShadow(outlineColor),
        width: `${widthPercent}%`,
        maxWidth: `${widthPercent}%`,
        direction: preferences.direction,
      };
    }

    const scaleX = renderDimensions.width / videoDimensions.width;
    const scaleY = renderDimensions.height / videoDimensions.height;

    const marginValueVideo = captionMarginPixels(clampedMarginPercent, videoDimensions.width);
    const bottomVideo = (clampedBottomPercent / 100) * videoDimensions.height;
    const widthVideo = Math.max(1, videoDimensions.width - marginValueVideo * 2);

    const fontSizePx = fontSize * font.emRatio * scaleY;
    const widthPx = widthVideo * scaleX;
    const bottomPx = bottomVideo * scaleY;

    return {
      position: "absolute" as const,
      left: "50%",
      bottom: `${bottomPx}px`,
      transform: "translate(-50%, 0)",
      color: fontColor,
      fontFamily: fontStack,
      fontSize: `${fontSizePx}px`,
      fontWeight: font.weight,
      lineHeight,
      textAlign: "center" as const,
      whiteSpace: "pre-wrap" as const,
      pointerEvents: "none" as const,
      textShadow: createOutlineShadow(outlineColor),
      width: `${widthPx}px`,
      maxWidth: `${widthPx}px`,
      direction: preferences.direction,
    };
  }, [fontColor, fontSize, offsetYPercent, outlineColor, marginPercent, videoDimensions, renderDimensions, preferences.direction, font, fontStack, lineHeight]);

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
        scaledFontSize: fontSize * font.emRatio * scaleY,
        offsetYPercent,
        marginPercent,
      });
    }
  }, [videoDimensions, renderDimensions, fontSize, offsetYPercent, marginPercent, font]);

  return previewStyle;
}
