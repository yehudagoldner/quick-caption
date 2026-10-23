import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createBunnyStreamStorage } from '../src/bunnyStreamStorage.js';

class CheckError extends Error {}
const requireCheck = (condition, message) => { if (!condition) throw new CheckError(message); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function readBounded(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      requireCheck(length <= limit, 'Response exceeded the permitted byte limit');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Only reads existing media. Uses the application's normal Bunny transport and
// signing logic; does not upload, delete, touch retention, or retry failed checks.
export async function checkCdn({ storage, references, rounds = 3, timeoutMs = 10000 }) {
  requireCheck(references.length > 0 && references.length <= 3, 'Expected one to three existing videos');
  requireCheck(Number.isInteger(rounds) && rounds >= 1 && rounds <= 5, 'Expected one to five repeat rounds');
  const checks = [];
  const run = async (video, name, action) => {
    const start = performance.now();
    try {
      const details = await action(AbortSignal.timeout(timeoutMs));
      checks.push({ video, name, ok: true, ...details, ms: Math.round(performance.now() - start) });
    } catch (error) {
      // Never print source URLs, signed query strings, API keys or raw network errors.
      checks.push({ video, name, ok: false, ms: Math.round(performance.now() - start),
        reason: error instanceof CheckError ? error.message : 'CDN request failed',
        ...(Number.isInteger(error.status) ? { status: error.status } : {}),
        ...(/^[A-Z_]{1,64}$/.test(error.code ?? '') ? { code: error.code } : {}) });
    }
  };
  for (const [index, reference] of references.entries()) {
    const video = index + 1;
    let total, initialHash;
    await run(video, 'original-head', async signal => {
      const response = await storage.open(reference, { method: 'HEAD', signal });
      try {
        requireCheck(response.status === 200, 'Original HEAD did not return 200');
        const length = Number(response.headers.get('content-length'));
        requireCheck(Number.isSafeInteger(length) && length > 0, 'Original length is missing or invalid');
        requireCheck(response.headers.get('accept-ranges') === 'bytes', 'Byte seeking is not advertised');
        total = length;
        return { status: response.status, bytes: 0 };
      } finally { await response.body?.cancel(); }
    });
    const rangeCheck = async (start, end, signal) => {
      const response = await storage.open(reference, { range: `bytes=${start}-${end}`, signal });
      try {
        requireCheck(response.status === 206, 'Range request did not return 206');
        requireCheck(response.headers.get('content-range') === `bytes ${start}-${end}/${total}`, 'Content-Range does not match the requested interval');
        requireCheck(Number(response.headers.get('content-length')) === end - start + 1, 'Range Content-Length is incorrect');
        const bytes = await readBounded(response, end - start + 1);
        requireCheck(bytes.length === end - start + 1, 'Range body is incomplete');
        return { status: response.status, bytes: bytes.length, hash: digest(bytes) };
      } finally { if (response.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
    };
    if (total) {
      for (const [name, start] of [['range-start', 0], ['range-middle', Math.floor(total / 2)], ['range-end', Math.max(0, total - 1024)]]) {
        await run(video, name, async signal => {
          const { hash, ...result } = await rangeCheck(start, Math.min(total - 1, start + 1023), signal);
          if (name === 'range-start') initialHash = hash;
          return result;
        });
      }
      await run(video, 'range-unsatisfiable', async signal => {
        const response = await storage.open(reference, { range: `bytes=${total}-`, signal });
        try {
          requireCheck(response.status === 416, 'Out-of-bounds range did not return 416');
          requireCheck(response.headers.get('content-range') === `bytes */${total}`, 'Invalid-range response has the wrong total length');
          return { status: response.status };
        } finally { await response.body?.cancel(); }
      });
      for (let round = 1; round <= rounds; round++) {
        await run(video, `repeat-range-${round}`, async signal => {
          const { hash, ...result } = await rangeCheck(0, Math.min(total - 1, 1023), signal);
          if (initialHash) requireCheck(hash === initialHash, 'Repeated range returned different content');
          return result;
        });
      }
    }
    for (const method of ['HEAD', 'GET']) {
      await run(video, `thumbnail-${method.toLowerCase()}`, async signal => {
        const response = await storage.openThumbnail(reference, { method, signal });
        try {
          requireCheck(response.status === 200, 'Thumbnail did not return 200');
          requireCheck(/^image\/(jpeg|png|webp|avif)(?:;|$)/i.test(response.headers.get('content-type') ?? ''), 'Thumbnail is not a supported image');
          const bytes = method === 'GET' ? await readBounded(response, 2 * 1024 * 1024) : Buffer.alloc(0);
          if (method === 'GET') requireCheck(bytes.length > 0, 'Thumbnail body is empty');
          return { status: response.status, bytes: bytes.length };
        } finally { if (response.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
      });
    }
  }
  return { ok: checks.every(check => check.ok), passed: checks.filter(check => check.ok).length,
    failed: checks.filter(check => !check.ok).length, checks };
}

export function requireQa(env) {
  requireCheck(env.DB_NAME === 'quickcaption_qa' && env.DB_USER === 'quickcaption_qa' &&
    env.PORT === '3100' && env.VITE_APP_ENV === 'qa', 'Live CDN checks must run in the existing isolated QA environment');
}

async function main() {
  await import('../src/loadAppEnv.js');
  requireQa(process.env);
  const { default: pool } = await import('../db.js');
  const networkFailures = [];
  try {
    const [rows] = await pool.query(`SELECT stored_path, MAX(id) AS latest_id FROM videos
      WHERE media_type = 'video' AND status = 'completed' AND stored_path LIKE 'bunny://%'
      GROUP BY stored_path ORDER BY latest_id DESC LIMIT 3`);
    const storage = createBunnyStreamStorage(process.env, async (...args) => {
      try { return await fetch(...args); }
      catch (error) {
        const codes = [error.name, error.cause?.code, ...(error.cause?.errors ?? []).map(cause => cause.code)]
          .filter(code => typeof code === 'string' && /^[A-Za-z_]{1,64}$/.test(code));
        networkFailures.push({ codes });
        throw error;
      }
    });
    const result = await checkCdn({ storage, references: rows.map(row => row.stored_path) });
    console.log(JSON.stringify({ environment: 'qa', ...result, networkFailures }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof CheckError ? error.message : 'CDN checks could not complete; inspect QA connectivity and configuration.');
    process.exitCode = 1;
  });
}
