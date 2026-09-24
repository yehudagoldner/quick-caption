import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { creditPayment } from '../src/creditPayments.js';
import { completeJob } from '../src/transcriptionJobs.js';

// Opt-in integration check. TEMPORARY tables shadow real tables only on this connection.
// Nothing is inserted into customer tables, and closing the connection removes the fixtures.
test('MySQL: grants, payment replay, rollback, and transcription completion', { skip: process.env.RUN_MYSQL_TESTS !== '1' }, async t => {
  await import('../src/loadAppEnv.js');
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 10_000 });
  t.after(() => connection.end());
  await connection.execute('CREATE TEMPORARY TABLE users (uid VARCHAR(128) PRIMARY KEY, credits INT NOT NULL DEFAULT 50) ENGINE=InnoDB');
  await connection.execute('CREATE TEMPORARY TABLE credit_payments (paypal_order_id VARCHAR(64) PRIMARY KEY, paypal_capture_id VARCHAR(64) NOT NULL UNIQUE, user_uid VARCHAR(128), credits INT, amount_usd DECIMAL(10,2)) ENGINE=InnoDB');
  await connection.execute("CREATE TEMPORARY TABLE transcription_jobs (id CHAR(36) PRIMARY KEY, user_uid VARCHAR(128), status VARCHAR(20), result_json LONGTEXT, error_message TEXT) ENGINE=InnoDB");
  await connection.execute("INSERT INTO users (uid) VALUES ('buyer')");
  const [[user]] = await connection.execute("SELECT credits FROM users WHERE uid = 'buyer'");
  assert.equal(user.credits, 50);
  const payment = { orderId: 'ORDER123456789', captureId: 'CAPTURE123456', userUid: 'buyer', credits: 100, amountUSD: '5.00' };
  assert.deepEqual(await creditPayment(connection, payment), { credited: true, newBalance: 150 });
  assert.deepEqual(await creditPayment(connection, payment), { credited: false, newBalance: 150 });
  await assert.rejects(creditPayment(connection, { ...payment, orderId: 'ANOTHERORDER' }));
  await assert.rejects(creditPayment(connection, { ...payment, orderId: 'UNKNOWNBUYER', captureId: 'ANOTHERCAPTURE', userUid: 'missing' }));
  const [[counts]] = await connection.execute('SELECT COUNT(*) AS n FROM credit_payments');
  assert.equal(counts.n, 1, 'Failed credits leave no payment ledger entry');
  await connection.execute("INSERT INTO transcription_jobs (id, user_uid, status) VALUES ('job', 'buyer', 'processing')");
  const completed = await completeJob(connection, { jobId: 'job', userUid: 'buyer', result: { videoId: 42 }, credits: 3 });
  assert.equal(completed.creditsRemaining, 147);
  assert.deepEqual(await completeJob(connection, { jobId: 'job', userUid: 'buyer', result: { videoId: 42 }, credits: 3 }), completed);
  const [[balance]] = await connection.execute("SELECT credits FROM users WHERE uid = 'buyer'");
  assert.equal(balance.credits, 147);
});
