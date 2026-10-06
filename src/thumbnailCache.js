import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { localMediaPath, parseBunnyReference } from './bunnyStreamStorage.js';

const run = promisify(execFile);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const thumbnailVersion = storedPath => createHash('sha256').update(`cover-v1:${storedPath}`).digest('hex').slice(0, 24);

export async function renderThumbnail(input, output) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input,
    '-frames:v', '1', '-vf', 'scale=480:270:force_original_aspect_ratio=decrease', '-q:v', '5', '-threads', '1', output],
  { timeout: 20_000, windowsHide: true, maxBuffer: 64 * 1024 });
}

// Store only small covers outside public assets. Every read still follows the
// route's ownership check. In-flight work is shared, including across duplicates.
export function createThumbnailCache({ directory, localDir, bunny, render = renderThumbnail, concurrency = 3 }) {
  const pending = new Map();
  let active = 0;
  const waiting = [];
  const limited = async task => {
    if (active >= concurrency) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try { return await task(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
  const fileFor = storedPath => path.join(directory, `${thumbnailVersion(storedPath)}.jpg`);
  const read = async storedPath => {
    try {
      const bytes = await fs.readFile(fileFor(storedPath));
      if (bytes.length < 4 || bytes.length > MAX_IMAGE_BYTES || bytes[0] !== 255 || bytes[1] !== 216) {
        await fs.unlink(fileFor(storedPath));
        return null;
      }
      return bytes;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const generate = async (storedPath, source) => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `${randomUUID()}.jpg`);
    const upstreamFile = path.join(directory, `${randomUUID()}.source`);
    try {
      let input = source;
      if (!input && parseBunnyReference(storedPath)) {
        const response = await bunny.openThumbnail(storedPath);
        const type = response.headers.get('content-type')?.split(';')[0];
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(type)) {
          await response.body?.cancel(); throw new Error('Upstream cover is not an image');
        }
        const chunks = []; let size = 0;
        try {
          if (!response.body) throw new Error('Upstream cover has no body');
          for await (const chunk of response.body) {
            size += chunk.byteLength;
            if (size > MAX_IMAGE_BYTES) throw new Error('Upstream cover is too large');
            chunks.push(Buffer.from(chunk));
          }
        } finally { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
        await fs.writeFile(upstreamFile, Buffer.concat(chunks), { mode: 0o600 });
        input = upstreamFile;
      }
      input ??= localMediaPath(localDir, storedPath);
      await render(input, temporary);
      const bytes = await fs.readFile(temporary);
      if (bytes.length < 4 || bytes.length > MAX_IMAGE_BYTES || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Rendered cover is invalid');
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, fileFor(storedPath));
      return bytes;
    } finally {
      await Promise.all([temporary, upstreamFile].map(file => fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; })));
    }
  };
  const ensure = async (storedPath, source) => {
    if (!storedPath) throw Object.assign(new Error('No media source'), { status: 404 });
    const bytes = await read(storedPath);
    if (bytes) return bytes;
    if (!pending.has(storedPath)) {
      const work = limited(async () => await read(storedPath) ?? await generate(storedPath, source));
      pending.set(storedPath, work);
      void work.finally(() => pending.delete(storedPath)).catch(() => {});
    }
    return pending.get(storedPath);
  };
  return {
    get: video => ensure(video.stored_path),
    prime: (storedPath, source) => ensure(storedPath, source),
    warm(videos) {
      for (const video of videos.slice(0, 6)) {
        if (video.media_type !== 'audio' && video.stored_path) void ensure(video.stored_path).catch(() => {});
      }
    },
  };
}
