export const DOWNLOAD_TABLES = [
  `CREATE TABLE IF NOT EXISTS media_upload_activity (
    video_id INT PRIMARY KEY, user_uid VARCHAR(128) NOT NULL,
    media_type VARCHAR(16) NOT NULL, original_filename VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_media_upload_user (user_uid, media_type)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS media_downloads (
    id CHAR(36) PRIMARY KEY, user_uid VARCHAR(128) NOT NULL, video_id INT NOT NULL,
    kind VARCHAR(16) NOT NULL, format VARCHAR(8) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_media_download_user (user_uid, kind, video_id),
    INDEX idx_media_download_created (created_at, id)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS download_feedback (
    download_id CHAR(36) PRIMARY KEY, rating TINYINT UNSIGNED NOT NULL,
    feedback VARCHAR(2000) NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_download_feedback_created (created_at, download_id)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
];

const failure = (status, message) => Object.assign(new Error(message), { status });

export function createDownloadStore(pool) {
  return {
    async recordDownload({ id, userUid, videoId, kind, format }) {
      const [[owned]] = await pool.execute(`SELECT a.video_id, a.user_uid, a.media_type FROM media_upload_activity a
        JOIN video_activity v ON v.video_id = a.video_id WHERE a.video_id = ? AND a.user_uid = ?`, [videoId, userUid]);
      if (!owned || owned.user_uid !== userUid || kind === 'video' && owned.media_type !== 'video') {
        throw failure(404, 'הסרטון לא נמצא או שאין הרשאה להוריד אותו.');
      }
      await pool.execute(`INSERT INTO media_downloads (id, user_uid, video_id, kind, format) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE id = id`, [id, userUid, videoId, kind, format]);
      const [[entry]] = await pool.execute('SELECT user_uid, video_id, kind, format FROM media_downloads WHERE id = ?', [id]);
      if (!entry || entry.user_uid !== userUid || Number(entry.video_id) !== videoId || entry.kind !== kind || entry.format !== format) {
        throw failure(409, 'מזהה ההורדה כבר נוצל עם פרטים אחרים.');
      }
      return { success: true, downloadId: id };
    },
    async saveFeedback({ downloadId, userUid, rating, feedback }) {
      const [[download]] = await pool.execute('SELECT kind, user_uid FROM media_downloads WHERE id = ? AND user_uid = ?', [downloadId, userUid]);
      if (!download || download.user_uid !== userUid) throw failure(404, 'לא נמצאה הורדה לדירוג.');
      await pool.execute(`INSERT INTO download_feedback (download_id, rating, feedback) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE rating = VALUES(rating), feedback = VALUES(feedback)`, [downloadId, rating, feedback]);
      return { success: true };
    },
    async feedback(page) {
      const [rows] = await pool.execute(`SELECT f.download_id AS id, f.rating, f.feedback, f.created_at AS createdAt,
        d.video_id AS videoId, u.email, u.display_name AS displayName, a.original_filename AS filename
        FROM download_feedback f JOIN media_downloads d ON d.id = f.download_id
        LEFT JOIN users u ON u.uid = d.user_uid LEFT JOIN media_upload_activity a ON a.video_id = d.video_id
        ORDER BY f.created_at DESC, f.download_id DESC LIMIT 25 OFFSET ${page * 25}`);
      const [[count]] = await pool.execute('SELECT COUNT(*) AS total FROM download_feedback');
      return { feedback: rows, total: Number(count.total), page, pageSize: 25 };
    },
  };
}
