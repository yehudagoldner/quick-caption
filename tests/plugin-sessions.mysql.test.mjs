import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import '../src/loadAppEnv.js';

const qa = process.env.DB_NAME === 'quickcaption_qa' && process.env.DB_USER === 'quickcaption_qa';
test('QA: one-time pairing, token rotation, ownership, revocation and live balance', { skip: !qa }, async t => {
  const { default: pool, upsertUser, getUserCredits, createTranscriptionJob, completeTranscriptionJob } = await import('../db.js');
  const { createPluginSessions, ensurePluginSchema } = await import('../src/pluginSessions.js');
  await ensurePluginSchema(pool);
  const uid = `qa-plugin-fixture-${randomUUID()}`, otherUid = `qa-plugin-fixture-${randomUUID()}`;
  const identity = { uid, email: 'plugin-fixture@example.invalid', displayName: 'QA fixture' };
  const links = [];
  t.after(async () => {
    for (const id of links) await pool.execute('DELETE FROM plugin_links WHERE id = ?', [id]);
    await pool.execute('DELETE FROM users WHERE uid IN (?, ?)', [uid, otherUid]);
    await pool.end();
  });
  await upsertUser(identity);
  await upsertUser({ uid: otherUid, email: 'other-fixture@example.invalid' });
  const sessions = createPluginSessions(pool);
  const link = await sessions.start(); links.push(link.id);
  assert.deepEqual(await sessions.poll(link.id, link.deviceSecret), { status: 'pending' });
  await assert.rejects(sessions.poll(link.id, 'x'.repeat(43)), { status: 410 });
  await assert.rejects(sessions.approve(link.id, '00000000', identity), { status: 410 });
  await sessions.approve(link.id, link.userCode, identity);
  await assert.rejects(sessions.approve(link.id, link.userCode, { uid: otherUid }), { status: 409 });
  const polls = await Promise.allSettled([sessions.poll(link.id, link.deviceSecret), sessions.poll(link.id, link.deviceSecret)]);
  assert.equal(polls.filter(item => item.status === 'fulfilled').length, 1);
  const paired = polls.find(item => item.status === 'fulfilled').value;
  assert.equal(paired.user.uid, uid);
  await assert.rejects(sessions.poll(link.id, link.deviceSecret), { status: 410 });
  const verified = await sessions.verify(paired.accessToken);
  assert.equal(verified.uid, uid);
  const [stored] = await pool.execute('SELECT access_hash, refresh_hash FROM plugin_sessions WHERE id = ?', [verified.pluginSessionId]);
  assert.equal(stored[0].access_hash, createHash('sha256').update(paired.accessToken).digest('hex'));
  assert.equal(stored[0].refresh_hash, createHash('sha256').update(paired.refreshToken).digest('hex'));
  const rotations = await Promise.allSettled([sessions.refresh(paired.refreshToken), sessions.refresh(paired.refreshToken)]);
  assert.equal(rotations.filter(item => item.status === 'fulfilled').length, 1);
  const rotated = rotations.find(item => item.status === 'fulfilled').value;
  assert.equal(await sessions.verify(paired.accessToken), null);
  await assert.rejects(sessions.refresh(paired.refreshToken), { status: 401 });
  assert.equal((await sessions.verify(rotated.accessToken)).uid, uid);

  const base = 'http://127.0.0.1:3100';
  const request = (path, token = rotated.accessToken, body) => fetch(base + path, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const initial = await (await request('/api/plugin/account')).json();
  assert.equal(initial.user.uid, uid); assert.equal(initial.credits, await getUserCredits(uid));
  const jobId = randomUUID();
  await createTranscriptionJob({ jobId, userUid: uid });
  const completed = await completeTranscriptionJob({ jobId, userUid: uid, result: { text: 'fixture' }, credits: 3 });
  assert.equal(completed.creditsRemaining, initial.credits - 3);
  await completeTranscriptionJob({ jobId, userUid: uid, result: { text: 'fixture' }, credits: 3 });
  assert.equal(await getUserCredits(uid), initial.credits - 3, 'Replayed completion cannot charge again');
  await pool.execute('UPDATE users SET credits = 123 WHERE uid = ?', [uid]);
  const fresh = await (await request('/api/plugin/account')).json();
  assert.equal(fresh.credits, 123); assert.ok(fresh.policy.version);
  const quote = await (await request('/api/plugin/quote', rotated.accessToken, { durationSeconds: 60 })).json();
  assert.equal(quote.credits, 123); assert.equal(quote.policyVersion, fresh.policy.version);
  const jobState = await (await request(`/api/transcribe/jobs/${jobId}`)).json();
  assert.equal(jobState.creditsRemaining, 123, 'Job polling reads the current account balance');
  assert.equal(jobState.result.creditsRemaining, initial.credits - 3, 'Historical receipt is preserved');
  const media = Buffer.from((await readFile(new URL('./fixtures/portrait-video.base64', import.meta.url), 'utf8')).trim(), 'base64');
  const upload = async (policyVersion, pluginVersion = '1.0.0') => {
    const form = new FormData();
    form.append('media', new Blob([media], { type: 'video/webm' }), 'plugin-fixture.webm');
    form.append('jobId', jobId);
    form.append('billingPolicyVersion', policyVersion);
    return fetch(base + '/api/transcribe', { method: 'POST', headers: { Authorization: `Bearer ${rotated.accessToken}`, 'X-Quick-Caption-Version': pluginVersion }, body: form });
  };
  assert.equal((await upload(fresh.policy.version, '0.9.0')).status, 426);
  assert.equal((await upload('outdated-policy')).status, 409);
  const replay = await upload(fresh.policy.version);
  assert.equal(replay.status, 202); assert.equal((await replay.json()).replayed, true);
  assert.equal(await getUserCredits(uid), 123, 'Retrying a completed upload never starts paid work');
  const [video] = await pool.execute(`INSERT INTO videos (user_uid, original_filename, status, subtitle_json) VALUES (?, 'qa-plugin-fixture.mp4', 'completed', ?)`,
    [uid, JSON.stringify([{ id: 1, start: 0, end: 1, text: 'first' }])]);
  const subtitlePath = `/api/plugin/videos/${video.insertId}/subtitles`;
  assert.match((await (await request(subtitlePath)).json()).srt, /first/);
  await pool.execute('UPDATE videos SET subtitle_json = ? WHERE id = ?', [JSON.stringify([{ id: 1, start: 0, end: 1, text: 'updated' }]), video.insertId]);
  assert.match((await (await request(subtitlePath)).json()).srt, /updated/, 'Subtitles are fetched anew after website edits');
  await pool.execute('UPDATE videos SET user_uid = ? WHERE id = ?', [otherUid, video.insertId]);
  assert.equal((await request(subtitlePath)).status, 404, 'Plugin cannot import another account\'s captions');
  assert.equal((await request('/api/users/credits?userUid=' + otherUid)).status, 200);
  assert.equal((await (await request('/api/users/credits?userUid=' + otherUid)).json()).credits, 123);
  assert.equal((await request('/api/payments/create-order', rotated.accessToken, {})).status, 403);
  assert.equal((await request('/api/users/sync', rotated.accessToken, {})).status, 403);
  assert.equal((await request('/api/admin/session')).status, 401);
  assert.equal((await request('/api/plugin/link/approve', rotated.accessToken, { id: link.id, userCode: link.userCode })).status, 401);
  assert.equal((await request('/api/plugin/logout', rotated.accessToken, {})).status, 200);
  assert.equal(await sessions.verify(rotated.accessToken), null);
  await assert.rejects(sessions.refresh(rotated.refreshToken), { status: 401 });
  assert.equal((await request('/api/plugin/account')).status, 401);

  const expired = await sessions.start(); links.push(expired.id);
  await pool.execute('UPDATE plugin_links SET expires_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?', [expired.id]);
  await assert.rejects(sessions.poll(expired.id, expired.deviceSecret), { status: 410 });
});
