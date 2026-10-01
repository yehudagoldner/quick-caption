export const OWNER_EMAIL = 'goldnery@gmail.com';
export const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

export const ADMIN_TABLES = [
  `CREATE TABLE IF NOT EXISTS admin_access (
    email VARCHAR(255) PRIMARY KEY, granted_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS admin_audit (
    request_id CHAR(36) PRIMARY KEY, actor_email VARCHAR(255) NOT NULL,
    action VARCHAR(32) NOT NULL, target VARCHAR(255) NOT NULL,
    credits INT NULL, reason VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
    id CHAR(36) PRIMARY KEY, user_uid VARCHAR(128) NULL, operation VARCHAR(100) NOT NULL,
    model VARCHAR(128) NOT NULL, service_tier VARCHAR(32) NULL, status VARCHAR(16) NOT NULL,
    input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
    cached_tokens BIGINT NOT NULL DEFAULT 0, duration_seconds DECIMAL(12,3) NULL,
    cost_usd DECIMAL(16,8) NULL, cost_basis VARCHAR(32) NOT NULL,
    usage_json JSON NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ai_usage_created (created_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS video_activity (
    video_id INT PRIMARY KEY, user_uid VARCHAR(128) NOT NULL, media_type VARCHAR(16) NOT NULL,
    duration_seconds INT NOT NULL DEFAULT 0, edited TINYINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
];

export async function ensureAdminSchema(db) {
  for (const sql of ADMIN_TABLES) await db.execute(sql);
  await db.execute('INSERT IGNORE INTO admin_access (email, granted_by) VALUES (?, ?)', [OWNER_EMAIL, OWNER_EMAIL]);
  // Statistics survive the scheduled deletion of inactive media and job records.
  await db.execute(`INSERT IGNORE INTO video_activity (video_id, user_uid, media_type, duration_seconds, created_at)
    SELECT id, user_uid, media_type, COALESCE(duration_seconds,
      ROUND(JSON_UNQUOTE(JSON_EXTRACT(subtitle_json, CONCAT('$[', GREATEST(COALESCE(JSON_LENGTH(subtitle_json), 0) - 1, 0), '].end')))), 0), created_at
    FROM videos WHERE status = 'completed'`);
}

export function createAdminStore(pool) {
  return {
    async isAdmin(email) {
      if (email === OWNER_EMAIL) return true;
      const [rows] = await pool.execute('SELECT email FROM admin_access WHERE email = ?', [email]);
      return rows.length > 0;
    },
    async overview() {
      const [payments, users, videos, usage, models, admins, audit] = await Promise.all([
        pool.query('SELECT COALESCE(SUM(amount_usd), 0) AS revenueUSD, COUNT(*) AS payments FROM credit_payments'),
        pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(EXISTS(SELECT 1 FROM credit_payments p WHERE p.user_uid = u.uid)), 0) AS paying FROM users u`),
        pool.query(`SELECT COUNT(*) AS processed, COALESCE(SUM(media_type = 'video'), 0) AS videos,
          COALESCE(SUM(edited), 0) AS edited, COALESCE(SUM(duration_seconds), 0) AS durationSeconds FROM video_activity`),
        pool.query(`SELECT COALESCE(SUM(cost_usd), 0) AS costUSD, COALESCE(SUM(input_tokens), 0) AS inputTokens,
          COALESCE(SUM(output_tokens), 0) AS outputTokens, COUNT(*) AS calls,
          COALESCE(SUM(cost_usd IS NULL), 0) AS unpriced, MIN(created_at) AS trackingSince FROM ai_usage`),
        pool.query(`SELECT model, service_tier AS serviceTier, COUNT(*) AS calls, SUM(input_tokens) AS inputTokens,
          SUM(output_tokens) AS outputTokens, SUM(cached_tokens) AS cachedTokens,
          COALESCE(SUM(duration_seconds), 0) AS durationSeconds, COALESCE(SUM(cost_usd), 0) AS costUSD,
          SUM(cost_usd IS NULL) AS unpriced FROM ai_usage GROUP BY model, service_tier ORDER BY costUSD DESC`),
        pool.query('SELECT email, granted_by AS grantedBy, created_at AS createdAt FROM admin_access ORDER BY created_at'),
        pool.query(`SELECT a.actor_email AS actor, a.action, COALESCE(u.email, a.target) AS target,
          a.credits, a.reason, a.created_at AS createdAt FROM admin_audit a
          LEFT JOIN users u ON a.action = 'grant-credits' AND u.uid = a.target
          ORDER BY a.created_at DESC LIMIT 30`),
      ]);
      const count = users[0][0];
      return { revenue: payments[0][0], users: { ...count, free: Number(count.total) - Number(count.paying) },
        media: videos[0][0], usage: usage[0][0], models: models[0], admins: admins[0], audit: audit[0] };
    },
    async users(search, page) {
      const filter = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      const where = "WHERE u.email LIKE ? OR u.display_name LIKE ?";
      const [rows] = await pool.execute(`SELECT u.uid, u.email, u.display_name AS displayName, u.credits, u.created_at AS createdAt,
        EXISTS(SELECT 1 FROM credit_payments p WHERE p.user_uid = u.uid) AS paying,
        EXISTS(SELECT 1 FROM admin_access a WHERE a.email = u.email) AS admin
        FROM users u ${where} ORDER BY u.created_at DESC, u.id DESC LIMIT 25 OFFSET ${page * 25}`, [filter, filter]);
      const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM users u ${where}`, [filter, filter]);
      return { users: rows, total: Number(count.total), page };
    },
    async grantAdmin({ email, actor, requestId }) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        try {
          await connection.execute("INSERT INTO admin_audit (request_id, actor_email, action, target) VALUES (?, ?, 'grant-admin', ?)", [requestId, actor, email]);
        } catch (error) {
          if (error.code !== 'ER_DUP_ENTRY') throw error;
          const [[entry]] = await connection.execute('SELECT actor_email, action, target FROM admin_audit WHERE request_id = ? FOR UPDATE', [requestId]);
          if (!entry || entry.actor_email !== actor || entry.action !== 'grant-admin' || entry.target !== email) {
            const conflict = new Error('הבקשה כבר נוצלה עם פרטים אחרים.'); conflict.status = 409; throw conflict;
          }
        }
        await connection.execute('INSERT IGNORE INTO admin_access (email, granted_by) VALUES (?, ?)', [email, actor]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
    },
    async grantCredits(options) {
      const connection = await pool.getConnection();
      try { return await grantAdminCredits(connection, options); }
      finally { connection.release(); }
    },
    async recordUsage(row) {
      await pool.execute(`INSERT INTO ai_usage (id, user_uid, operation, model, service_tier, status, input_tokens,
        output_tokens, cached_tokens, duration_seconds, cost_usd, cost_basis, usage_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
      [row.id, row.userUid, row.operation, row.model, row.serviceTier, row.status, row.inputTokens,
        row.outputTokens, row.cachedTokens, row.durationSeconds, row.costUSD, row.costBasis, JSON.stringify(row.usage)]);
    },
  };
}

export async function grantAdminCredits(connection, { userUid, credits, actor, reason, requestId }) {
  try {
    await connection.beginTransaction();
    // A unique request ID prevents double grants after a lost HTTP response.
    let replay = false;
    try {
      await connection.execute("INSERT INTO admin_audit (request_id, actor_email, action, target, credits, reason) VALUES (?, ?, 'grant-credits', ?, ?, ?)",
        [requestId, actor, userUid, credits, reason]);
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      const [[entry]] = await connection.execute('SELECT actor_email, action, target, credits, reason FROM admin_audit WHERE request_id = ? FOR UPDATE', [requestId]);
      if (!entry || entry.actor_email !== actor || entry.action !== 'grant-credits' || entry.target !== userUid || Number(entry.credits) !== credits || entry.reason !== reason) {
        const conflict = new Error('בקשת הזיכוי כבר נוצלה עם פרטים אחרים.'); conflict.status = 409; throw conflict;
      }
      replay = true;
    }
    const [[user]] = await connection.execute('SELECT credits FROM users WHERE uid = ? FOR UPDATE', [userUid]);
    if (!user) { const error = new Error('המשתמש לא נמצא.'); error.status = 404; throw error; }
    if (!replay) {
      if (Number(user.credits) + credits > 2147483647) { const error = new Error('יתרת הקרדיטים גדולה מדי.'); error.status = 400; throw error; }
      await connection.execute('UPDATE users SET credits = credits + ? WHERE uid = ?', [credits, userUid]);
    }
    await connection.commit();
    return { credited: !replay, newBalance: Number(user.credits) + (replay ? 0 : credits) };
  } catch (error) { await connection.rollback(); throw error; }
}
