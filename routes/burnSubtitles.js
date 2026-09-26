import express from "express";
import path from "path";
import os from "os";
import { promises as fsp } from "fs";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { renderActiveWordSrt } from "../src/activeWordSubtitles.js";
import { CAPTION_FONT_FAMILY, CAPTION_OUTLINE_WIDTH, captionMarginPixels, sanitizeCaptionFontSize } from "../src/captionStyle.js";

const CAPTION_FONTS_DIR = fileURLToPath(new URL("../public/fonts", import.meta.url));
const TEMP_SUBTITLE_DIR = path.join(os.tmpdir(), "subtitles-api-subtitle-temp");
const TEMP_OUTPUT_DIR = path.join(os.tmpdir(), "subtitles-api-output-temp");

await fsp.mkdir(TEMP_SUBTITLE_DIR, { recursive: true });
await fsp.mkdir(TEMP_OUTPUT_DIR, { recursive: true });

export function createBurnSubtitlesRouter(upload) {
  const router = express.Router();

  router.post("/", upload.single("media"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "נדרש קובץ וידאו לצריבת כתוביות." });
    }

    let subtitleContent = req.body?.subtitleContent;
    if (!subtitleContent) {
      await safeUnlink(req.file.path);
      return res.status(400).json({ error: "נדרש תוכן כתוביות לצריבה." });
    }

    if (req.body?.activeWordEnabled === "true") {
      try {
        const segments = JSON.parse(req.body.segments);
        const words = JSON.parse(req.body.words ?? "[]");
        if (!Array.isArray(segments) || !segments.length || !Array.isArray(words) || segments.some(s => !s || typeof s.text !== "string" || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end <= s.start)) throw new Error("Invalid word timing data");
        subtitleContent = renderActiveWordSrt(segments, words, req.body.textDirection);
      } catch {
        await safeUnlink(req.file.path);
        return res.status(400).json({ error: "נתוני המילה האקטיבית אינם תקינים. נסו לשמור את הכתוביות ולצרוב שוב." });
      }
    }

    const fontSize = sanitizeCaptionFontSize(req.body?.fontSize);
    const fontColor = sanitizeColor(req.body?.fontColor);
    const outlineColor = sanitizeColor(req.body?.outlineColor);
    const offsetYPercent = sanitizePercent(req.body?.offsetYPercent, 12);
    const marginPercent = sanitizePercent(req.body?.marginPercent, 5);
    const videoWidth = sanitizeDimension(req.body?.videoWidth);
    const videoHeight = sanitizeDimension(req.body?.videoHeight);

    const subtitlePath = path.join(TEMP_SUBTITLE_DIR, `${randomUUID()}.srt`);
    const outputPath = path.join(TEMP_OUTPUT_DIR, `${randomUUID()}.mp4`);

    try {
      // Wrap subtitle lines with RTL markers for proper Hebrew punctuation rendering
      const rtlSubtitleContent = req.body?.textDirection === "ltr" ? subtitleContent : wrapSubtitleLinesWithRTL(subtitleContent);
      await fsp.writeFile(subtitlePath, rtlSubtitleContent, "utf-8");
      const filter = buildSubtitlesFilter(subtitlePath, {
        fontSize,
        fontColor,
        outlineColor,
        offsetYPercent,
        marginPercent,
        videoWidth,
        videoHeight,
        wholeTextLayout: req.body?.activeWordEnabled === "true",
      });

      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        req.file.path,
        "-vf",
        filter,
        "-c:a",
        "copy",
        outputPath,
      ]);

      const originalBase = path.parse(req.file.originalname ?? "video").name;
      const downloadName = `${originalBase}-subtitled.mp4`;
      res.download(outputPath, downloadName, async (error) => {
        if (error) {
          console.error("Failed to send burned video:", error);
        }
        await Promise.all([safeUnlink(req.file.path), safeUnlink(subtitlePath), safeUnlink(outputPath)]);
      });
    } catch (error) {
      await Promise.all([safeUnlink(req.file.path), safeUnlink(subtitlePath), safeUnlink(outputPath)]);
      console.error("Burn subtitles route failed:", error);
      res.status(500).json({ error: error.message ?? "אירעה שגיאה בצריבת הכתוביות." });
    }
  });

  return router;
}

function buildSubtitlesFilter(subtitlePath, { fontSize, fontColor, outlineColor, offsetYPercent, marginPercent, videoWidth, videoHeight, wholeTextLayout }) {
  const normalizedPath = subtitlePath.replace(/\\/g, "/");
  const styleParts = [
    `Fontname=${CAPTION_FONT_FAMILY}`,
    `Fontsize=${fontSize}`,
    `PrimaryColour=${fontColor}`,
    `OutlineColour=${outlineColor}`,
  ];

  const playResX = typeof videoWidth === "number" ? videoWidth : 1000;
  const playResY = typeof videoHeight === "number" ? videoHeight : 1000;
  const clampedOffset = Math.min(Math.max(offsetYPercent, 0), 100);
  const marginV = Math.round(clampedOffset * (playResY / 100));
  const marginValue = captionMarginPixels(marginPercent, playResX);

  styleParts.push(
    `PlayResX=${playResX}`,
    `PlayResY=${playResY}`,
    `Alignment=2`,
    `BorderStyle=1`,
    `Outline=${CAPTION_OUTLINE_WIDTH}`,
    `Shadow=0`,
    `MarginV=${marginV}`,
    `MarginL=${marginValue}`,
    `MarginR=${marginValue}`,
    `WrapStyle=2`,
    // libass whole-text layout keeps RTL word order across inline colour runs.
    // https://github.com/libass/libass/blob/master/libass/ass.h (ASS_FEATURE_WHOLE_TEXT_LAYOUT)
    `Encoding=${wholeTextLayout ? -1 : 177}`
  );

  const style = styleParts.join(",");
  const subtitlePathValue = escapeFilterPath(normalizedPath).replace(/'/g, "\\'");
  const fontsDirValue = escapeFilterPath(CAPTION_FONTS_DIR.replace(/\\/g, "/")).replace(/'/g, "\\'");
  return `subtitles='${subtitlePathValue}':charenc=UTF-8:fontsdir='${fontsDirValue}':force_style='${style}'`;
}

/**
 * Wrap subtitle text lines with Unicode RTL markers for proper Hebrew punctuation rendering.
 * This ensures punctuation marks (?, !, ., ,) appear on the correct side in RTL text.
 */
function wrapSubtitleLinesWithRTL(srtContent) {
  const RLE = "\u202B"; // Right-to-Left Embedding
  const PDF = "\u202C"; // Pop Directional Formatting

  // Split by lines and process
  const lines = srtContent.split("\n");
  const processedLines = lines.map((line) => {
    // Skip empty lines, sequence numbers, and timestamp lines
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (/^\d+$/.test(trimmed)) return line; // Sequence number
    if (/^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}$/.test(trimmed)) return line; // Timestamp

    // Check if line contains Hebrew characters
    if (/[\u0590-\u05FF]/.test(line)) {
      // Wrap the text content with RTL markers
      return RLE + line + PDF;
    }
    return line;
  });

  return processedLines.join("\n");
}

function escapeFilterPath(value) {
  return value.replace(/:/g, "\\:");
}

function sanitizeDimension(raw) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const rounded = Math.max(1, Math.round(numeric));
  return Number.isFinite(rounded) ? rounded : null;
}

function sanitizeColor(raw) {
  if (typeof raw !== "string") {
    return "&H00FFFFFF";
  }
  const match = raw.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) {
    return "&H00FFFFFF";
  }
  const hex = match[1];
  const r = hex.slice(0, 2);
  const g = hex.slice(2, 4);
  const b = hex.slice(4, 6);
  return `&H00${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

function sanitizePercent(raw, fallback) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(100, Math.max(0, numeric));
}

async function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);
    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("error", (error) => {
      reject(new Error(error.message ?? "FFmpeg failed to start"));
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error("FFmpeg failed", { args, stderr });
        reject(new Error(`FFmpeg exited with code ${code}: ${truncate(stderr, 400)}`));
      }
    });
  });
}

async function safeUnlink(filePath) {
  if (!filePath) {
    return;
  }
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("Failed to clean temp file:", error?.message ?? error);
    }
  }
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}



