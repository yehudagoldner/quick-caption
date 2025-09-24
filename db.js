import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

  const [columns] = await pool.query("SHOW COLUMNS FROM videos LIKE 'subtitle_json'");
  if (Array.isArray(columns) && columns.length === 0) {
    await pool.execute("ALTER TABLE videos ADD COLUMN subtitle_json JSON NULL");
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
  format = null,
  durationSeconds = null,
  sizeBytes = null,
  transcriptionId = null,
  subtitleJson = null,
}) {
  const [result] = await pool.execute(
    `INSERT INTO videos (user_uid, original_filename, stored_path, status, media_type, format, duration_seconds, size_bytes, transcription_id, subtitle_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userUid,
      originalFilename,
      storedPath,
      status,
      mediaType,
      format,
      durationSeconds,
      sizeBytes,
      transcriptionId,
      subtitleJson,
    ],
  );

  return result?.insertId ?? null;
}

export async function updateVideoSubtitles({ videoId, userUid, subtitleJson }) {
  const [result] = await pool.execute(
    `UPDATE videos SET subtitle_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_uid = ?`,
    [subtitleJson, videoId, userUid],
  );

  return result;
}

export default pool;
