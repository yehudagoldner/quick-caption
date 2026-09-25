import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { MAX_MEDIA_BYTES, MEDIA_SIZE_ERROR } from './mediaPolicy.js';

export function createMediaUpload(dest, maxBytes = MAX_MEDIA_BYTES) {
  // Multer/Busboy releases differ at equality. Bound the stream, then enforce
  // the inclusive advertised limit independently of that boundary behavior.
  const upload = multer({ dest, limits: { fileSize: maxBytes + 1, files: 1 } });
  return {
    single(field) {
      const receive = upload.single(field);
      return (req, res, next) => receive(req, res, async error => {
        if (error) return next(error);
        if (req.file?.size > maxBytes) {
          try { await unlink(req.file.path); }
          catch (cleanupError) { if (cleanupError.code !== 'ENOENT') return next(cleanupError); }
          return next(new multer.MulterError('LIMIT_FILE_SIZE', field));
        }
        next();
      });
    },
  };
}

export function mediaUploadError(error, _req, res, next) {
  if (!(error instanceof multer.MulterError)) return next(error);
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: MEDIA_SIZE_ERROR, code: error.code, maxBytes: MAX_MEDIA_BYTES });
  return res.status(400).json({ error: 'אפשר להעלות קובץ מדיה אחד בכל פעם.', code: error.code });
}
