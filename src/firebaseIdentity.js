import { verify } from 'node:crypto';

export class IdentityError extends Error {
  constructor(message = 'יש להתחבר מחדש.', status = 401) { super(message); this.status = status; }
}

// Verify Firebase ID tokens against Google's signing certificates and this app's project.
export function createFirebaseVerifier({ projectId, fetchImpl = fetch, now = () => Date.now() }) {
  let certificates = {}, expiresAt = 0;
  return async token => {
    if (!projectId) throw new IdentityError('אימות החשבון אינו מוגדר בשרת.', 503);
    try {
      if (typeof token !== 'string' || token.length > 16384) throw new Error();
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error();
      const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
      const seconds = Math.floor(now() / 1000);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
          claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` ||
          typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128 ||
          !Number.isFinite(claims.exp) || claims.exp <= seconds ||
          !Number.isFinite(claims.iat) || claims.iat > seconds ||
          !Number.isFinite(claims.auth_time) || claims.auth_time > seconds) throw new Error();
      if (now() >= expiresAt) {
        const response = await fetchImpl('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new IdentityError('שירות אימות החשבון אינו זמין כרגע.', 503);
        certificates = await response.json();
        const ttl = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 300);
        expiresAt = now() + Math.min(ttl, 3600) * 1000;
      }
      if (!Object.hasOwn(certificates, header.kid) || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), certificates[header.kid], Buffer.from(parts[2], 'base64url'))) throw new Error();
      return { uid: claims.sub, email: typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null,
        emailVerified: claims.email_verified === true, displayName: claims.name ?? null, photoURL: claims.picture ?? null,
        providerId: claims.firebase?.sign_in_provider ?? null };
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      throw new IdentityError();
    }
  };
}

export function createIdentityMiddleware(verifyToken) {
  return async (req, res, next) => {
    const match = req.headers.authorization?.match(/^Bearer (\S+)$/);
    if (!match) return res.status(401).json({ error: 'יש להתחבר לחשבון.' });
    try { req.identity = await verifyToken(match[1]); next(); }
    catch (error) { res.status(error.status ?? 401).json({ error: error.message }); }
  };
}
