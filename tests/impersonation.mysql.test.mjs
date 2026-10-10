import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { createAdminStore } from '../src/adminStore.js';
import { createImpersonationSessions } from '../src/impersonation.js';

test('QA MySQL profiles and impersonation audit use the real store without modifying account rows',
  { skip: process.env.RUN_MYSQL_TESTS !== '1' }, async t => {
    await import('../src/loadAppEnv.js');
    assert.equal(process.env.DB_NAME, 'quickcaption_qa');
    assert.equal(process.env.DB_USER, 'quickcaption_qa');
    const db = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    t.after(() => db.end());
    // Connection-local fixtures shadow the tables; existing QA users are untouched.
    await db.execute(`CREATE TEMPORARY TABLE users (uid VARCHAR(128) PRIMARY KEY, email VARCHAR(255),
      display_name VARCHAR(255), photo_url TEXT, phone_number VARCHAR(32), is_email_verified TINYINT,
      provider_id VARCHAR(128))`);
    await db.execute(`CREATE TEMPORARY TABLE admin_audit (request_id CHAR(36) PRIMARY KEY,
      actor_email VARCHAR(255), action VARCHAR(32), target VARCHAR(255))`);
    await db.execute(`INSERT INTO users VALUES ('member', 'member@example.com', 'Member', NULL, NULL, 0, 'google.com')`);
    const store = createAdminStore(db);
    const sessions = createImpersonationSessions(store);
    const actor = { uid: 'owner', email: 'goldnery@gmail.com', emailVerified: true, browserConnectionId: 'owner-login' };
    const session = await sessions.start(actor, 'member');
    assert.equal(session.user.uid, 'member');
    assert.equal(session.user.emailVerified, false);
    assert.equal(session.user.providerId, 'google.com');
    assert.equal((await sessions.profile(session.token, actor)).user.displayName, 'Member');
    await sessions.stop(session.token, actor);
    const [audit] = await db.execute('SELECT actor_email, action, target FROM admin_audit ORDER BY action');
    assert.deepEqual(audit.map(row => ({ ...row })), [
      { actor_email: actor.email, action: 'impersonation-start', target: 'member' },
      { actor_email: actor.email, action: 'impersonation-stop', target: 'member' },
    ]);
    const [[count]] = await db.execute('SELECT COUNT(*) AS count FROM users');
    assert.equal(count.count, 1);
    await assert.rejects(sessions.profile(session.token, actor), { code: 'IMPERSONATION_EXPIRED' });
  });
