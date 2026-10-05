import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { localMediaPath, parseBunnyReference } from './bunnyStreamStorage.js';

export function createBurnSourceResolver({ getVideoById, bunny, localDir, tempDir }) {
  return async ({ videoId, userUid, signal }) => {
    if (!userUid) return null;
    const video = await getVideoById({ videoId, userUid });
    if (!video?.stored_path) return null;
    const originalname = video.original_filename || 'video.mp4';
    if (!parseBunnyReference(video.stored_path)) {
      const input = localMediaPath(localDir, video.stored_path);
      await fs.access(input);
      return { path: input, originalname, temporary: false };
    }
    const input = path.join(tempDir, `burn-${randomUUID()}`);
    try {
      const response = await bunny.open(video.stored_path, { signal });
      if (!response.ok || !response.body) throw new Error('Video source unavailable');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(input, { flags: 'wx' }), { signal });
      return { path: input, originalname, temporary: true };
    } catch (error) {
      await fs.unlink(input).catch(() => {});
      throw error;
    }
  };
}
