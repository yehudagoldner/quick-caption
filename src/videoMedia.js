// Replace only source metadata. Caption text, word timings, format and billing
// history belong to the existing project and must never be rewritten here.
export function createVideoMediaStore(pool) {
  return async ({ videoId, userUid, previousStoredPath, storedPath, originalFilename, mimeType, durationSeconds, sizeBytes }) => {
    const [result] = await pool.execute(
      `UPDATE videos SET stored_path = ?, original_filename = ?, media_type = 'video', mime_type = ?,
       duration_seconds = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_uid = ? AND stored_path <=> ?`,
      [storedPath, originalFilename, mimeType, durationSeconds, sizeBytes, videoId, userUid, previousStoredPath],
    );
    return result.affectedRows > 0;
  };
}
