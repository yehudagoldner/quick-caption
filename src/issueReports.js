export const ISSUE_REPORT_SCHEMA = `CREATE TABLE IF NOT EXISTS issue_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_uid VARCHAR(128) NOT NULL,
  user_email VARCHAR(255),
  user_display_name VARCHAR(255),
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  screen VARCHAR(32) NOT NULL,
  screenshot MEDIUMBLOB NULL,
  screenshot_mime_type VARCHAR(32) NULL,
  status ENUM('open','in_progress','resolved') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_issue_reports_status_created (status, created_at),
  INDEX idx_issue_reports_created (created_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

export const ISSUE_REPORT_STATUSES = new Set(['open', 'in_progress', 'resolved']);
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export function parseReportScreenshot(value) {
  if (value == null) return null;
  const invalid = () => { const error = new Error('יש לצרף תמונת PNG, JPG או WebP תקינה, עד 5 MB.'); error.status = 400; throw error; };
  if (typeof value !== 'object' || typeof value.data !== 'string' ||
      value.data.length > 4 * Math.ceil(MAX_SCREENSHOT_BYTES / 3) || !value.data.length) return invalid();
  const buffer = Buffer.from(value.data, 'base64');
  if (buffer.length > MAX_SCREENSHOT_BYTES || buffer.toString('base64') !== value.data) return invalid();
  let mimeType;
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      buffer.toString('ascii', 12, 16) === 'IHDR') mimeType = 'image/png';
  else if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mimeType = 'image/jpeg';
  else if (buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.readUInt32LE(4) === buffer.length - 8) mimeType = 'image/webp';
  if (!mimeType || mimeType !== value.mimeType) return invalid();
  return { buffer, mimeType };
}

export async function ensureIssueReportSchema(pool) {
  await pool.execute(ISSUE_REPORT_SCHEMA);
  const [columns] = await pool.query('SHOW COLUMNS FROM issue_reports');
  if (!columns.some(column => column.Field === 'screenshot')) await pool.execute('ALTER TABLE issue_reports ADD COLUMN screenshot MEDIUMBLOB NULL');
  if (!columns.some(column => column.Field === 'screenshot_mime_type')) await pool.execute('ALTER TABLE issue_reports ADD COLUMN screenshot_mime_type VARCHAR(32) NULL');
}

export function createIssueReportStore(pool) {
  return {
    async createIssueReport({ userUid, email, displayName, title, description, screen, screenshot = null }) {
      const [result] = await pool.execute(
        `INSERT INTO issue_reports (user_uid, user_email, user_display_name, title, description, screen, screenshot, screenshot_mime_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userUid, email, displayName, title, description, screen, screenshot?.buffer ?? null, screenshot?.mimeType ?? null],
      );
      return result.insertId;
    },
    async getIssueReports({ status, page }) {
      const where = status ? 'WHERE status = ?' : '';
      const values = status ? [status] : [];
      const [reports] = await pool.execute(
        `SELECT id, user_uid, user_email, user_display_name, title, description, screen, status, created_at, updated_at,
         screenshot IS NOT NULL AS has_screenshot
         FROM issue_reports ${where} ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`, values,
      );
      const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM issue_reports ${where}`, values);
      return { reports, total: Number(count.total), page, pageSize: 50 };
    },
    async updateIssueReportStatus({ reportId, status }) {
      const [result] = await pool.execute('UPDATE issue_reports SET status = ? WHERE id = ?', [status, reportId]);
      return result.affectedRows > 0;
    },
    async getIssueReportScreenshot(reportId) {
      const [[row]] = await pool.execute('SELECT screenshot, screenshot_mime_type FROM issue_reports WHERE id = ? AND screenshot IS NOT NULL', [reportId]);
      return row ? { buffer: row.screenshot, mimeType: row.screenshot_mime_type } : null;
    },
  };
}
