import express from "express";
import path from "path";
import os from "os";
import { promises as fsp } from "fs";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

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

    const subtitleContent = req.body?.subtitleContent;
    if (!subtitleContent) {
      await safeUnlink(req.file.path);
      return res.status(400).json({ error: "נדרש תוכן כתוביות לצריבה." });
    }

    const fontSize = sanitizeFontSize(req.body?.fontSize);
    const fontColor = sanitizeColor(req.body?.fontColor);
    const outlineColor = sanitizeColor(req.body?.outlineColor);
    const offsetYPercent = sanitizePercent(req.body?.offsetYPercent, 12);
    const marginPercent = sanitizePercent(req.body?.marginPercent, 5);
    const videoWidth = sanitizeDimension(req.body?.videoWidth);
    const videoHeight = sanitizeDimension(req.body?.videoHeight);

    const subtitlePath = path.join(TEMP_SUBTITLE_DIR, `${randomUUID()}.srt`);
    const outputPath = path.join(TEMP_OUTPUT_DIR, `${randomUUID()}.mp4`);

    try {
      await fsp.writeFile(subtitlePath, subtitleContent, "utf-8");
      const filter = buildSubtitlesFilter(subtitlePath, {
        fontSize,
        fontColor,
        outlineColor,
        offsetYPercent,
        marginPercent,
        videoWidth,
        videoHeight,
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

function buildSubtitlesFilter(subtitlePath, { fontSize, fontColor, outlineColor, offsetYPercent, marginPercent, videoWidth, videoHeight }) {
  const normalizedPath = subtitlePath.replace(/\\/g, "/");
  const styleParts = [
    `Fontsize=${fontSize}`,
    `PrimaryColour=${fontColor}`,
    `OutlineColour=${outlineColor}`,
  ];

  const playResX = typeof videoWidth === "number" ? videoWidth : 1000;
  const playResY = typeof videoHeight === "number" ? videoHeight : 1000;
  const clampedOffset = Math.min(Math.max(offsetYPercent, 0), 100);
  const marginV = Math.round(clampedOffset * (playResY / 100));
  const marginValue = Math.round(Math.min(Math.max(marginPercent, 0), 45) * (playResX / 100));

  styleParts.push(
    `PlayResX=${playResX}`,
    `PlayResY=${playResY}`,
    `Alignment=2`,
    `BorderStyle=1`,
    `Outline=3`,
    `Shadow=0`,
    `MarginV=${marginV}`,
    `MarginL=${marginValue}`,
    `MarginR=${marginValue}`,
    `WrapStyle=2`
  );

  const style = styleParts.join(",");
  const subtitlePathValue = escapeFilterPath(normalizedPath).replace(/'/g, "\\'");
  return `subtitles='${subtitlePathValue}':charenc=UTF-8:force_style='${style}'`;
}

function escapeFilterPath(value) {
  return value.replace(/:/g, "\\:");
}

function sanitizeFontSize(raw) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return 36;
  }
  return Math.min(96, Math.max(12, Math.round(numeric)));
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







