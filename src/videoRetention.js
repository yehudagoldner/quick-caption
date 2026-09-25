import path from 'node:path';
import { promises as fs } from 'node:fs';
import { VIDEO_RETENTION_DAYS } from './mediaPolicy.js';

export async function ensureVideoRetention(db) {
  const [columns] = await db.query("SHOW COLUMNS FROM videos LIKE 'last_accessed_at'");
  if (!columns.length) {
    // Existing videos get a full grace period because historical reads were not tracked.
    await db.execute('ALTER TABLE videos ADD COLUMN last_accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD INDEX idx_videos_last_accessed (last_accessed_at)');
  }
}

export async function touchVideo(db, videoId, userUid) {
  // Keep the editor's last-modified timestamp unchanged when merely viewing a video.
  await db.execute('UPDATE videos SET last_accessed_at = CURRENT_TIMESTAMP, updated_at = updated_at WHERE id = ? AND user_uid = ?', [videoId, userUid]);
}

function mediaPath(root, storedPath) {
  if (typeof storedPath !== 'string' || !storedPath || storedPath === '.' || storedPath === '..' || /[/\\\0]/.test(storedPath)) throw new Error('Unsafe stored media path');
  return path.join(root, storedPath);
}

async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function regularFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Media must be a regular file');
    return stat;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function clearJournal(dir) {
  await fs.unlink(path.join(dir, 'manifest.json'));
  await fs.rmdir(dir);
}

// The journal makes a crash between filesystem changes and the SQL commit recoverable.
async function recoverJournal(db, root, trash) {
  let recovered = 0;
  for (const entry of await fs.readdir(trash, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[1-9]\d*$/.test(entry.name)) throw new Error('Unexpected retention journal entry');
    const dir = path.join(trash, entry.name);
    const manifest = path.join(dir, 'manifest.json');
    if (!await exists(manifest)) {
      // A crash before writing the manifest cannot have moved any media.
      await fs.rmdir(dir);
      continue;
    }
    const { storedPath } = JSON.parse(await fs.readFile(manifest, 'utf8'));
    const original = mediaPath(root, storedPath), staged = path.join(dir, 'media');
    await db.beginTransaction();
    try {
      const [rows] = await db.execute('SELECT stored_path FROM videos WHERE id = ? FOR UPDATE', [Number(entry.name)]);
      if (rows.length && rows[0].stored_path !== storedPath) throw new Error('Retention journal no longer matches video');
      if (await regularFile(staged)) {
        if (rows.length) {
          if (await exists(original)) throw new Error('Cannot restore over existing media');
          await fs.rename(staged, original);
        } else await fs.unlink(staged);
      }
      await db.commit();
      await clearJournal(dir);
      recovered++;
    } catch (error) { await db.rollback(); throw error; }
  }
  return recovered;
}

export async function cleanupInactiveVideos({ connection, storageDir, dryRun = true }) {
  const root = await fs.realpath(storageDir);
  const db = connection;
  const [[lock]] = await db.execute("SELECT GET_LOCK('quick-caption-video-retention', 0) AS acquired");
  if (Number(lock.acquired) !== 1) return { skipped: 'already-running' };
  const stats = { dryRun, candidates: 0, deleted: 0, bytesRemoved: 0, recovered: 0 };
  const trash = path.join(root, '.retention-trash');
  try {
    if (!dryRun) {
      await fs.mkdir(trash, { mode: 0o700 });
    }
  } catch (error) {
    if (error.code !== 'EEXIST') { await db.execute("SELECT RELEASE_LOCK('quick-caption-video-retention')"); throw error; }
  }
  try {
    if (!dryRun) {
      if ((await fs.lstat(trash)).isSymbolicLink() || await fs.realpath(trash) !== trash) throw new Error('Unsafe retention journal directory');
      stats.recovered = await recoverJournal(db, root, trash);
    }
    const [[{ cutoff }]] = await db.execute(`SELECT DATE_SUB(NOW(), INTERVAL ${VIDEO_RETENTION_DAYS} DAY) AS cutoff`);
    const predicate = "status IN ('completed', 'failed') AND last_accessed_at < ? AND updated_at < ?";
    const [candidates] = await db.execute(`SELECT id FROM videos WHERE ${predicate} ORDER BY id LIMIT 1000`, [cutoff, cutoff]);
    stats.candidates = candidates.length;
    if (dryRun) return stats;
    for (const { id } of candidates) {
      await db.beginTransaction();
      let journal;
      try {
        // Recheck under the same row lock used by reads and edits: fresh activity wins.
        const [rows] = await db.execute(`SELECT id, user_uid, stored_path, transcription_id FROM videos WHERE id = ? AND ${predicate} FOR UPDATE`, [id, cutoff, cutoff]);
        const video = rows[0];
        if (!video) { await db.commit(); continue; }
        let removedBytes = 0;
        if (video.stored_path) {
          const original = mediaPath(root, video.stored_path);
          const [otherReferences] = await db.execute('SELECT id FROM videos WHERE stored_path = ? AND id <> ? LIMIT 1', [video.stored_path, id]);
          const stat = await regularFile(original);
          if (stat && !otherReferences.length) {
            journal = path.join(trash, String(id));
            await fs.mkdir(journal, { mode: 0o700 });
            await fs.writeFile(path.join(journal, 'manifest.json'), JSON.stringify({ storedPath: video.stored_path }), { flag: 'wx', mode: 0o600 });
            await fs.rename(original, path.join(journal, 'media'));
            removedBytes = stat.size;
          }
        }
        await db.execute("DELETE FROM transcription_jobs WHERE user_uid = ? AND status <> 'processing' AND (JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.videoId')) = ? OR id = ?)", [video.user_uid, String(id), video.transcription_id ?? '']);
        await db.execute('DELETE FROM videos WHERE id = ?', [id]);
        await db.commit();
        stats.deleted++;
        if (journal) {
          await fs.unlink(path.join(journal, 'media'));
          await clearJournal(journal);
        }
        stats.bytesRemoved += removedBytes;
      } catch (error) {
        await db.rollback();
        // Restore media on a rolled-back transaction, or finish deletion after a commit.
        await recoverJournal(db, root, trash);
        throw error;
      }
    }
    return stats;
  } finally { await db.execute("SELECT RELEASE_LOCK('quick-caption-video-retention')"); }
}
