import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { ADMIN_TABLES, ensureAdminSchema, createAdminStore, grantAdminCredits } from '../src/adminStore.js';

test('MySQL admin reporting, idempotent credit grants, rollback and persistent media totals', { skip: process.env.RUN_MYSQL_TESTS !== '1' }, async t => {
  await import('../src/loadAppEnv.js');
  const db = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 10000 });
  t.after(() => db.end());
  await db.execute(`CREATE TEMPORARY TABLE users (id INT PRIMARY KEY, uid VARCHAR(128) UNIQUE, email VARCHAR(255), display_name VARCHAR(255), credits INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await db.execute(`CREATE TEMPORARY TABLE videos (id INT PRIMARY KEY, user_uid VARCHAR(128), original_filename VARCHAR(255), media_type VARCHAR(16), duration_seconds INT, subtitle_json JSON, status VARCHAR(16), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await db.execute(`CREATE TEMPORARY TABLE credit_payments (user_uid VARCHAR(128), amount_usd DECIMAL(10,2)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const sql of ADMIN_TABLES) await db.execute(sql.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE'));
  await db.execute("INSERT INTO users (id, uid, email, display_name, credits) VALUES (1, 'buyer', 'buyer@example.com', 'Buyer', 50), (2, 'free', 'free@example.com', 'Free', 50)");
  await db.execute("INSERT INTO videos (id, user_uid, media_type, duration_seconds, subtitle_json, status) VALUES (1, 'buyer', 'video', 60, NULL, 'completed'), (2, 'free', 'audio', NULL, '[{\"end\":30}]', 'completed')");
  await db.execute("INSERT INTO credit_payments VALUES ('buyer', 5.00), ('buyer', 20.00)");
  const schemaDb = { execute: (sql, params) => db.execute(sql.replace(/^CREATE TABLE IF NOT EXISTS/, 'CREATE TEMPORARY TABLE IF NOT EXISTS'), params) };
  await ensureAdminSchema(schemaDb);
  await ensureAdminSchema(schemaDb);
  const store = createAdminStore({ execute: (...args) => db.execute(...args), query: (...args) => db.query(...args),
    getConnection: async () => ({ execute: (...args) => db.execute(...args), beginTransaction: () => db.beginTransaction(),
      commit: () => db.commit(), rollback: () => db.rollback(), release: () => {} }) });
  const stats = await store.overview();
  assert.equal(Number(stats.revenue.revenueUSD), 25);
  assert.equal(Number(stats.users.paying), 1); assert.equal(stats.users.free, 1);
  assert.equal(Number(stats.media.processed), 2); assert.equal(Number(stats.media.durationSeconds), 90);
  await db.execute('DELETE FROM videos');
  assert.equal(Number((await store.overview()).media.durationSeconds), 90);
  assert.equal(await store.isAdmin('goldnery@gmail.com'), true);
  const adminGrant = { email: 'delegate@example.com', actor: 'goldnery@gmail.com', requestId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' };
  await store.grantAdmin(adminGrant); await store.grantAdmin(adminGrant);
  assert.equal(await store.isAdmin('delegate@example.com'), true);
  await assert.rejects(store.grantAdmin({ ...adminGrant, email: 'other@example.com' }));
  assert.equal(await store.isAdmin('other@example.com'), false);
  const grant = { actor: 'goldnery@gmail.com', userUid: 'buyer', credits: 100, reason: 'Support', requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
  assert.deepEqual(await grantAdminCredits(db, grant), { credited: true, newBalance: 150 });
  assert.deepEqual(await grantAdminCredits(db, grant), { credited: false, newBalance: 150 });
  await assert.rejects(grantAdminCredits(db, { ...grant, credits: 101 }));
  await assert.rejects(grantAdminCredits(db, { ...grant, userUid: 'missing', requestId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }));
  const [[audit]] = await db.execute('SELECT COUNT(*) AS n FROM admin_audit'); assert.equal(audit.n, 2);
  const users = await store.users('buyer', 0); assert.equal(users.total, 1); assert.equal(users.users[0].credits, 150);
  await store.recordUsage({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', userUid: 'buyer', operation: '/api/transcribe', model: 'gpt-6-luna', serviceTier: 'fast', status: 'completed', inputTokens: 100, outputTokens: 20, cachedTokens: 0, durationSeconds: null, costUSD: 0.00004, costBasis: 'tokens', usage: {} });
  assert.equal(Number((await store.overview()).usage.costUSD), 0.00004);
});
