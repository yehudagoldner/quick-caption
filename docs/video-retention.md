# Media limits and retention

- Uploads are limited to 500,000,000 bytes (500 MB), inclusive, on all three multipart media endpoints. The browser checks selected/dropped files before upload. No duration limit is added.
- Videos/audio and their subtitles expire after 30 days without opening, media access, export, or edits. Listing the library does not count as activity.
- `videos.last_accessed_at` tracks reads; `updated_at` tracks edits. Both must be older than 30 days. The additive migration gives all existing records a full 30-day grace period because historical reads were not tracked.
- Cleanup removes completed/failed video rows, associated completed/failed transcription results, and the corresponding media. Processing records, accounts, credits and payment records are retained.
- A MySQL advisory lock prevents concurrent cleanup; each candidate is rechecked under a row lock. Media is first staged in `.retention-trash` with a journal, then SQL is committed, then the staged file is removed. A restart restores media if SQL did not commit, or finishes deletion if it did. Missing media does not prevent removal of an expired row. Paths outside storage and symlinks are rejected.
- Run `node scripts/cleanup-videos.js --dry-run` from the configured release for a preview, or `--apply` to execute. Each run processes up to 1,000 candidates; larger backlogs continue on the following daily run.
- Production `/etc/cron.d/quick-caption-cleanup` calls the installed `run-video-cleanup.cjs` daily. It discovers the active `caption` release and its runtime environment using PM2. The launcher uses an explicit mode and does not contain secrets.
- Logs contain counts and error codes, not filenames or credentials. Production log rotation bounds log storage. Do not remove pending `.retention-trash` journals manually.
- To pause retention, disable that specific cron entry. Code rollback does not remove the new column. After rollback to a version without activity tracking, leave cleanup disabled until tracking is restored and a new grace period is deliberately applied.
