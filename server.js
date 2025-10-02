import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import os from "os";
import crypto from "crypto";
import { promises as fsp } from "fs";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";

import { transcribeMedia, normalizeSubtitleFormat, transcribeWithWordTimestamps } from "./src/transcription.js";
import { createBurnSubtitlesRouter } from "./routes/burnSubtitles.js";
import { ensureSchema, upsertUser, saveVideo, updateVideoSubtitles, getUserVideos, getVideoById } from "./db.js";


dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3000);

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : undefined;

app.use(cors({ origin: allowedOrigins ?? true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const uploadDir = path.join(os.tmpdir(), "subtitles-api-uploads");
const videosStorageDir = path.join(process.cwd(), "stored-videos");
await fsp.mkdir(uploadDir, { recursive: true });
await fsp.mkdir(videosStorageDir, { recursive: true });
await ensureSchema();

const upload = multer({
  dest: uploadDir,
  // Ensure proper filename handling
  fileFilter: (req, file, cb) => {
    // Log original filename for debugging
    console.log('Multer received filename:', {
      originalname: file.originalname,
      encoding: file.encoding,
      mimetype: file.mimetype,
      bytes: file.originalname ? Array.from(file.originalname).map(c => c.charCodeAt(0)) : []
    });
    cb(null, true);
  }
});
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


app.get("/api/videos", async (req, res) => {
  const userUid = req.query.userUid;
  const limit = Number.parseInt(req.query.limit, 10) || 50;
  const offset = Number.parseInt(req.query.offset, 10) || 0;

  if (!userUid) {
    return res.status(400).json({ error: 'userUid is required' });
  }

  try {
    const videos = await getUserVideos({ userUid, limit, offset });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ videos });
  } catch (error) {
    console.error('Failed to fetch videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// Secure video loading endpoint using token (must be before /api/videos/:id)
app.get("/api/videos/load", async (req, res) => {
  const token = req.query.token;
  const userUid = req.query.userUid;

  console.log('Load video request:', { token, userUid, query: req.query });

  if (!token || !userUid) {
    return res.status(400).json({ error: 'token and userUid are required' });
  }

  try {
    // Decode and validate token
    let tokenData;
    try {
      tokenData = JSON.parse(Buffer.from(token, 'base64url').toString());
    } catch {
      return res.status(400).json({ error: 'Invalid token format' });
    }

    // Check token expiration
    if (!tokenData.exp || tokenData.exp < Date.now()) {
      return res.status(401).json({ error: 'Token expired' });
    }

    // Verify user matches token
    if (tokenData.userUid !== userUid) {
      return res.status(403).json({ error: 'Token user mismatch' });
    }

    // Load video with ownership verification
    const video = await getVideoById({ videoId: tokenData.videoId, userUid });
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ video });
  } catch (error) {
    console.error('Failed to load video with token:', error);
    res.status(500).json({ error: 'Failed to load video' });
  }
});

app.get("/api/videos/:id", async (req, res) => {
  const videoId = Number.parseInt(req.params.id, 10);
  const userUid = req.query.userUid;

  if (!Number.isFinite(videoId) || !userUid) {
    return res.status(400).json({ error: 'videoId and userUid are required' });
  }

  try {
    const video = await getVideoById({ videoId, userUid });
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ video });
  } catch (error) {
    console.error('Failed to fetch video:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

app.get("/api/videos/:id/media", async (req, res) => {
  const videoId = Number.parseInt(req.params.id, 10);
  const userUid = req.query.userUid;

  if (!Number.isFinite(videoId) || !userUid) {
    return res.status(400).json({ error: 'videoId and userUid are required' });
  }

  try {
    const video = await getVideoById({ videoId, userUid });
    if (!video || !video.stored_path) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    const fullPath = path.join(videosStorageDir, video.stored_path);

    try {
      await fsp.access(fullPath);
    } catch {
      return res.status(404).json({ error: 'Video file not found on disk' });
    }

    res.sendFile(fullPath);
  } catch (error) {
    console.error('Failed to serve video:', error);
    res.status(500).json({ error: 'Failed to serve video' });
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

// Secure token generation for video editing
app.get("/api/videos/:id/token", async (req, res) => {
  const videoId = Number.parseInt(req.params.id, 10);
  const userUid = req.query.userUid;

  if (!Number.isFinite(videoId) || !userUid) {
    return res.status(400).json({ error: 'videoId and userUid are required' });
  }

  try {
    // Verify user owns the video
    const video = await getVideoById({ videoId, userUid });
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Generate secure token with expiration (24 hours)
    const tokenData = {
      videoId,
      userUid,
      exp: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
      random: crypto.randomBytes(16).toString('hex')
    };

    const token = Buffer.from(JSON.stringify(tokenData)).toString('base64url');
    res.json({ token });
  } catch (error) {
    console.error('Failed to generate video token:', error);
    res.status(500).json({ error: 'Failed to generate video token' });
  }
});

// Secure subtitle update endpoint using token
app.put("/api/videos/update-subtitles", async (req, res) => {
  const { token, userUid, subtitleJson } = req.body ?? {};

  if (!token || !userUid || typeof subtitleJson !== 'string') {
    return res.status(400).json({ error: 'token, userUid and subtitleJson are required' });
  }

  try {
    // Decode and validate token
    let tokenData;
    try {
      tokenData = JSON.parse(Buffer.from(token, 'base64url').toString());
    } catch {
      return res.status(400).json({ error: 'Invalid token format' });
    }

    // Check token expiration
    if (!tokenData.exp || tokenData.exp < Date.now()) {
      return res.status(401).json({ error: 'Token expired' });
    }

    // Verify user matches token
    if (tokenData.userUid !== userUid) {
      return res.status(403).json({ error: 'Token user mismatch' });
    }

    // Update subtitles with ownership verification
    const result = await updateVideoSubtitles({
      videoId: tokenData.videoId,
      userUid,
      subtitleJson
    });

    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Failed to update subtitles with token:', error);
    res.status(500).json({ error: 'Failed to update subtitles' });
  }
});

// Secure video file access endpoint using token
app.get("/api/videos/:id/file", async (req, res) => {
  const videoId = Number.parseInt(req.params.id, 10);
  const userUid = req.query.userUid;

  if (!Number.isFinite(videoId) || !userUid) {
    return res.status(400).json({ error: 'videoId and userUid are required' });
  }

  try {
    const video = await getVideoById({ videoId, userUid });
    if (!video || !video.stored_path) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    const fullPath = path.join(videosStorageDir, video.stored_path);

    try {
      await fsp.access(fullPath);
    } catch {
      return res.status(404).json({ error: 'Video file not found on disk' });
    }

    res.sendFile(fullPath);
  } catch (error) {
    console.error('Failed to serve video file:', error);
    res.status(500).json({ error: 'Failed to serve video file' });
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

  // Fix filename encoding - multer often corrupts UTF-8 filenames
  let originalFilename = req.file.originalname;
  if (originalFilename) {
    try {
      // Try to detect and fix common encoding issues
      if (originalFilename.includes('Ã') || originalFilename.includes('×')) {
        // Common corruption: UTF-8 decoded as Latin-1 then re-encoded
        const buffer = Buffer.from(originalFilename, 'latin1');
        const fixed = buffer.toString('utf8');
        if (fixed && !fixed.includes('�')) { // Check for replacement characters
          originalFilename = fixed;
          console.log('Fixed filename encoding:', { original: req.file.originalname, fixed });
        }
      }

      // Additional fix attempt for Hebrew characters
      if (originalFilename.includes('×')) {
        // Try decoding as different encodings
        const attempts = ['utf8', 'latin1', 'ascii'];
        for (const encoding of attempts) {
          try {
            const testBuffer = Buffer.from(originalFilename, encoding);
            const testDecoded = testBuffer.toString('utf8');
            if (testDecoded && !testDecoded.includes('�') && testDecoded.includes('ס')) {
              originalFilename = testDecoded;
              console.log('Fixed Hebrew filename:', { original: req.file.originalname, fixed: originalFilename, encoding });
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
    } catch (err) {
      console.warn('Could not fix filename encoding:', err);
    }
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
    let storedPath = null;
    if (userUid && req.file) {
      try {
        // Create unique filename with timestamp and random suffix
        const timestamp = Date.now();
        const randomSuffix = crypto.randomBytes(4).toString('hex');

        // Get file extension safely
        const ext = path.extname(originalFilename || req.file.filename || '.mp4');
        const baseName = path.basename(originalFilename || req.file.filename || 'upload', ext);

        // Create sanitized but readable filename (preserve Hebrew if possible)
        let sanitizedBaseName;
        try {
          // Try to keep Hebrew characters readable
          sanitizedBaseName = baseName
            .replace(/[<>:"/\\|?*]/g, '_') // Remove forbidden characters but keep Hebrew
            .replace(/\s+/g, '_') // Replace spaces with underscores
            .substring(0, 50); // Limit length
        } catch (e) {
          // Fallback to ASCII-safe version
          sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 50);
        }

        const storedFilename = `${userUid}_${timestamp}_${randomSuffix}_${sanitizedBaseName}${ext}`;
        storedPath = path.join(videosStorageDir, storedFilename);

        // Ensure the path doesn't already exist (double-check uniqueness)
        let uniqueStoredPath = storedPath;
        let counter = 1;
        while (true) {
          try {
            await fsp.access(uniqueStoredPath);
            // File exists, try next number
            const uniqueFilename = `${userUid}_${timestamp}_${randomSuffix}_${counter}_${sanitizedBaseName}${ext}`;
            uniqueStoredPath = path.join(videosStorageDir, uniqueFilename);
            counter++;
          } catch {
            // File doesn't exist, we can use this path
            break;
          }
        }
        storedPath = uniqueStoredPath;

        await fsp.copyFile(req.file.path, storedPath);

        savedVideoId = await saveVideo({
          userUid,
          originalFilename,
          storedPath: storedFilename,
          status: 'completed',
          mediaType: req.file?.mimetype?.startsWith('audio/') ? 'audio' : 'video',
          mimeType: req.file?.mimetype ?? null,
          format,
          durationSeconds: null,
          sizeBytes: req.file?.size ?? null,
          transcriptionId: null,
          subtitleJson: result.segments ? JSON.stringify(result.segments) : null,
          wordsJson: result.words ? JSON.stringify(result.words) : null,
        });
      } catch (videoError) {
        console.error('Failed to store video metadata:', videoError);
        if (storedPath) {
          await safeUnlink(storedPath);
        }
      }
    }

    emitStage("complete", "done");
    res.json({
      text: result.text,
      segments: result.segments,
      words: result.words ?? [],
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
          originalFilename,
          storedPath: null,
          status: 'failed',
          mediaType: req.file?.mimetype?.startsWith('audio/') ? 'audio' : 'video',
          mimeType: req.file?.mimetype ?? null,
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

// Word-level timestamp transcription endpoint
app.post("/api/transcribe-words", upload.single("media"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Media file is required under field name "media".' });
  }

  try {
    const result = await transcribeWithWordTimestamps({
      inputPath: req.file.path,
      logger: createRequestLogger(req),
    });

    res.json({
      text: result.text,
      segments: result.segments,
      words: result.words,
      formattedOutput: result.formattedOutput,
    });
  } catch (error) {
    console.error("Word transcription error:", error);
    res.status(500).json({ error: error.message ?? "Internal Server Error" });
  } finally {
    await safeUnlink(req.file.path);
  }
});

// Serve static files from the React app build directory
app.use(express.static(path.join(process.cwd(), 'dist')));

// Handle all unhandled routes by serving the React app
// This must be after all API routes
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
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










