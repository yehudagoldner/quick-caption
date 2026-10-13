import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../src/loadAppEnv.js';
import { createConnectionStore } from '../src/accountConnections.js';

const qa = process.env.DB_NAME === 'quickcaption_qa' && process.env.DB_USER === 'quickcaption_qa';
test('QA: parallel browser authentication preserves one login without deadlocks or revocation bypass', { skip: !qa }, async t => {
  const { default: pool } = await import('../db.js');
  const uid = `qa-auth-race-${randomUUID()}`;
  t.after(async () => {
    try {
      await pool.execute('DELETE FROM browser_connections WHERE user_uid = ?', [uid]);
      await pool.execute('DELETE FROM account_connection_state WHERE user_uid = ?', [uid]);
    } finally { await pool.end(); }
  });
  const store = createConnectionStore(pool);
  const identity = { uid, authTime: Math.floor(Date.now() / 1000) - 100 };
  const current = await store.browser(identity, 'Windows Chrome/150.0');
  // Reproduce the dashboard's concurrent requests against an existing login.
  // Wait for every transaction before asserting so cleanup never races a write.
  for (let round = 0; round < 20; round++) {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => store.browser(identity)));
    const failures = results.filter(result => result.status === 'rejected');
    assert.deepEqual(failures.map(result => result.reason.code ?? result.reason.name), [], `Authentication round ${round}`);
    assert.ok(results.every(result => result.value.browserConnectionId === current.browserConnectionId));
  }
  assert.equal((await store.list(uid)).length, 1);

  await store.revokeAll(uid);
  const [before] = await pool.execute('SELECT revoked_before FROM account_connection_state WHERE user_uid = ?', [uid]);
  const revoked = await Promise.allSettled(Array.from({ length: 20 }, () => store.browser(identity)));
  assert.ok(revoked.every(result => result.status === 'rejected' && result.reason.code === 'CONNECTION_REVOKED'));
  const [after] = await pool.execute('SELECT revoked_before FROM account_connection_state WHERE user_uid = ?', [uid]);
  assert.equal(Number(after[0].revoked_before), Number(before[0].revoked_before), 'Authentication must preserve the revocation cutoff');
  assert.equal((await store.list(uid)).length, 0);
});
