import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function loadVideoSigningKey({ configuredKey, keyPath = path.join(process.cwd(), '.local-secrets', 'video-token-key') } = {}) {
  if (configuredKey) return configuredKey;
  const read = async () => {
    const key = await fs.readFile(keyPath);
    if (key.length !== 32) throw new Error('Invalid persisted video signing key');
    return key;
  };
  try { return await read(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  const temporary = `${keyPath}.${crypto.randomUUID()}`;
  await fs.writeFile(temporary, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
  try {
    // Atomic publication: concurrent workers either install this key or read
    // the existing complete key, never a partially written or replaced key.
    try { await fs.link(temporary, keyPath); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return await read();
  } finally { await fs.unlink(temporary); }
}

// Tokens authorize one video and purpose only. Production workers on separate
// hosts should share VIDEO_TOKEN_SECRET; local workers share the persisted key.
export function createVideoTokens(secret = crypto.randomBytes(32), now = Date.now) {
  const sign = payload => crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    issue(videoId, userUid, purpose, lifetime = 24 * 60 * 60 * 1000, binding = {}) {
      // Covers keep the same signed URL within an hour, so private browser
      // caching works. Do not change edit/media lifetimes or short test grants.
      const issuedAt = purpose === 'thumbnail' && lifetime === 24 * 3600000 ? Math.floor(now() / 3600000) * 3600000 : now();
      const payload = Buffer.from(JSON.stringify({ videoId, userUid, purpose, exp: issuedAt + lifetime, ...binding })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    verify(token, purpose) {
      if (typeof token !== 'string') return null;
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra) return null;
      const expected = Buffer.from(sign(payload));
      const actual = Buffer.from(signature);
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
      try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return data.purpose === purpose && Number.isSafeInteger(data.videoId) && data.videoId > 0
          && typeof data.userUid === 'string' && data.userUid && data.exp > now() ? data : null;
      } catch { return null; }
    },
  };
}
