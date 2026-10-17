import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { MAX_MEDIA_BYTES, MEDIA_SIZE_ERROR } from './mediaPolicy.js';

export function createMediaUpload(dest, maxBytes = MAX_MEDIA_BYTES) {
  // Multer/Busboy releases differ at equality. Bound the stream, then enforce
  // the inclusive advertised limit independently of that boundary behavior.
  const bounded = receive => (req, res, next) => receive(req, res, async error => {
    if (error) return next(error);
    const files = [req.file, ...Object.values(req.files ?? {}).flat()].filter(Boolean);
    const oversized = files.find(file => file.size > maxBytes);
    if (!oversized) return next();
    try { await Promise.all(files.map(file => unlink(file.path))); }
    catch (cleanupError) { if (cleanupError.code !== 'ENOENT') return next(cleanupError); }
    next(new multer.MulterError('LIMIT_FILE_SIZE', oversized.fieldname));
  });
  return {
    single: field => bounded(multer({ dest, limits: { fileSize: maxBytes + 1, files: 1 } }).single(field)),
    fields: fields => bounded(multer({ dest, limits: { fileSize: maxBytes + 1, files: fields.reduce((total, field) => total + (field.maxCount ?? 1), 0) } }).fields(fields)),
  };
}

export function mediaUploadError(error, _req, res, next) {
  if (!(error instanceof multer.MulterError)) return next(error);
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: MEDIA_SIZE_ERROR, code: error.code, maxBytes: MAX_MEDIA_BYTES });
  return res.status(400).json({ error: 'אפשר להעלות קובץ מדיה אחד בכל פעם.', code: error.code });
}
