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
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_payments (
  paypal_order_id VARCHAR(64) NOT NULL PRIMARY KEY,
  paypal_capture_id VARCHAR(64) NOT NULL UNIQUE,
  user_uid VARCHAR(128) NOT NULL,
  credits INT NOT NULL,
  amount_usd DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_credit_payments_user_uid (user_uid),
  CONSTRAINT fk_credit_payments_user FOREIGN KEY (user_uid) REFERENCES users(uid)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS videos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_uid VARCHAR(128) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_path VARCHAR(512),
  status ENUM('uploaded','processing','completed','failed') DEFAULT 'uploaded',
  media_type ENUM('video','audio') DEFAULT 'video',
  mime_type VARCHAR(100),
  format VARCHAR(16),
  duration_seconds INT,
  size_bytes BIGINT,
  transcription_id VARCHAR(255),
  subtitle_json JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_videos_user_uid (user_uid),
  CONSTRAINT fk_videos_user FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
