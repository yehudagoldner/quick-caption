import { randomBytes, randomUUID } from 'node:crypto';

const invalidSession = () => Object.assign(new Error('ההתחזות הסתיימה. יש לחזור לניהול ולהתחבר שוב למשתמש.'), { status: 403, code: 'IMPERSONATION_EXPIRED' });

// Tokens stay server-side and are bound to the administrator's verified login.
// A restart ends all sessions; a target never receives a Firebase credential.
export function createImpersonationSessions(store, now = Date.now) {
  const sessions = new Map();
  const lifetime = 60 * 60 * 1000;
  async function authorized(actor) {
    if (!actor.emailVerified || !actor.email || !actor.browserConnectionId || !await store.isAdmin(actor.email)) {
      throw Object.assign(new Error('אין לחשבון זה גישה להתחזות.'), { status: 403 });
    }
  }
  async function resolve(token, actor) {
    const session = typeof token === 'string' && sessions.get(token);
    if (!session || session.expiresAt <= now() || session.actor.uid !== actor.uid ||
        session.actor.browserConnectionId !== actor.browserConnectionId) throw invalidSession();
    try { await authorized(actor); }
    catch (error) { if (error.status === 403) throw invalidSession(); throw error; }
    const user = await store.impersonationUser(session.userUid);
    if (!user) throw invalidSession();
    return { session, user };
  }
  return {
    async start(actor, userUid) {
      await authorized(actor);
      if (userUid === actor.uid) throw Object.assign(new Error('כבר מחוברים לחשבון הזה.'), { status: 400 });
      const user = await store.impersonationUser(userUid);
      if (!user) throw Object.assign(new Error('המשתמש לא נמצא.'), { status: 404 });
      for (const [key, entry] of sessions) if (entry.expiresAt <= now()) sessions.delete(key);
      if (sessions.size >= 1000) throw Object.assign(new Error('יש יותר מדי חיבורים פעילים. נסו שוב מאוחר יותר.'), { status: 503 });
      const token = randomBytes(32).toString('base64url');
      const expiresAt = now() + lifetime;
      await store.auditImpersonation(actor.email, 'impersonation-start', userUid, randomUUID());
      sessions.set(token, { actor: { ...actor }, userUid, expiresAt });
      return { token, user, expiresAt };
    },
    async profile(token, actor) {
      const { session, user } = await resolve(token, actor);
      return { token, user, expiresAt: session.expiresAt };
    },
    async stop(token, actor) {
      const session = sessions.get(token);
      // Returning remains possible after expiry or a revoked admin permission.
      if (session && session.actor.uid === actor.uid && session.actor.browserConnectionId === actor.browserConnectionId) {
        sessions.delete(token);
        await store.auditImpersonation(actor.email, 'impersonation-stop', session.userUid, randomUUID());
      }
      return { success: true };
    },
    async apply(req, res, next) {
      const token = req.headers['x-quick-caption-impersonation'];
      if (token == null) return next();
      res.set('Cache-Control', 'no-store');
      try {
        const { user } = await resolve(token, req.identity);
        if (req.path.startsWith('/plugin') || req.path.startsWith('/payments') ||
            req.path === '/users/sync' || (req.path.startsWith('/connections') && req.method !== 'GET')) {
          return res.status(403).json({ error: 'הפעולה אינה זמינה בזמן התחזות. אפשר לחזור לחשבון הניהול.' });
        }
        req.actorIdentity = req.identity;
        req.identity = { ...user, browserConnectionId: req.identity.browserConnectionId, impersonationId: token };
        next();
      } catch (error) {
        res.status(error.status ?? 503).json({ error: error.status ? error.message : 'לא ניתן לבדוק את ההתחזות כרגע.', ...(error.code ? { code: error.code } : {}) });
      }
    },
    async grantActive(grant, connections) {
      if (!grant.impersonationId) return connections.grantActive(grant);
      const session = sessions.get(grant.impersonationId);
      if (!session || session.userUid !== grant.userUid || session.actor.browserConnectionId !== grant.connectionId) return false;
      try {
        await resolve(grant.impersonationId, session.actor);
        return connections.grantActive({ ...grant, userUid: session.actor.uid });
      } catch { return false; }
    },
  };
}
