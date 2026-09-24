export const JOB_STALE_SECONDS = 120;

export function trackTranscriptionProgress({ update, emit, heartbeatMs = 20_000 }) {
  const stages = {};
  let stopped = false;
  let pending = Promise.resolve();
  const persist = () => {
    const snapshot = Object.values(stages).map(stage => ({ ...stage }));
    pending = pending.catch(() => {}).then(() => update(snapshot));
    // Progress persistence is best effort; completion is saved separately and atomically.
    void pending.catch(error => console.error('Failed to update transcription progress:', error.code ?? error.name));
  };
  const timer = setInterval(persist, heartbeatMs);
  timer.unref?.();
  return {
    emit(stage, status, message) {
      if (stopped) return;
      stages[stage] = { stage, status, message: message ?? null };
      emit(stage, status, message);
      persist();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending.catch(() => {});
    },
  };
}

// Save completion and charge together: a persistence failure must not charge for a failed job.
export async function completeJob(connection, { jobId, userUid, result, credits }) {
  if (!Number.isSafeInteger(credits) || credits < 0) throw new Error('Invalid transcription credits');
  try {
    await connection.beginTransaction();
    const [jobs] = await connection.execute('SELECT status, result_json FROM transcription_jobs WHERE id = ? AND user_uid = ? FOR UPDATE', [jobId, userUid]);
    if (jobs[0]?.status === 'completed') {
      await connection.commit();
      return JSON.parse(jobs[0].result_json);
    }
    if (jobs[0]?.status !== 'processing') throw new Error('Transcription job is no longer active');
    const [users] = await connection.execute('SELECT credits FROM users WHERE uid = ? FOR UPDATE', [userUid]);
    if (!users.length) throw new Error('User not found');
    // Preserve the existing policy of delivering completed work when the balance changed meanwhile.
    const charged = users[0].credits >= credits ? credits : 0;
    const payload = { ...result, creditsUsed: charged, creditsRemaining: users[0].credits - charged };
    await connection.execute('UPDATE users SET credits = credits - ? WHERE uid = ?', [charged, userUid]);
    await connection.execute("UPDATE transcription_jobs SET status = 'completed', result_json = ?, error_message = NULL WHERE id = ?", [JSON.stringify(payload), jobId]);
    await connection.commit();
    return payload;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
