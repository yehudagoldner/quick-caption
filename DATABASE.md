# Database Structure

## Overview
The application uses MySQL with UTF-8MB4 encoding for proper Hebrew text support.

## Tables

### `users`
Stores Firebase authenticated users synced to MySQL.

| Column | Type | Description |
|--------|------|-------------|
| id | INT | Auto-increment primary key |
| uid | VARCHAR(128) | Firebase UID (unique) |
| email | VARCHAR(255) | User email |
| display_name | VARCHAR(255) | User display name |
| photo_url | TEXT | Profile photo URL |
| phone_number | VARCHAR(32) | Phone number |
| is_email_verified | TINYINT(1) | Email verification status |
| provider_id | VARCHAR(128) | Auth provider ID |
| last_login_at | DATETIME | Last login timestamp |
| created_at | TIMESTAMP | Record creation time |
| updated_at | TIMESTAMP | Last update time |

**Indexes:**
- PRIMARY KEY on `id`
- UNIQUE KEY on `uid`

### `videos`
Stores video metadata and subtitles.

| Column | Type | Description |
|--------|------|-------------|
| id | INT | Auto-increment primary key |
| user_uid | VARCHAR(128) | Foreign key to users.uid |
| original_filename | VARCHAR(255) | Original uploaded filename |
| stored_path | VARCHAR(512) | Relative path to stored file |
| status | ENUM | uploaded, processing, completed, failed |
| media_type | ENUM | video or audio |
| mime_type | VARCHAR(100) | MIME type (e.g., video/mp4) |
| format | VARCHAR(16) | Subtitle format (.srt, .vtt, .txt) |
| duration_seconds | INT | Video duration |
| size_bytes | BIGINT | File size in bytes |
| transcription_id | VARCHAR(255) | External transcription service ID |
| subtitle_json | JSON | Subtitle segments as JSON array |
| created_at | TIMESTAMP | Record creation time |
| updated_at | TIMESTAMP | Last update time |

**Indexes:**
- PRIMARY KEY on `id`
- INDEX on `user_uid`
- FOREIGN KEY: `user_uid` REFERENCES `users(uid)` ON DELETE CASCADE

## Subtitle JSON Structure

The `subtitle_json` column stores an array of segment objects:

```json
[
  {
    "id": 0,
    "start": 0,
    "end": 21,
    "text": "Hebrew subtitle text here"
  },
  {
    "id": 1,
    "start": 21,
    "end": 25,
    "text": "More subtitle text"
  }
]
```

### Segment Fields:
- `id`: Unique segment identifier (integer)
- `start`: Start time in seconds (float)
- `end`: End time in seconds (float)
- `text`: Subtitle text (string, UTF-8)

## File Storage

### Video Files
- Location: `stored-videos/` directory in project root
- Filename format: `{user_uid}_{timestamp}_{sanitized_original_name}`
- Example: `abc123_1234567890_my_video.mp4`
- Database stores relative filename in `stored_path` column

### Temporary Files
- Upload location: System temp directory + `/subtitles-api-uploads`
- Automatically cleaned after processing

## Character Encoding

- All tables use `utf8mb4` character set
- Collation: `utf8mb4_unicode_ci`
- Supports full Unicode including Hebrew, emojis, etc.

## Database Migrations

The application auto-creates and migrates the schema on startup via `ensureSchema()` in `db.js`:

1. Creates `users` table if not exists
2. Creates `videos` table if not exists
3. Adds `subtitle_json` column if missing (legacy migration)
4. Adds `mime_type` column if missing

## Maintenance Scripts

### Check Database
```bash
node scripts/check-database.js
```

Shows:
- Table structure and encoding
- Video statistics
- Sample data inspection
- Recommendations for improvements

## API Data Flow

1. **Upload** → Video saved to `stored-videos/`, metadata + subtitles to DB
2. **Edit** → Fetch video metadata from DB, serve file from `stored-videos/`
3. **Update** → Update `subtitle_json` in DB
4. **Delete** → Cascade delete via foreign key removes all user videos

## Best Practices

✅ **DO:**
- Always pass `userUid` for security
- Use parameterized queries (already implemented)
- Store subtitles as JSON for easy querying/editing
- Keep original filename for user reference

❌ **DON'T:**
- Store video files in database (use filesystem)
- Hardcode user IDs
- Mix encoding types (stick to UTF-8MB4)