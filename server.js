import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import os from "os";
import { promises as fsp } from "fs";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";

import { transcribeMedia, normalizeSubtitleFormat } from "./src/transcription.js";
import { createBurnSubtitlesRouter } from "./routes/burnSubtitles.js";
import { ensureSchema, upsertUser, saveVideo, updateVideoSubtitles } from "./db.js";


dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3000);

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : undefined;

app.use(cors({ origin: allowedOrigins ?? true }));
app.use(express.json());

const uploadDir = path.join(os.tmpdir(), "subtitles-api-uploads");
await fsp.mkdir(uploadDir, { recursive: true });
await ensureSchema();

const upload = multer({ dest: uploadDir });
app.use("/api/burn-subtitles", createBurnSubtitlesRouter(upload));

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: allowedOrigins ?? ["http://localhost:5173", "http://127.0.0.1:5173"],
  },
});

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/users/sync", async (req, res) => {
  const {
    uid,
    email,
    displayName,
    photoURL,
    phoneNumber,
    emailVerified,
    providerId,
    lastLoginAt,
  } = req.body ?? {};
  if (!uid || !email) {
    return res.status(400).json({ error: "uid and email are required" });
  }

  try {
    const parsedLastLogin = lastLoginAt ? new Date(lastLoginAt) : null;
    await upsertUser({
      uid,
      email,
      displayName,
      photoURL,
      phoneNumber,
      emailVerified: Boolean(emailVerified),
      providerId,
      lastLoginAt:
        parsedLastLogin && !Number.isNaN(parsedLastLogin.getTime())
          ? parsedLastLogin.toISOString().slice(0, 19).replace("T", " ")
          : null,
    });
    res.json({ status: "ok" });
  } catch (error) {
    console.error("Failed to sync user:", error);
    res.status(500).json({ error: "Failed to sync user" });
  }
});


app.put("/api/videos/:id/subtitles", async (req, res) => {
  const videoId = Number.parseInt(req.params.id, 10);
  const { userUid, subtitleJson } = req.body ?? {};

  if (!Number.isFinite(videoId) || !userUid || typeof subtitleJson !== 'string') {
    return res.status(400).json({ error: 'videoId, userUid and subtitleJson are required' });
  }

  try {
    const result = await updateVideoSubtitles({ videoId, userUid, subtitleJson });
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Failed to update subtitles:', error);
    res.status(500).json({ error: 'Failed to update subtitles' });
  }
});

app.post("/api/transcribe", upload.single("media"), async (req, res) => {
  const socketId = req.body?.socketId;
  const userUid = req.body?.userUid;
  const emitStage = createStageEmitter(socketId);

  if (!req.file) {
    emitStage("complete", "error", "נדרש קובץ מדיה");
    return res.status(400).json({ error: 'Media file is required under field name "media".' });
  }

  emitStage("upload", "done");

  let format = ".srt";
  try {
    if (req.body?.format) {
      format = normalizeSubtitleFormat(req.body.format);
    }
  } catch (error) {
    emitStage("complete", "error", error.message);
    await safeUnlink(req.file.path);
    return res.status(400).json({ error: error.message });
  }

  try {
    const result = await transcribeMedia({
      inputPath: req.file.path,
      format,
      logger: createRequestLogger(req),
      onStage: emitStage,
    });

    let savedVideoId = null;
    if (userUid) {
      try {
        savedVideoId = await saveVideo({
          userUid,
          originalFilename: req.file?.originalname ?? req.file?.filename ?? 'upload',
          storedPath: null,
          status: 'completed',
          mediaType: req.file?.mimetype?.startsWith('audio/') ? 'audio' : 'video',
          format,
          durationSeconds: null,
          sizeBytes: req.file?.size ?? null,
          transcriptionId: null,
          subtitleJson: result.segments ? JSON.stringify(result.segments) : null,
        });
      } catch (videoError) {
        console.error('Failed to store video metadata:', videoError);
      }
    }

    emitStage("complete", "done");
    res.json({
      text: result.text,
      segments: result.segments,
      subtitle: result.subtitle,
      warnings: result.warnings,
      models: result.models,
      videoId: savedVideoId,
    });
  } catch (error) {
    if (userUid) {
      try {
        await saveVideo({
          userUid,
          originalFilename: req.file?.originalname ?? req.file?.filename ?? 'upload',
          storedPath: null,
          status: 'failed',
          mediaType: req.file?.mimetype?.startsWith('audio/') ? 'audio' : 'video',
          format,
          durationSeconds: null,
          sizeBytes: req.file?.size ?? null,
          transcriptionId: null,
          subtitleJson: null,
        });
      } catch (videoError) {
        console.error('Failed to store failed video metadata:', videoError);
      }
    }
    console.error("Unhandled error:", error);
    emitStage("complete", "error", error.message ?? "Internal Server Error");
    res.status(500).json({ error: error.message ?? "Internal Server Error" });
  } finally {
    await safeUnlink(req.file.path);
  }
});

httpServer.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

function createStageEmitter(socketId) {
  return (stage, status, message) => {
    if (!socketId) {
      return;
    }
    io.to(socketId).emit("transcribe-status", { stage, status, message });
  };
}

function createRequestLogger(req) {
  const requestId = req.headers["x-request-id"] ?? Date.now().toString(36);
  return {
    log: (...args) => console.log(`[${requestId}]`, ...args),
    warn: (...args) => console.warn(`[${requestId}]`, ...args),
    error: (...args) => console.error(`[${requestId}]`, ...args),
  };
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Failed to remove temp file:", error.message ?? error);
    }
  }
}










