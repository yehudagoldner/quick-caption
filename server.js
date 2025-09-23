import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import os from 'os';
import { promises as fsp } from 'fs';
import dotenv from 'dotenv';

import { transcribeMedia, normalizeSubtitleFormat } from './src/transcription.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(express.json());

const uploadDir = path.join(os.tmpdir(), 'subtitles-api-uploads');
await fsp.mkdir(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/transcribe', upload.single('media'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Media file is required under field name "media".' });
  }

  const formatInput = req.body?.format;
  let format = '.srt';

  try {
    if (formatInput) {
      format = normalizeSubtitleFormat(formatInput);
    }
  } catch (error) {
    await safeUnlink(req.file.path);
    return res.status(400).json({ error: error.message });
  }

  try {
    const result = await transcribeMedia({
      inputPath: req.file.path,
      format,
      logger: createRequestLogger(req),
    });

    res.json({
      text: result.text,
      segments: result.segments,
      subtitle: result.subtitle,
      warnings: result.warnings,
      models: result.models,
    });
  } catch (error) {
    next(error);
  } finally {
    await safeUnlink(req.file.path);
  }
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message ?? 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

function createRequestLogger(req) {
  const requestId = req.headers['x-request-id'] ?? Date.now().toString(36);
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
    if (error.code !== 'ENOENT') {
      console.warn('Failed to remove temp file:', error.message ?? error);
    }
  }
}
