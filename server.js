import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import os from "os";
import crypto from "crypto";
import { promises as fsp } from "fs";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

import "./src/loadAppEnv.js";
import { transcribeMedia, normalizeSubtitleFormat, transcribeWithWordTimestamps, getMediaDuration, resegmentWithGPT, intelligentSplitSegment, aiEditSubtitles } from "./src/transcription.js";
import { createBurnSubtitlesRouter } from "./routes/burnSubtitles.js";
import paypalRouter from "./routes/paypal.js";
import { ensureSchema, upsertUser, saveVideo, updateVideoSubtitles, getUserVideos, getVideoById, getUserCredits, deductCredits, ensureDevDummyUser, createTranscriptionJob, getTranscriptionJob, finishTranscriptionJob, updateTranscriptionProgress, completeTranscriptionJob } from "./db.js";
import { trackTranscriptionProgress } from "./src/transcriptionJobs.js";
import { estimateTranscriptionCredits, creditsToDollars, calculateTotalWorkflowCredits } from "./src/creditCalculator.js";
import { getDevAuthUid, isDevAuthBypassEnabled } from "./src/devAuth.js";

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
if (isDevAuthBypassEnabled()) {
  await ensureDevDummyUser({
    uid: getDevAuthUid(),
    email: "dev@localhost",
    displayName: "משתמש דמה",
  });
  console.log("Dev auth bypass enabled for local dummy user");
}

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
app.use("/api/payments", paypalRouter);

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

app.get("/api/users/credits", async (req, res) => {
  const userUid = req.query.userUid;

  if (!userUid) {
    return res.status(400).json({ error: 'userUid is required' });
  }

  try {
    const credits = await getUserCredits(userUid);
    if (credits === null) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ credits });
  } catch (error) {
    console.error('Failed to fetch user credits:', error);
    res.status(500).json({ error: 'Failed to fetch user credits' });
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
  const { userUid, subtitleJson, wordsJson } = req.body ?? {};

  if (!Number.isFinite(videoId) || !userUid || typeof subtitleJson !== 'string') {
    return res.status(400).json({ error: 'videoId, userUid and subtitleJson are required' });
  }

  try {
    const result = await updateVideoSubtitles({ videoId, userUid, subtitleJson, wordsJson });
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
  const { token, userUid, subtitleJson, wordsJson } = req.body ?? {};

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
      subtitleJson,
      wordsJson: wordsJson ? wordsJson : undefined
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

app.get("/api/transcribe/jobs/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const { userUid } = req.query;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(jobId) || typeof userUid !== "string" || !userUid) {
    return res.status(400).json({ error: "Valid jobId and userUid are required" });
  }
  try {
    const job = await getTranscriptionJob({ jobId, userUid });
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.set('Cache-Control', 'no-store');
    res.json({
      status: job.status,
      result: job.status === "completed" ? JSON.parse(job.result_json) : undefined,
      error: job.status === "failed" ? job.error_message : undefined,
      stages: typeof job.stages_json === 'string' ? JSON.parse(job.stages_json) : job.stages_json ?? [],
    });
  } catch (error) {
    console.error("Failed to fetch transcription job:", error);
    res.status(500).json({ error: "Failed to fetch transcription job" });
  }
});

app.post("/api/transcribe", upload.single("media"), async (req, res) => {
  const socketId = req.body?.socketId;
  const userUid = req.body?.userUid;
  const jobId = req.body?.jobId;
  const maxWordsPerSubtitle = parseInt(req.body?.maxWordsPerSubtitle, 10) || 5;
  const rawCharacters = req.body?.maxCharactersPerSubtitle;
  const maxCharactersPerSubtitle = rawCharacters === undefined ? null : Number(rawCharacters);
  if (maxCharactersPerSubtitle !== null && (!Number.isInteger(maxCharactersPerSubtitle) || maxCharactersPerSubtitle < 7 || maxCharactersPerSubtitle > 20)) {
    if (req.file) await safeUnlink(req.file.path);
    return res.status(400).json({ error: "מגבלת התווים חייבת להיות בין 7 ל־20" });
  }
  let emitStage = createStageEmitter(socketId, jobId);

  if (!req.file) {
    emitStage("complete", "error", "נדרש קובץ מדיה");
    return res.status(400).json({ error: 'Media file is required under field name "media".' });
  }

  if (!userUid) {
    emitStage("complete", "error", "נדרש מזהה משתמש");
    await safeUnlink(req.file.path);
    return res.status(400).json({ error: 'userUid is required for credit check' });
  }

  if (jobId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(jobId)) {
    await safeUnlink(req.file.path);
    return res.status(400).json({ error: 'Invalid jobId' });
  }
  if (jobId) {
    try {
      await createTranscriptionJob({ jobId, userUid });
    } catch (error) {
      await safeUnlink(req.file.path);
      console.error("Failed to create transcription job:", error);
      return res.status(500).json({ error: "Failed to start transcription job" });
    }
  }
  const progressTracker = jobId ? trackTranscriptionProgress({
    update: stages => updateTranscriptionProgress(jobId, stages),
    emit: emitStage,
  }) : null;
  if (progressTracker) emitStage = progressTracker.emit;
  const failJob = async (message) => {
    if (!jobId) return;
    await progressTracker?.stop();
    try {
      await finishTranscriptionJob({ jobId, error: message });
    } catch (error) {
      console.error("Failed to record transcription error:", error);
    }
  };

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
    await failJob(error.message);
    await safeUnlink(req.file.path);
    return res.status(400).json({ error: error.message });
  }

  // Check if user has minimum credits (estimate for pre-check only)
  let durationSeconds = null;
  let estimatedCredits = 0;
  try {
    // Get media duration for credit estimation
    durationSeconds = await getMediaDuration(req.file.path);
    const durationMinutes = durationSeconds / 60;

    // Get transcription options to estimate cost
    const timedModel = process.env.OPENAI_TIMED_MODEL ?? "whisper-1";
    const highAccuracyModel = process.env.OPENAI_HIGH_ACCURACY_MODEL ?? "gpt-4o-transcribe";
    const correctionModel = process.env.OPENAI_CORRECTION_MODEL ?? "gpt-5";

    estimatedCredits = estimateTranscriptionCredits(durationMinutes, {
      timedModel,
      highAccuracyModel,
      correctionModel,
      serviceTier: process.env.OPENAI_TEXT_SERVICE_TIER,
    });

    console.log(`Estimated credits for ${durationMinutes.toFixed(2)} minutes: ${estimatedCredits} credits (${creditsToDollars(estimatedCredits)})`);

    // Check if user has enough credits (pre-check only, actual deduction after API response)
    const currentCredits = await getUserCredits(userUid);
    if (currentCredits === null) {
      emitStage("complete", "error", "משתמש לא נמצא");
      await failJob("משתמש לא נמצא");
      await safeUnlink(req.file.path);
      return res.status(404).json({ error: 'User not found' });
    }

    if (currentCredits < estimatedCredits) {
      const shortfall = estimatedCredits - currentCredits;
      emitStage("complete", "error", `אין מספיק קרדיטים. נדרשים ${estimatedCredits} קרדיטים, יש לך ${currentCredits}`);
      await failJob("אין מספיק קרדיטים לביצוע הפעולה.");
      await safeUnlink(req.file.path);
      return res.status(402).json({
        error: 'Insufficient credits',
        required: estimatedCredits,
        available: currentCredits,
        shortfall: shortfall,
        cost: creditsToDollars(estimatedCredits),
      });
    }

    console.log(`User has sufficient credits (${currentCredits} >= ${estimatedCredits}). Proceeding with transcription.`);
  } catch (error) {
    console.error("Credit check failed:", error);
    emitStage("complete", "error", "בדיקת קרדיטים נכשלה");
    await failJob("בדיקת קרדיטים נכשלה");
    await safeUnlink(req.file.path);
    return res.status(500).json({ error: 'Credit check failed' });
  }

  let savedVideoId = null;
  try {
    const result = await transcribeMedia({
      inputPath: req.file.path,
      format,
      maxWordsPerSubtitle,
      maxCharactersPerSubtitle,
      logger: createRequestLogger(req),
      onStage: emitStage,
    });

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
          storedPath: path.basename(storedPath),
          status: 'completed',
          mediaType: req.file?.mimetype?.startsWith('audio/') ? 'audio' : 'video',
          mimeType: req.file?.mimetype ?? null,
          format,
          durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
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
        throw videoError;
      }
    }

    // Calculate actual credits used based on API usage
    const actualCredits = calculateTotalWorkflowCredits(result.usage || {});
    console.log(`Actual credits used: ${actualCredits} credits (${creditsToDollars(actualCredits)})`);
    console.log(`Usage breakdown:`, JSON.stringify(result.usage, null, 2));

    // Deduct actual credits
    let payload = {
      text: result.text,
      originalFilename,
      segments: result.segments,
      words: result.words ?? [],
      subtitle: result.subtitle,
      warnings: result.warnings,
      models: result.models,
      videoId: savedVideoId,
    };
    await progressTracker?.stop();
    if (jobId) {
      payload = await completeTranscriptionJob({ jobId, userUid, result: payload, credits: actualCredits });
    } else {
      const deducted = await deductCredits(userUid, actualCredits);
      payload = { ...payload, creditsUsed: deducted.success ? actualCredits : 0, creditsRemaining: deducted.newBalance };
    }
    createStageEmitter(socketId, jobId)("complete", "done");
    res.json(payload);
  } catch (error) {
    if (userUid && !savedVideoId) {
      try {
        await saveVideo({
          userUid,
          originalFilename,
          storedPath: null,
          status: 'failed',
          mediaType: req.file?.mimetype?.startsWith('audio/') ? 'audio' : 'video',
          mimeType: req.file?.mimetype ?? null,
          format,
          durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
          sizeBytes: req.file?.size ?? null,
          transcriptionId: null,
          subtitleJson: null,
        });
      } catch (videoError) {
        console.error('Failed to store failed video metadata:', videoError);
      }
    }
    console.error("Transcription failed:", { status: error.status, code: error.code });
    const message = savedVideoId ? "הסרטון נשמר ב׳הסרטונים שלי׳, אך עדכון מצב העיבוד נכשל. אפשר לפתוח אותו משם."
      : error.status === 401 || /incorrect api key|invalid_api_key/i.test(error.message ?? "")
      ? "שירות התמלול אינו זמין: מפתח הגישה של השרת נדחה. יש לעדכן את הגדרת השירות ולנסות שוב."
      : "התמלול נכשל. בדקו שקובץ המדיה תקין ונסו שוב.";
    emitStage("complete", "error", message);
    await failJob(message);
    res.status(500).json({ error: message });
  } finally {
    await progressTracker?.stop();
    await safeUnlink(req.file.path);
  }
});

// AI-powered resegmentation endpoint
app.post("/api/resegment", async (req, res) => {
  const { words, maxWords, customInstructions } = req.body ?? {};

  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: "words array is required" });
  }

  if (!Number.isFinite(maxWords) || maxWords < 1) {
    return res.status(400).json({ error: "maxWords must be a positive number" });
  }

  try {
    const segments = await resegmentWithGPT(words, maxWords, { customInstructions });
    res.json({ segments });
  } catch (error) {
    console.error("Resegmentation failed:", error);
    res.status(500).json({ error: error.message ?? "Resegmentation failed" });
  }
});

// AI-powered subtitle editing endpoint
app.post("/api/ai-edit-subtitles", async (req, res) => {
  const { segments, words, instructions } = req.body ?? {};

  if (!Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: "segments array is required" });
  }

  if (!instructions || typeof instructions !== "string") {
    return res.status(400).json({ error: "instructions string is required" });
  }

  try {
    const result = await aiEditSubtitles(segments, words || [], instructions);
    res.json(result);
  } catch (error) {
    console.error("AI edit subtitles failed:", error);
    res.status(500).json({ error: error.message ?? "AI edit failed" });
  }
});

// AI-powered intelligent split endpoint
app.post("/api/split-segment", async (req, res) => {
  const { segment, words, splitTime } = req.body ?? {};

  if (!segment || typeof segment.id === "undefined") {
    return res.status(400).json({ error: "segment object is required" });
  }

  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: "words array is required" });
  }

  if (typeof splitTime !== "number") {
    return res.status(400).json({ error: "splitTime is required" });
  }

  try {
    const result = await intelligentSplitSegment(segment, words, splitTime);
    res.json(result);
  } catch (error) {
    console.error("Intelligent split failed:", error);
    res.status(500).json({ error: error.message ?? "Intelligent split failed" });
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

function createStageEmitter(socketId, jobId) {
  return (stage, status, message) => {
    if (!socketId) {
      return;
    }
    io.to(socketId).emit("transcribe-status", { stage, status, message, jobId });
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










