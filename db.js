import mysql from "mysql2/promise";
import "./src/loadAppEnv.js";
import { creditPayment } from "./src/creditPayments.js";
import { completeJob, JOB_STALE_SECONDS } from "./src/transcriptionJobs.js";
import { ensureVideoRetention, touchVideo } from "./src/videoRetention.js";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function ensureSchema() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      uid VARCHAR(128) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      photo_url TEXT,
      phone_number VARCHAR(32),
      is_email_verified TINYINT(1) DEFAULT 0,
      provider_id VARCHAR(128),
      last_login_at DATETIME,
      credits INT DEFAULT 50 NOT NULL COMMENT 'User credit balance',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS credit_payments (
      paypal_order_id VARCHAR(64) NOT NULL PRIMARY KEY,
      paypal_capture_id VARCHAR(64) NOT NULL UNIQUE,
      user_uid VARCHAR(128) NOT NULL,
      credits INT NOT NULL,
      amount_usd DECIMAL(10, 2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_credit_payments_user_uid (user_uid),
      CONSTRAINT fk_credit_payments_user FOREIGN KEY (user_uid) REFERENCES users(uid)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS transcription_jobs (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user_uid VARCHAR(128) NOT NULL,
      status ENUM('processing','completed','failed') NOT NULL DEFAULT 'processing',
      result_json LONGTEXT,
      error_message TEXT,
      stages_json JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_transcription_jobs_user (user_uid),
      CONSTRAINT fk_transcription_jobs_user FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS videos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_uid VARCHAR(128) NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      stored_path VARCHAR(512),
      status ENUM('uploaded','processing','completed','failed') DEFAULT 'uploaded',
      media_type ENUM('video','audio') DEFAULT 'video',
      format VARCHAR(16),
      duration_seconds INT,
      size_bytes BIGINT,
      transcription_id VARCHAR(255),
      subtitle_json JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_videos_user_uid (user_uid),
      CONSTRAINT fk_videos_user FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  const [subtitleJsonColumns] = await pool.query("SHOW COLUMNS FROM videos LIKE 'subtitle_json'");
  await ensureVideoRetention(pool);
  const [jobStageColumns] = await pool.query("SHOW COLUMNS FROM transcription_jobs LIKE 'stages_json'");
  if (jobStageColumns.length === 0) await pool.execute("ALTER TABLE transcription_jobs ADD COLUMN stages_json JSON NULL");
  if (Array.isArray(subtitleJsonColumns) && subtitleJsonColumns.length === 0) {
    await pool.execute("ALTER TABLE videos ADD COLUMN subtitle_json JSON NULL");
  }

  const [mimeTypeColumns] = await pool.query("SHOW COLUMNS FROM videos LIKE 'mime_type'");
  if (Array.isArray(mimeTypeColumns) && mimeTypeColumns.length === 0) {
    await pool.execute("ALTER TABLE videos ADD COLUMN mime_type VARCHAR(100) NULL AFTER media_type");
  }

  const [wordsJsonColumns] = await pool.query("SHOW COLUMNS FROM videos LIKE 'words_json'");
  if (Array.isArray(wordsJsonColumns) && wordsJsonColumns.length === 0) {
    await pool.execute("ALTER TABLE videos ADD COLUMN words_json JSON NULL AFTER subtitle_json");
  }

  // Add credits column to existing users table
  const [creditsColumns] = await pool.query("SHOW COLUMNS FROM users LIKE 'credits'");
  if (Array.isArray(creditsColumns) && creditsColumns.length === 0) {
    console.log("Adding credits column to users table...");
    await pool.execute("ALTER TABLE users ADD COLUMN credits INT DEFAULT 50 NOT NULL COMMENT 'User credit balance' AFTER last_login_at");
  } else if (String(creditsColumns[0].Default) !== "50") {
    await pool.execute("ALTER TABLE users ALTER COLUMN credits SET DEFAULT 50");
  }
}

export async function upsertUser({
  uid,
  email,
  displayName,
  photoURL,
  phoneNumber,
  emailVerified,
  providerId,
  lastLoginAt,
}) {
  await pool.execute(
    `INSERT INTO users (uid, email, display_name, photo_url, phone_number, is_email_verified, provider_id, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       display_name = VALUES(display_name),
       photo_url = VALUES(photo_url),
       phone_number = VALUES(phone_number),
       is_email_verified = VALUES(is_email_verified),
       provider_id = VALUES(provider_id),
       last_login_at = VALUES(last_login_at)`,
    [
      uid,
      email,
      displayName ?? null,
      photoURL ?? null,
      phoneNumber ?? null,
      emailVerified ? 1 : 0,
      providerId ?? null,
      lastLoginAt ?? null,
    ],
  );
}

export async function saveVideo({
  userUid,
  originalFilename,
  storedPath = null,
  status = "completed",
  mediaType = "video",
  mimeType = null,
  format = null,
  durationSeconds = null,
  sizeBytes = null,
  transcriptionId = null,
  subtitleJson = null,
  wordsJson = null,
}) {
  const [result] = await pool.execute(
    `INSERT INTO videos (user_uid, original_filename, stored_path, status, media_type, mime_type, format, duration_seconds, size_bytes, transcription_id, subtitle_json, words_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userUid,
      originalFilename,
      storedPath,
      status,
      mediaType,
      mimeType,
      format,
      durationSeconds,
      sizeBytes,
      transcriptionId,
      subtitleJson,
      wordsJson,
    ],
  );

  return result?.insertId ?? null;
}

export async function updateVideoSubtitles({ videoId, userUid, subtitleJson, wordsJson = undefined }) {
  // Only update words_json if explicitly provided (not undefined)
  let query, params;
  if (wordsJson !== undefined) {
    query = `UPDATE videos SET subtitle_json = ?, words_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_uid = ?`;
    params = [subtitleJson, wordsJson, videoId, userUid];
  } else {
    query = `UPDATE videos SET subtitle_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_uid = ?`;
    params = [subtitleJson, videoId, userUid];
  }

  const [result] = await pool.execute(query, params);
  return result;
}

export async function getUserVideos({ userUid, limit = 50, offset = 0 }) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const [rows] = await pool.execute(
    `SELECT id, original_filename, status, media_type, format, size_bytes, created_at, updated_at,
            (subtitle_json IS NOT NULL) AS has_subtitles,
            CASE
              WHEN duration_seconds IS NOT NULL THEN duration_seconds
              WHEN subtitle_json IS NOT NULL AND JSON_LENGTH(subtitle_json) > 0 THEN
                ROUND(JSON_UNQUOTE(JSON_EXTRACT(subtitle_json, CONCAT('$[', JSON_LENGTH(subtitle_json) - 1, '].end'))))
              ELSE NULL
            END AS duration_seconds
     FROM videos
     WHERE user_uid = ?
     ORDER BY created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [userUid],
  );

  return rows;
}


export async function getVideoById({ videoId, userUid }) {
  await touchVideo(pool, videoId, userUid);
  const [rows] = await pool.execute(
    `SELECT id, user_uid, original_filename, stored_path, status, media_type, mime_type, format, duration_seconds, size_bytes, transcription_id, subtitle_json, words_json, created_at, updated_at
     FROM videos
     WHERE id = ? AND user_uid = ?
     LIMIT 1`,
    [videoId, userUid],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
}

/**
 * Get user's credit balance
 * @param {string} userUid - User's Firebase UID
 * @returns {Promise<number|null>} Credit balance or null if user not found
 */
export async function getUserCredits(userUid) {
  const [rows] = await pool.execute(
    `SELECT credits FROM users WHERE uid = ? LIMIT 1`,
    [userUid],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0].credits;
}

/**
 * Deduct credits from user's balance (with transaction safety)
 * @param {string} userUid - User's Firebase UID
 * @param {number} amount - Amount of credits to deduct
 * @returns {Promise<{success: boolean, newBalance: number|null, error?: string}>}
 */
export async function deductCredits(userUid, amount) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Lock the user row and get current balance
    const [rows] = await connection.execute(
      `SELECT credits FROM users WHERE uid = ? FOR UPDATE`,
      [userUid],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      await connection.rollback();
      return { success: false, newBalance: null, error: 'User not found' };
    }

    const currentBalance = rows[0].credits;

    if (currentBalance < amount) {
      await connection.rollback();
      return { success: false, newBalance: currentBalance, error: 'Insufficient credits' };
    }

    const newBalance = currentBalance - amount;

    await connection.execute(
      `UPDATE users SET credits = ? WHERE uid = ?`,
      [newBalance, userUid],
    );

    await connection.commit();
    return { success: true, newBalance };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Record and credit a captured PayPal order once, atomically. */
export async function getRecordedPayment(orderId) {
  const [rows] = await pool.execute('SELECT user_uid, credits, paypal_capture_id FROM credit_payments WHERE paypal_order_id = ? LIMIT 1', [orderId]);
  return rows[0] ?? null;
}

export async function creditCapturedOrder(options) {
  const connection = await pool.getConnection();
  try { return await creditPayment(connection, options); }
  finally { connection.release(); }
}
export async function createTranscriptionJob({ jobId, userUid }) {
  await pool.execute(
    `INSERT INTO transcription_jobs (id, user_uid) VALUES (?, ?)`,
    [jobId, userUid],
  );
}

export async function getTranscriptionJob({ jobId, userUid }) {
  await pool.execute(
    `UPDATE transcription_jobs SET status = 'failed', error_message = ?
     WHERE id = ? AND user_uid = ? AND status = 'processing'
       AND updated_at < DATE_SUB(NOW(), INTERVAL ${JOB_STALE_SECONDS} SECOND)`,
    ['העיבוד הופסק בשרת. אפשר להעלות את הקובץ מחדש.', jobId, userUid],
  );
  const [rows] = await pool.execute(
    `SELECT status, result_json, error_message, stages_json,
            TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
     FROM transcription_jobs WHERE id = ? AND user_uid = ? LIMIT 1`,
    [jobId, userUid],
  );
  return rows[0] ?? null;
}

export async function finishTranscriptionJob({ jobId, result = null, error = null }) {
  await pool.execute(
    `UPDATE transcription_jobs SET status = ?, result_json = ?, error_message = ? WHERE id = ? AND status = 'processing'`,
    [error ? 'failed' : 'completed', result ? JSON.stringify(result) : null, error, jobId],
  );
}

export async function updateTranscriptionProgress(jobId, stages) {
  await pool.execute("UPDATE transcription_jobs SET stages_json = ?, updated_at = NOW() WHERE id = ? AND status = 'processing'", [JSON.stringify(stages), jobId]);
}

export async function completeTranscriptionJob(options) {
  const connection = await pool.getConnection();
  try { return await completeJob(connection, options); }
  finally { connection.release(); }
}

export async function ensureDevDummyUser({ uid, email, displayName }) {
  const lastLoginAt = new Date().toISOString().slice(0, 19).replace("T", " ");

  await pool.execute(
    `INSERT INTO users (uid, email, display_name, is_email_verified, provider_id, last_login_at, credits)
     VALUES (?, ?, ?, 1, 'dev-bypass', ?, 50)
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       display_name = VALUES(display_name),
       last_login_at = VALUES(last_login_at)`,
    [uid, email, displayName, lastLoginAt],
  );

  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS n FROM videos WHERE user_uid = ?`,
    [uid],
  );
  const existing = Number(rows?.[0]?.n ?? 0);
  if (existing > 0) {
    return;
  }

  const sampleSegments = JSON.stringify([
    { id: 1, start: 0, end: 3.2, text: "שלום, זה פרויקט דמה לבדיקות." },
    { id: 2, start: 3.2, end: 8.5, text: "אפשר לייצא כתוביות ולחזור לעריכה." },
  ]);

  await saveVideo({
    userUid: uid,
    originalFilename: "דוגמה-בדיקה.mp4",
    storedPath: null,
    status: "completed",
    mediaType: "video",
    format: ".srt",
    durationSeconds: 125,
    sizeBytes: 2_400_000,
    subtitleJson: sampleSegments,
  });

  await saveVideo({
    userUid: uid,
    originalFilename: "דוגמה-נכשלה.mp4",
    storedPath: null,
    status: "failed",
    mediaType: "video",
    format: ".srt",
    durationSeconds: 40,
    sizeBytes: 800_000,
    subtitleJson: null,
  });
}

export default pool;
