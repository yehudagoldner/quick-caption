import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ensureConnectionSchema, lockConnectionState, connectionRevoked } from './accountConnections.js';

export const ACCESS_SECONDS = 15 * 60;
export const REFRESH_SECONDS = 30 * 24 * 60 * 60;
export const LINK_SECONDS = 10 * 60;
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = prefix => prefix + randomBytes(32).toString('base64url');
const failure = (status, message) => Object.assign(new Error(message), { status });
const validId = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const validSecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,70}$/.test(value);
export const isPluginToken = value => typeof value === 'string' && value.startsWith('qc_plugin_');

export async function ensurePluginSchema(pool) {
  await ensureConnectionSchema(pool);
  await pool.execute(`CREATE TABLE IF NOT EXISTS plugin_links (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    device_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_uid VARCHAR(128), identity_json JSON,
    expires_at DATETIME NOT NULL, consumed TINYINT NOT NULL DEFAULT 0,
    INDEX idx_plugin_links_expiry (expires_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS plugin_sessions (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_uid VARCHAR(128) NOT NULL, identity_json JSON NOT NULL,
    access_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    refresh_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    access_expires_at DATETIME NOT NULL, refresh_expires_at DATETIME NOT NULL,
    INDEX idx_plugin_sessions_user (user_uid), INDEX idx_plugin_sessions_expiry (refresh_expires_at),
    FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

export function createPluginSessions(pool) {
  async function transaction(work) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  function tokens() {
    return { accessToken: secret('qc_plugin_'), refreshToken: secret('qc_refresh_'), expiresIn: ACCESS_SECONDS };
  }
  const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
  return {
    async start() {
      const id = randomUUID(), deviceSecret = secret(''), userCode = randomBytes(4).toString('hex').toUpperCase();
      await pool.execute('DELETE FROM plugin_links WHERE expires_at < NOW() LIMIT 100');
      await pool.execute('DELETE FROM plugin_sessions WHERE refresh_expires_at < NOW() LIMIT 100');
      await pool.execute(`INSERT INTO plugin_links (id, device_hash, user_code, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [id, digest(deviceSecret), userCode, LINK_SECONDS]);
      return { id, deviceSecret, userCode, expiresIn: LINK_SECONDS, pollIntervalSeconds: 3 };
    },
    async approve(id, userCode, identity) {
      if (!validId(id) || !/^[A-F0-9]{8}$/.test(userCode || '')) throw failure(400, 'קוד חיבור לא תקין');
      // Locking prevents two different browser accounts from approving the same link.
      return transaction(async connection => {
        const [rows] = await connection.execute(`SELECT * FROM plugin_links WHERE id = ? AND user_code = ? AND expires_at > NOW() AND consumed = 0 FOR UPDATE`, [id, userCode]);
        if (!rows.length) throw failure(410, 'בקשת החיבור פגה או כבר נוצלה');
        if (rows[0].user_uid) throw failure(409, 'בקשת החיבור כבר אושרה');
        const cutoff = await lockConnectionState(connection, identity.uid);
        if (cutoff && (!identity.authTime || identity.authTime <= cutoff)) throw connectionRevoked();
        const [browser] = await connection.execute('SELECT revoked_at FROM browser_connections WHERE user_uid = ? AND auth_time = ?', [identity.uid, identity.authTime ?? 0]);
        if (browser[0]?.revoked_at) throw connectionRevoked();
        const profile = { uid: identity.uid, email: identity.email, displayName: identity.displayName, authTime: identity.authTime };
        await connection.execute('UPDATE plugin_links SET user_uid = ?, identity_json = ? WHERE id = ?', [identity.uid, JSON.stringify(profile), id]);
        return { status: 'approved' };
      });
    },
    async poll(id, deviceSecret) {
      if (!validId(id) || !validSecret(deviceSecret)) throw failure(400, 'בקשת חיבור לא תקינה');
      return transaction(async connection => {
        const [rows] = await connection.execute(`SELECT * FROM plugin_links WHERE id = ? AND device_hash = ? AND expires_at > NOW() AND consumed = 0 FOR UPDATE`, [id, digest(deviceSecret)]);
        if (!rows.length) throw failure(410, 'בקשת החיבור פגה או כבר נוצלה');
        const row = rows[0];
        if (!row.user_uid) return { status: 'pending' };
        const cutoff = await lockConnectionState(connection, row.user_uid);
        const profile = parse(row.identity_json);
        if (cutoff && (!profile.authTime || profile.authTime <= cutoff)) throw connectionRevoked();
        const [browser] = await connection.execute('SELECT revoked_at FROM browser_connections WHERE user_uid = ? AND auth_time = ?', [row.user_uid, profile.authTime ?? 0]);
        if (browser[0]?.revoked_at) throw connectionRevoked();
        const issued = tokens();
        const sessionId = randomUUID();
        await connection.execute(`INSERT INTO plugin_sessions (id, user_uid, identity_json, access_hash, refresh_hash, access_expires_at, refresh_expires_at)
          VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [sessionId, row.user_uid, JSON.stringify(profile), digest(issued.accessToken), digest(issued.refreshToken), ACCESS_SECONDS, REFRESH_SECONDS]);
        await connection.execute('INSERT INTO plugin_connection_details (id) VALUES (?)', [sessionId]);
        await connection.execute('UPDATE plugin_links SET consumed = 1 WHERE id = ?', [id]);
        return { status: 'approved', ...issued, user: parse(row.identity_json) };
      });
    },
    async refresh(refreshToken) {
      if (!validSecret(refreshToken) || !refreshToken.startsWith('qc_refresh_')) throw failure(401, 'נדרשת התחברות מחדש');
      return transaction(async connection => {
        const [rows] = await connection.execute(`SELECT * FROM plugin_sessions WHERE refresh_hash = ? AND refresh_expires_at > NOW() FOR UPDATE`, [digest(refreshToken)]);
        if (!rows.length) throw failure(401, 'נדרשת התחברות מחדש');
        const issued = tokens();
        // Fixed refresh expiry: a lost device cannot keep a login alive forever.
        await connection.execute(`UPDATE plugin_sessions SET access_hash = ?, refresh_hash = ?, access_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?`,
          [digest(issued.accessToken), digest(issued.refreshToken), ACCESS_SECONDS, rows[0].id]);
        return { ...issued, user: parse(rows[0].identity_json) };
      });
    },
    async verify(accessToken) {
      if (!validSecret(accessToken) || !isPluginToken(accessToken)) return null;
      const [rows] = await pool.execute(`SELECT id, user_uid, identity_json FROM plugin_sessions WHERE access_hash = ? AND access_expires_at > NOW() AND refresh_expires_at > NOW()`, [digest(accessToken)]);
      if (rows.length) {
        await pool.execute('INSERT IGNORE INTO plugin_connection_details (id) VALUES (?)', [rows[0].id]);
        await pool.execute('UPDATE plugin_connection_details SET last_seen_at = NOW() WHERE id = ? AND last_seen_at < DATE_SUB(NOW(), INTERVAL 1 MINUTE)', [rows[0].id]);
      }
      return rows.length ? { ...parse(rows[0].identity_json), uid: rows[0].user_uid, pluginSessionId: rows[0].id } : null;
    },
    async revoke(id) {
      return transaction(async connection => {
        await connection.execute('DELETE FROM plugin_sessions WHERE id = ?', [id]);
        await connection.execute('DELETE FROM plugin_connection_details WHERE id = ?', [id]);
      });
    },
  };
}

export function pluginRouteAllowed(method, path) {
  if (method === 'GET') return /^\/plugin\/(?:account|diagnostics|videos\/\d+\/subtitles)$/.test(path)
    || path === '/users/credits' || path === '/videos'
    || /^\/videos\/\d+(?:\/token)?$/.test(path)
    || /^\/transcribe\/jobs\/[0-9a-f-]{36}$/i.test(path);
  return method === 'POST' && ['/plugin/quote', '/plugin/logout', '/plugin/diagnostics', '/transcribe'].includes(path);
}
