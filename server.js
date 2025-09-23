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

const upload = multer({ dest: uploadDir });

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: allowedOrigins ?? ["http://localhost:5173", "http://127.0.0.1:5173"],
  },
});

aio.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/transcribe", upload.single("media"), async (req, res) => {
  const socketId = req.body?.socketId;
  const emitStage = createStageEmitter(socketId);

  if (!req.file) {
    emitStage("complete", "error", "לא התקבל קובץ להעלאה");
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

    emitStage("complete", "done");
    res.json({
      text: result.text,
      segments: result.segments,
      subtitle: result.subtitle,
      warnings: result.warnings,
      models: result.models,
    });
  } catch (error) {
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
