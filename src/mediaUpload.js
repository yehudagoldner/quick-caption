import multer from 'multer';
import { MAX_MEDIA_BYTES, MEDIA_SIZE_ERROR } from './mediaPolicy.js';

export function createMediaUpload(dest, maxBytes = MAX_MEDIA_BYTES) {
  // Busboy emits its limit event at equality; permit exactly the advertised size.
  return multer({ dest, limits: { fileSize: maxBytes + 1, files: 1 } });
}

export function mediaUploadError(error, _req, res, next) {
  if (!(error instanceof multer.MulterError)) return next(error);
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: MEDIA_SIZE_ERROR, code: error.code, maxBytes: MAX_MEDIA_BYTES });
  return res.status(400).json({ error: 'אפשר להעלות קובץ מדיה אחד בכל פעם.', code: error.code });
}
