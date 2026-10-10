import { randomUUID } from 'node:crypto';

export const connectionRevoked = () => Object.assign(new Error('החיבור הזה נותק. יש להתחבר מחדש.'), { status: 401, code: 'CONNECTION_REVOKED' });
export const validConnectionId = id => typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

// Firebase auth_time survives ID-token refresh. A revoked login cannot register
// again by refreshing its token, clearing local storage or changing headers.
export async function ensureConnectionSchema(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS account_connection_state (
    user_uid VARCHAR(128) PRIMARY KEY, revoked_before BIGINT NOT NULL DEFAULT 0
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS browser_connections (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_uid VARCHAR(128) NOT NULL, auth_time BIGINT NOT NULL,
    label VARCHAR(160) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at DATETIME NULL,
    UNIQUE KEY browser_login (user_uid, auth_time)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS plugin_connection_details (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

export async function lockConnectionState(connection, uid) {
  await connection.execute('INSERT IGNORE INTO account_connection_state (user_uid) VALUES (?)', [uid]);
  const [rows] = await connection.execute('SELECT revoked_before FROM account_connection_state WHERE user_uid = ? FOR UPDATE', [uid]);
  return Number(rows[0].revoked_before);
}

export function browserLabel(agent = '') {
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'דפדפן';
  const system = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iPhone / iPad' : /Windows/.test(agent) ? 'Windows' : /Macintosh/.test(agent) ? 'Mac' : /Linux/.test(agent) ? 'Linux' : '';
  return [browser, system].filter(Boolean).join(' · ');
}

export function createConnectionStore(pool) {
  async function transaction(work) {
    const connection = await pool.getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  return {
    async browser(identity, agent) {
      if (!Number.isSafeInteger(identity.authTime) || identity.authTime <= 0) throw connectionRevoked();
      return transaction(async connection => {
        const cutoff = await lockConnectionState(connection, identity.uid);
        if (identity.authTime <= cutoff) throw connectionRevoked();
        await connection.execute(`INSERT IGNORE INTO browser_connections (id, user_uid, auth_time, label) VALUES (?, ?, ?, ?)`, [randomUUID(), identity.uid, identity.authTime, browserLabel(agent)]);
        const [rows] = await connection.execute('SELECT id, revoked_at FROM browser_connections WHERE user_uid = ? AND auth_time = ?', [identity.uid, identity.authTime]);
        if (rows[0].revoked_at) throw connectionRevoked();
        await connection.execute('UPDATE browser_connections SET last_seen_at = NOW() WHERE id = ? AND last_seen_at < DATE_SUB(NOW(), INTERVAL 1 MINUTE)', [rows[0].id]);
        return { ...identity, browserConnectionId: rows[0].id };
      });
    },
    async list(uid, currentId) {
      const [browsers] = await pool.execute(`SELECT id, label, created_at, last_seen_at FROM browser_connections WHERE user_uid = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC`, [uid]);
      const [plugins] = await pool.execute(`SELECT p.id, d.created_at, d.last_seen_at FROM plugin_sessions p LEFT JOIN plugin_connection_details d ON d.id = p.id WHERE p.user_uid = ? AND p.refresh_expires_at > NOW() ORDER BY d.last_seen_at DESC`, [uid]);
      const format = (row, kind) => ({ id: row.id, kind, label: row.label || 'Premiere Pro', createdAt: row.created_at, lastSeenAt: row.last_seen_at, current: row.id === currentId });
      return [...browsers.map(row => format(row, 'browser')), ...plugins.map(row => format(row, 'premiere'))];
    },
    async revoke(uid, id) {
      if (!validConnectionId(id)) throw Object.assign(new Error('מזהה חיבור לא תקין'), { status: 400 });
      return transaction(async connection => {
        await lockConnectionState(connection, uid);
        const [browser] = await connection.execute('UPDATE browser_connections SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_uid = ? AND id = ?', [uid, id]);
        const [plugin] = await connection.execute('DELETE FROM plugin_sessions WHERE user_uid = ? AND id = ?', [uid, id]);
        if (!browser.affectedRows && !plugin.affectedRows) throw Object.assign(new Error('החיבור לא נמצא'), { status: 404 });
        if (plugin.affectedRows) await connection.execute('DELETE FROM plugin_connection_details WHERE id = ?', [id]);
      });
    },
    async revokeAll(uid) {
      return transaction(async connection => {
        await lockConnectionState(connection, uid);
        await connection.execute('UPDATE account_connection_state SET revoked_before = GREATEST(revoked_before, UNIX_TIMESTAMP()) WHERE user_uid = ?', [uid]);
        await connection.execute('UPDATE browser_connections SET revoked_at = NOW() WHERE user_uid = ? AND revoked_at IS NULL', [uid]);
        await connection.execute('DELETE d FROM plugin_connection_details d JOIN plugin_sessions p ON p.id = d.id WHERE p.user_uid = ?', [uid]);
        await connection.execute('DELETE FROM plugin_sessions WHERE user_uid = ?', [uid]);
        await connection.execute('DELETE FROM plugin_links WHERE user_uid = ?', [uid]);
      });
    },
    async grantActive(grant) {
      if (!validConnectionId(grant.connectionId)) return false;
      const [rows] = grant.connectionKind === 'browser'
        ? await pool.execute(`SELECT b.id FROM browser_connections b JOIN account_connection_state s ON s.user_uid = b.user_uid WHERE b.id = ? AND b.user_uid = ? AND b.revoked_at IS NULL AND b.auth_time > s.revoked_before`, [grant.connectionId, grant.userUid])
        : grant.connectionKind === 'premiere'
          ? await pool.execute('SELECT id FROM plugin_sessions WHERE id = ? AND user_uid = ? AND refresh_expires_at > NOW()', [grant.connectionId, grant.userUid])
          : [[]];
      return rows.length > 0;
    },
  };
}

export function connectionBinding(identity) {
  return identity.browserConnectionId ? { connectionId: identity.browserConnectionId, connectionKind: 'browser' }
    : identity.pluginSessionId ? { connectionId: identity.pluginSessionId, connectionKind: 'premiere' } : {};
}

export function createConnectionIdentityVerifier(verifyIdentity, store) {
  return async (token, req) => store.browser(await verifyIdentity(token), req?.headers?.['user-agent']);
}
