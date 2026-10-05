import express from "express";
import path from "path";
import os from "os";
import { promises as fsp } from "fs";
import { randomUUID } from "crypto";
import { buildBurnArguments, probeBurnDuration, runBurnFfmpeg } from "../src/burnVideo.js";
import { fileURLToPath } from "url";
import { renderActiveWordSrt } from "../src/activeWordSubtitles.js";
import { renderWordPopAss, sanitizeCaptionMotion, sanitizePopIntensity } from "../src/captionMotion.js";
import { CAPTION_OUTLINE_WIDTH, captionMarginPixels, sanitizeCaptionFontSize } from "../src/captionStyle.js";
import { getCaptionFont } from "../src/captionFonts.js";

const CAPTION_FONTS_DIR = fileURLToPath(new URL("../public/fonts", import.meta.url));
const TEMP_SUBTITLE_DIR = path.join(os.tmpdir(), "subtitles-api-subtitle-temp");
const TEMP_OUTPUT_DIR = path.join(os.tmpdir(), "subtitles-api-output-temp");

await fsp.mkdir(TEMP_SUBTITLE_DIR, { recursive: true });
await fsp.mkdir(TEMP_OUTPUT_DIR, { recursive: true });

export function createBurnSubtitlesRouter(upload, { resolveVideo } = {}) {
  const router = express.Router();
  const jobs = new Map();
  router.get('/progress/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    res.set('Cache-Control', 'private, no-store');
    if (!job || !req.identity?.uid || job.owner !== req.identity.uid) return res.status(404).json({ error: 'Progress not found' });
    res.json({ stage: job.stage, percent: job.percent });
  });

  router.post("/", (req, res, next) => {
    const id = req.get('X-Burn-Job-Id');
    // Register before the upload so the popup covers preparation as well.
    for (const [key, value] of jobs) if (value.expires && value.expires < Date.now()) jobs.delete(key);
    if (id && (!/^[a-f0-9-]{36}$/i.test(id) || jobs.has(id) || jobs.size >= 1000)) return res.status(409).json({ error: 'Invalid or duplicate burn job' });
    const job = { owner: req.identity?.uid, stage: 'preparing', percent: null };
    if (id && job.owner) jobs.set(id, job);
    const expire = () => {
      if (job.expires) return;
      job.expires = Date.now() + 10 * 60_000;
      if (id && job.owner) {
        const timer = setTimeout(() => { if (jobs.get(id) === job) jobs.delete(id); }, 10 * 60_000);
        timer.unref();
      }
    };
    req.burnJob = job;
    req.burnController = new AbortController();
    res.once('close', () => {
      req.burnController.abort();
      if (!res.writableFinished) job.stage = 'failed';
      expire();
    });
    res.once('finish', () => {
      if (res.statusCode >= 400) job.stage = 'failed';
      expire();
    });
    next();
  }, upload.single("media"), async (req, res) => {
    if (!req.file && !req.body?.videoId) {
      return res.status(400).json({ error: "נדרש קובץ וידאו לצריבת כתוביות." });
    }

    let subtitleContent = req.body?.subtitleContent;
    if (!subtitleContent) {
      await safeUnlink(req.file?.path);
      return res.status(400).json({ error: "נדרש תוכן כתוביות לצריבה." });
    }

    const motion = sanitizeCaptionMotion(req.body?.captionMotion);
    let timedSegments, timedWords;
    if (req.body?.activeWordEnabled === "true" || motion === "pop") {
      try {
        const segments = JSON.parse(req.body.segments);
        const words = JSON.parse(req.body.words ?? "[]");
        if (!Array.isArray(segments) || !segments.length || !Array.isArray(words) || segments.some(s => !s || typeof s.text !== "string" || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end <= s.start)) throw new Error("Invalid word timing data");
        timedSegments = segments;
        timedWords = words;
        if (motion !== "pop") subtitleContent = renderActiveWordSrt(segments, words, req.body.textDirection, req.body.activeWordColor);
      } catch {
        await safeUnlink(req.file?.path);
        return res.status(400).json({ error: "נתוני תזמון המילים אינם תקינים. נסו לשמור את הכתוביות ולצרוב שוב." });
      }
    }

    const fontSize = sanitizeCaptionFontSize(req.body?.fontSize);
    const fontColor = sanitizeColor(req.body?.fontColor);
    const outlineColor = sanitizeColor(req.body?.outlineColor);
    const offsetYPercent = sanitizePercent(req.body?.offsetYPercent, 12);
    const marginPercent = sanitizePercent(req.body?.marginPercent, 5);
    const videoWidth = sanitizeDimension(req.body?.videoWidth);
    const videoHeight = sanitizeDimension(req.body?.videoHeight);
    if (motion === "pop" && (!videoWidth || !videoHeight)) {
      await safeUnlink(req.file?.path);
      return res.status(400).json({ error: "נדרש גודל וידאו תקין לאנימציה. המתינו לטעינת הסרטון ונסו שוב." });
    }

    const subtitlePath = path.join(TEMP_SUBTITLE_DIR, `${randomUUID()}.${motion === "pop" ? "ass" : "srt"}`);
    const outputPath = path.join(TEMP_OUTPUT_DIR, `${randomUUID()}.mp4`);
    let source = req.file ? { ...req.file, temporary: true } : null;
    const { signal } = req.burnController;
    const job = req.burnJob;
    const cleanup = () => Promise.all([source?.temporary && safeUnlink(source.path), safeUnlink(subtitlePath), safeUnlink(outputPath)]);

    try {
      if (!source) {
        const videoId = Number(req.body.videoId);
        if (!Number.isSafeInteger(videoId) || videoId < 1 || !resolveVideo) return res.status(400).json({ error: 'נדרש סרטון שמור תקין.' });
        source = await resolveVideo({ videoId, userUid: req.identity?.uid, signal });
        if (!source) return res.status(404).json({ error: 'הסרטון לא נמצא או שאין לכם הרשאה לצפות בו.' });
      }
      // Wrap subtitle lines with RTL markers for proper Hebrew punctuation rendering
      const rtlSubtitleContent = motion === "pop"
        ? renderWordPopAss(timedSegments, timedWords, { intensity: sanitizePopIntensity(req.body?.popIntensity), direction: req.body?.textDirection === "ltr" ? "ltr" : "rtl", videoWidth, videoHeight, outlineWidth: CAPTION_OUTLINE_WIDTH })
        : req.body?.textDirection === "ltr" ? subtitleContent : wrapSubtitleLinesWithRTL(subtitleContent);
      await fsp.writeFile(subtitlePath, rtlSubtitleContent, "utf-8");
      const filter = buildSubtitlesFilter(subtitlePath, {
        fontId: req.body?.fontId,
        fontSize,
        fontColor,
        outlineColor,
        offsetYPercent,
        marginPercent,
        videoWidth,
        videoHeight,
        wholeTextLayout: req.body?.activeWordEnabled === "true" || motion === "pop",
      });

      const duration = await probeBurnDuration(source.path, { signal });
      job.stage = 'burning';
      job.percent = duration ? 0 : null;
      await runBurnFfmpeg(buildBurnArguments(source.path, filter, outputPath), {
        duration, signal, onProgress: percent => { job.percent = percent; },
      });
      job.stage = 'downloading';
      job.percent = 100;

      const originalBase = path.parse(source.originalname ?? "video").name;
      const downloadName = `${originalBase}-subtitled.mp4`;
      res.download(outputPath, downloadName, async (error) => {
        if (error) {
          console.error("Failed to send burned video:", error);
        }
        job.stage = error ? 'failed' : 'complete';
        await cleanup();
      });
    } catch (error) {
      job.stage = 'failed';
      await cleanup();
      if (signal.aborted || res.destroyed) return;
      console.error("Burn subtitles route failed:", error);
      res.status(error.status ?? 500).json({ error: "אירעה שגיאה בצריבת הכתוביות. נסו שוב." });
    }
  });

  return router;
}

export function buildSubtitlesFilter(subtitlePath, { fontId, fontSize, fontColor, outlineColor, offsetYPercent, marginPercent, videoWidth, videoHeight, wholeTextLayout }) {
  const normalizedPath = subtitlePath.replace(/\\/g, "/");
  const font = getCaptionFont(fontId);
  const styleParts = [
    `Fontname=${font.family}`,
    `Bold=${font.id !== "assistant" && font.weight >= 600 ? -1 : 0}`,
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
