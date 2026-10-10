import express from "express";
import { createVideoTokens, loadVideoSigningKey } from "./src/videoTokens.js";
import cors from "cors";
import { createMediaUpload, mediaUploadError } from "./src/mediaUpload.js";
import path from "path";
import os from "os";
import { createBunnyStreamStorage, createMediaStorage, localMediaPath, parseBunnyReference, serveBunnyMedia } from './src/bunnyStreamStorage.js';
import { promises as fsp } from "fs";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

import "./src/loadAppEnv.js";
import { transcribeMedia, normalizeSubtitleFormat, transcribeWithWordTimestamps, getMediaDuration, resegmentWithGPT, intelligentSplitSegment, aiEditSubtitles } from "./src/transcription.js";
import { parseTranscriptionSettings } from "./src/transcriptionSettings.js";
import { createBurnSubtitlesRouter } from "./routes/burnSubtitles.js";
import { createBurnSourceResolver } from './src/burnSource.js';
import { createVideoThumbnailHandler, withVideoThumbnail } from './src/videoThumbnails.js';
import { createThumbnailCache } from './src/thumbnailCache.js';
import paypalRouter from "./routes/paypal.js";
import pool from "./db.js";
import { createAdminStore } from "./src/adminStore.js";
import { createAdminRouter } from "./routes/admin.js";
import { createImpersonationSessions } from './src/impersonation.js';
import { createDownloadStore } from "./src/downloadStore.js";
import { createDownloadsRouter } from "./routes/downloads.js";
import { captureApiErrors, createClientErrorHandler, createErrorRecorder } from "./src/errorMonitoring.js";
import { createFirebaseVerifier, createIdentityMiddleware } from "./src/firebaseIdentity.js";
import { configureUsageRecorder, measureAICost, usageContext } from "./src/aiUsage.js";
import { ensureSchema, upsertUser, saveVideo, updateVideoSubtitles, getUserVideos, getVideoById, getUserCredits, deductCredits, ensureDevDummyUser, createTranscriptionJob, getTranscriptionJob, finishTranscriptionJob, updateTranscriptionProgress, completeTranscriptionJob } from "./db.js";
import { trackTranscriptionProgress } from "./src/transcriptionJobs.js";
import { estimateTranscriptionCredits, creditsToDollars, transcriptionCredits, workflowCost } from "./src/creditCalculator.js";
import { getDevAuthUid, isDevAuthBypassEnabled } from "./src/devAuth.js";
import { createPluginSessions, ensurePluginSchema, isPluginToken, pluginRouteAllowed } from './src/pluginSessions.js';
import { createPluginPublicRouter, createPluginPrivateRouter } from './routes/plugin.js';
import { createDiagnosticStore, startDiagnosticCleanup } from './src/pluginDiagnostics.js';
import { createConnectionStore, createConnectionIdentityVerifier, connectionBinding } from './src/accountConnections.js';
import { createConnectionsRouter } from './routes/connections.js';
import { currentTranscriptionModels, pluginPolicy, pluginVersionSupported } from './src/pluginPolicy.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : undefined;

const adminStore = createAdminStore(pool);
const impersonations = createImpersonationSessions(adminStore);
const downloadStore = createDownloadStore(pool);
const errorRecorder = createErrorRecorder(adminStore);
app.use(captureApiErrors(errorRecorder));
app.use(cors({ origin: allowedOrigins ?? true, exposedHeaders: ['Content-Disposition'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const uploadDir = path.join(os.tmpdir(), "subtitles-api-uploads");
const videosStorageDir = path.join(process.cwd(), "stored-videos");
const bunnyStorage = createBunnyStreamStorage();
const thumbnailCache = createThumbnailCache({ directory: path.join(videosStorageDir, '.thumbnails'), localDir: videosStorageDir, bunny: bunnyStorage });
const mediaStorage = createMediaStorage({ bunny: bunnyStorage, localDir: videosStorageDir });
await fsp.mkdir(uploadDir, { recursive: true });
await fsp.mkdir(videosStorageDir, { recursive: true });
await ensureSchema();
await ensurePluginSchema(pool);
const pluginSessions = createPluginSessions(pool);
// Resolve the shared media symlink: logs survive an in-place QA update, remain
// private, and do not accumulate inside release directories or public assets.
const pluginDiagnostics = createDiagnosticStore({ directory: path.join(path.dirname(await fsp.realpath(videosStorageDir)), 'plugin-diagnostics') });
startDiagnosticCleanup(pluginDiagnostics);
const verifyIdentity = createFirebaseVerifier({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID });
const connectionStore = createConnectionStore(pool);
const authenticate = createIdentityMiddleware(createConnectionIdentityVerifier(verifyIdentity, connectionStore));
app.use('/api/plugin/link', (req, res, next) => {
  if (req.headers['x-quick-caption-impersonation']) return res.status(403).json({ error: 'קישור תוסף אינו זמין בזמן התחזות.' });
  next();
}, createPluginPublicRouter({ sessions: pluginSessions, authenticate, upsertUser, getUserCredits }));
configureUsageRecorder(row => adminStore.recordUsage(row));
app.use(usageContext);
app.use('/api/admin', createAdminRouter({ authenticate, store: adminStore, downloadStore, impersonations }));
if (isDevAuthBypassEnabled()) {
  await ensureDevDummyUser({
    uid: getDevAuthUid(),
    email: "dev@localhost",
    displayName: "משתמש דמה",
  });
  console.log("Dev auth bypass enabled for local dummy user");
}

const videoTokens = createVideoTokens(await loadVideoSigningKey({ configuredKey: process.env.VIDEO_TOKEN_SECRET }));
const privateAuthenticate = async (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (isPluginToken(token)) {
    try {
      const identity = await pluginSessions.verify(token);
      if (!identity) return res.status(401).json({ error: 'החיבור פג או נותק. יש להתחבר מחדש', code: 'CONNECTION_REVOKED' });
      if (!pluginRouteAllowed(req.method, req.path)) return res.status(403).json({ error: 'הפעולה אינה זמינה לתוסף' });
      req.identity = identity;
      return next();
    } catch { return res.status(503).json({ error: 'החיבור לחשבון אינו זמין כרגע' }); }
  }
  if (isDevAuthBypassEnabled() && req.headers.authorization === 'Bearer local-development') {
    req.identity = { uid: getDevAuthUid() };
    return next();
  }
  return authenticate(req, res, next);
};
app.use('/api', async (req, res, next) => {
  if (req.method === 'GET' && req.path === '/payments/config') return next();
  const media = ['GET', 'HEAD'].includes(req.method) && req.path.match(/^\/videos\/(\d+)\/media$/);
  const grant = media && videoTokens.verify(req.query.mediaToken, 'media');
  if (grant && grant.videoId === Number(media[1]) && await impersonations.grantActive(grant, connectionStore)) {
    req.identity = { uid: grant.userUid };
    return next();
  }
  const thumbnail = ['GET', 'HEAD'].includes(req.method) && req.path.match(/^\/videos\/(\d+)\/thumbnail$/);
  const thumbnailGrant = thumbnail && videoTokens.verify(req.query.thumbnailToken, 'thumbnail');
  if (thumbnailGrant && thumbnailGrant.videoId === Number(thumbnail[1]) && await impersonations.grantActive(thumbnailGrant, connectionStore)) {
    req.identity = { uid: thumbnailGrant.userUid };
    return next();
  }
  privateAuthenticate(req, res, () => {
    impersonations.apply(req, res, () => {
      // Checkout handlers also derive ownership from this verified identity.
      if (req.body && typeof req.body === 'object') req.body.userUid = req.identity.uid;
      next();
    });
  });
});
const upload = createMediaUpload(uploadDir);
app.use('/api/connections', createConnectionsRouter({ store: connectionStore }));
app.use('/api/plugin', createPluginPrivateRouter({ sessions: pluginSessions, getUserCredits, getVideoById, diagnostics: pluginDiagnostics }));
app.post('/api/client-errors', createClientErrorHandler(errorRecorder));
app.use('/api/downloads', createDownloadsRouter({ store: downloadStore }));
app.use("/api/burn-subtitles", createBurnSubtitlesRouter(upload, {
  resolveVideo: createBurnSourceResolver({ getVideoById, bunny: bunnyStorage, localDir: videosStorageDir, tempDir: uploadDir }),
}));
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
  } = { ...req.body, ...req.identity };
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
  const userUid = req.identity.uid;

  if (!userUid) {
    return res.status(400).json({ error: 'userUid is required' });
  }

  try {
    const credits = await getUserCredits(userUid);
    if (credits === null) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.set('Cache-Control', 'private, no-store');
    res.json({ credits });
  } catch (error) {
    console.error('Failed to fetch user credits:', error);
    res.status(500).json({ error: 'Failed to fetch user credits' });
  }
});


app.get("/api/videos", async (req, res) => {
  const userUid = req.identity.uid;
  const limit = Math.min(99, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);

  if (!userUid) {
    return res.status(400).json({ error: 'userUid is required' });
  }

  try {
    const videos = await getUserVideos({ userUid, limit: limit + 1, offset });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ videos: videos.slice(0, limit).map(video => withVideoThumbnail(video, userUid, videoTokens, connectionBinding(req.identity))), hasMore: videos.length > limit });
    if (offset === 0) thumbnailCache.warm(videos);
  } catch (error) {
    console.error('Failed to fetch videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

app.get('/api/videos/:id/thumbnail', createVideoThumbnailHandler({ getVideoById, bunny: bunnyStorage, cache: thumbnailCache }));

// Secure video loading endpoint using token (must be before /api/videos/:id)
app.get("/api/videos/load", async (req, res) => {
  const token = req.query.token;
  const userUid = req.identity.uid;


  if (!token || !userUid) {
    return res.status(400).json({ error: 'token and userUid are required' });
  }

  try {
    const tokenData = videoTokens.verify(token, 'edit');
    if (!tokenData) return res.status(401).json({ error: 'Invalid or expired token' });

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
    res.json({ video, mediaToken: videoTokens.issue(video.id, userUid, 'media', undefined, connectionBinding(req.identity)) });
  } catch (error) {
    console.error('Failed to load video with token:', error);
    res.status(500).json({ error: 'Failed to load video' });
  }
});

app.get("/api/videos/:id", async (req, res) => {
  const videoId = Number.parseInt(req.params.id, 10);
  const userUid = req.identity.uid;

  if (!Number.isFinite(videoId) || !userUid) {
    return res.status(400).json({ error: 'videoId and userUid are required' });
  }

  try {
    const video = await getVideoById({ videoId, userUid });
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({ video, mediaToken: videoTokens.issue(video.id, userUid, 'media', undefined, connectionBinding(req.identity)) });
  } catch (error) {
    console.error('Failed to fetch video:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

app.get("/api/videos/:id/media", async (req, res) => {
  const videoId = Number.parseInt(req.params.id, 10);
  const userUid = req.identity.uid;

  if (!Number.isFinite(videoId) || !userUid) {
    return res.status(400).json({ error: 'videoId and userUid are required' });
  }

  try {
    const video = await getVideoById({ videoId, userUid });
    if (!video || !video.stored_path) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'private, no-store');
    if (parseBunnyReference(video.stored_path)) return await serveBunnyMedia(req, res, video, bunnyStorage);
    const fullPath = localMediaPath(videosStorageDir, video.stored_path);

    try {
      await fsp.access(fullPath);
    } catch {
      return res.status(404).json({ error: 'Video file not found on disk' });
    }

    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(fullPath);
  } catch (error) {
    console.error('Failed to serve video:', error);
    if (res.headersSent) return res.destroy();
    res.status(error.code === 'BUNNY_STORAGE_ERROR' ? error.status : 500).json({ error: error.code === 'BUNNY_STORAGE_ERROR' ? error.message : 'Failed to serve video' });
  }
});

app.put("/api/videos/:id/subtitles", async (req, res) => {
  const videoId = Number.parseInt(req.params.id, 10);
  const { subtitleJson, wordsJson } = req.body ?? {};
  const userUid = req.identity.uid;

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
  const userUid = req.identity.uid;

  if (!Number.isFinite(videoId) || !userUid) {
    return res.status(400).json({ error: 'videoId and userUid are required' });
  }

  try {
    // Verify user owns the video
    const video = await getVideoById({ videoId, userUid });
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const token = videoTokens.issue(videoId, userUid, 'edit');
    res.json({ token, mediaToken: videoTokens.issue(videoId, userUid, 'media', undefined, connectionBinding(req.identity)) });
  } catch (error) {
    console.error('Failed to generate video token:', error);
    res.status(500).json({ error: 'Failed to generate video token' });
  }
});

// Secure subtitle update endpoint using token
app.put("/api/videos/update-subtitles", async (req, res) => {
  const { token, subtitleJson, wordsJson } = req.body ?? {};
  const userUid = req.identity.uid;

  if (!token || !userUid || typeof subtitleJson !== 'string') {
    return res.status(400).json({ error: 'token, userUid and subtitleJson are required' });
  }

  try {
    const tokenData = videoTokens.verify(token, 'edit');
    if (!tokenData) return res.status(401).json({ error: 'Invalid or expired token' });

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
  const userUid = req.identity.uid;

  if (!Number.isFinite(videoId) || !userUid) {
    return res.status(400).json({ error: 'videoId and userUid are required' });
  }

  try {
    const video = await getVideoById({ videoId, userUid });
    if (!video || !video.stored_path) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'private, no-store');
    if (parseBunnyReference(video.stored_path)) return await serveBunnyMedia(req, res, video, bunnyStorage);
    const fullPath = localMediaPath(videosStorageDir, video.stored_path);

    try {
      await fsp.access(fullPath);
    } catch {
      return res.status(404).json({ error: 'Video file not found on disk' });
    }

    res.set('Referrer-Policy', 'no-referrer');
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(fullPath);
  } catch (error) {
    console.error('Failed to serve video file:', error);
    if (res.headersSent) return res.destroy();
    res.status(error.code === 'BUNNY_STORAGE_ERROR' ? error.status : 500).json({ error: error.code === 'BUNNY_STORAGE_ERROR' ? error.message : 'Failed to serve video file' });
  }
});

app.get("/api/transcribe/jobs/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const userUid = req.identity.uid;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(jobId) || typeof userUid !== "string" || !userUid) {
    return res.status(400).json({ error: "Valid jobId and userUid are required" });
  }
  try {
    const job = await getTranscriptionJob({ jobId, userUid });
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.set('Cache-Control', 'no-store');
    res.json({
      status: job.status,
      creditsRemaining: await getUserCredits(userUid),
      result: job.status === "completed" ? (() => {
        const result = JSON.parse(job.result_json);
        return { ...result, mediaToken: result.videoId ? videoTokens.issue(result.videoId, userUid, 'media', undefined, connectionBinding(req.identity)) : undefined };
      })() : undefined,
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
  const userUid = req.identity.uid;
  const jobId = req.body?.jobId;
  if (req.identity.pluginSessionId && !pluginVersionSupported(req.headers['x-quick-caption-version'])) {
    if (req.file) await safeUnlink(req.file.path);
    return res.status(426).json({ code: 'PLUGIN_UPDATE_REQUIRED', error: 'נדרש עדכון לתוסף לפני תמלול' });
  }
  if (req.identity.pluginSessionId && (!jobId || req.body?.billingPolicyVersion !== pluginPolicy().version)) {
    if (req.file) await safeUnlink(req.file.path);
    return res.status(409).json({ code: 'POLICY_CHANGED', error: 'יש לרענן את המחיר ולאשר שוב לפני תמלול' });
  }
  let settings;
  try { settings = parseTranscriptionSettings(req.body); }
  catch (error) {
    if (req.file) await safeUnlink(req.file.path);
    return res.status(400).json({ error: error.message });
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
      if (error.code === 'ER_DUP_ENTRY') {
        const existing = await getTranscriptionJob({ jobId, userUid });
        if (existing) return res.status(202).json({ jobId, status: existing.status, replayed: true });
        return res.status(409).json({ error: 'מזהה המשימה אינו זמין' });
      }
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
    estimatedCredits = estimateTranscriptionCredits(durationMinutes, currentTranscriptionModels());

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
  let storedPath = null;
  try {
    // Remote persistence is mandatory for new videos and happens before paid AI
    // processing. The uploaded local file is only a temporary working copy.
    storedPath = await mediaStorage.persist(req.file, originalFilename);
    if (parseBunnyReference(storedPath)) await thumbnailCache.prime(storedPath, req.file.path).catch(error => console.warn('Upload cover generation deferred:', error.code ?? error.name));
    emitStage("upload", "done");
    const { value: result, costUSD: measuredCostUSD, unpricedCalls } = await measureAICost(() => transcribeMedia({
      inputPath: req.file.path,
      format,
      ...settings,
      logger: createRequestLogger(req),
      onStage: emitStage,
    }));

    savedVideoId = await saveVideo({
      userUid,
      originalFilename,
      storedPath,
      status: 'completed',
      mediaType: req.file.mimetype?.startsWith('audio/') ? 'audio' : 'video',
      mimeType: req.file.mimetype ?? null,
      format,
      durationSeconds: Number.isFinite(durationSeconds) ? Math.round(durationSeconds) : null,
      sizeBytes: req.file.size ?? null,
      transcriptionId: null,
      subtitleJson: result.segments ? JSON.stringify(result.segments) : null,
      wordsJson: result.words ? JSON.stringify(result.words) : null,
    });

    // Calculate actual credits used based on API usage
    const actualCredits = transcriptionCredits(result.usage || {}, measuredCostUSD);
    console.log(`Actual credits used: ${actualCredits} credits (${creditsToDollars(actualCredits)}) for AI cost $${measuredCostUSD.toFixed(4)} measured, $${workflowCost(result.usage || {}).toFixed(4)} by stage, ${unpricedCalls} unpriced call(s)`);
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
          storedPath,
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
        if (storedPath) {
          try { await mediaStorage.remove(storedPath); }
          catch (cleanupError) { console.error('Failed to remove untracked media:', { code: cleanupError.code }); }
        }
      }
    }
    console.error("Transcription failed:", { status: error.status, code: error.code });
    const message = savedVideoId ? "הסרטון נשמר ב׳הסרטונים שלי׳, אך עדכון מצב העיבוד נכשל. אפשר לפתוח אותו משם."
      : error.code === 'BUNNY_STORAGE_ERROR' ? error.message
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

  let storedPath = null;
  let savedVideoId = null;
  try {
    storedPath = await mediaStorage.persist(req.file, req.file.originalname);
    if (parseBunnyReference(storedPath)) await thumbnailCache.prime(storedPath, req.file.path).catch(error => console.warn('Upload cover generation deferred:', error.code ?? error.name));
    const result = await transcribeWithWordTimestamps({
      inputPath: req.file.path,
      logger: createRequestLogger(req),
    });

    savedVideoId = await saveVideo({ userUid: req.identity.uid, originalFilename: req.file.originalname,
      storedPath, mediaType: req.file.mimetype?.startsWith('audio/') ? 'audio' : 'video',
      mimeType: req.file.mimetype, sizeBytes: req.file.size, format: '.srt',
      subtitleJson: JSON.stringify(result.segments ?? []), wordsJson: JSON.stringify(result.words ?? []) });
    res.json({
      videoId: savedVideoId,
      text: result.text,
      segments: result.segments,
      words: result.words,
      formattedOutput: result.formattedOutput,
    });
  } catch (error) {
    if (storedPath && !savedVideoId) {
      try { await mediaStorage.remove(storedPath); }
      catch (cleanupError) { console.error('Failed to remove untracked word-transcription media:', { code: cleanupError.code }); }
    }
    console.error("Word transcription error:", error);
    res.status(500).json({ error: error.message ?? "Internal Server Error" });
  } finally {
    await safeUnlink(req.file.path);
  }
});

// Serve static files from the React app build directory
app.use(express.static(path.join(process.cwd(), 'dist')));

// Handle all unhandled routes by serving the React app
app.use(mediaUploadError);
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status >= 400 && error.status <= 599 ? error.status : 500;
  res.status(status).json({ error: status === 500 ? 'אירעה שגיאה בשרת. אפשר לנסות שוב.' : 'הבקשה אינה תקינה.' });
});

// This must be after all API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'נתיב ה־API לא נמצא.' }));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
});

httpServer.listen(port, () => {
  console.log(`Server listening on http://localhost:${httpServer.address().port}`);
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










