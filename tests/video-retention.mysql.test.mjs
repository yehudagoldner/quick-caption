import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanupInactiveVideos, ensureVideoRetention, touchVideo } from '../src/videoRetention.js';

test('retention migration, activity, deletion, concurrency and crash recovery use isolated temporary tables', { skip: process.env.RUN_MYSQL_TESTS !== '1' }, async t => {
  await import('../src/loadAppEnv.js');
  const db = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-retention-test-'));
  t.after(async () => {
    await db.end();
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('caption-retention-test-')) throw new Error('Unsafe test cleanup directory');
    await fs.rm(dir, { recursive: true });
  });
  await db.execute("CREATE TEMPORARY TABLE videos (id INT PRIMARY KEY, user_uid VARCHAR(128), stored_path VARCHAR(255), transcription_id VARCHAR(255), status VARCHAR(20), updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)");
  await db.execute('CREATE TEMPORARY TABLE transcription_jobs (id VARCHAR(255), user_uid VARCHAR(128), status VARCHAR(20), result_json JSON)');
  await db.execute("INSERT INTO videos VALUES (1,'buyer','old.mp4',NULL,'completed',DATE_SUB(NOW(), INTERVAL 90 DAY))");
  // ALTER ADD DEFAULT CURRENT_TIMESTAMP grants pre-existing files a 30-day grace.
  await ensureVideoRetention(db);
  await ensureVideoRetention(db);
  const [[grace]] = await db.execute('SELECT TIMESTAMPDIFF(SECOND, last_accessed_at, NOW()) AS age FROM videos WHERE id=1');
  assert.ok(grace.age < 10);
  await fs.writeFile(path.join(dir, 'old.mp4'), 'old-media');
  await db.execute("UPDATE videos SET updated_at=DATE_SUB(NOW(), INTERVAL 31 DAY), last_accessed_at=DATE_SUB(NOW(), INTERVAL 31 DAY) WHERE id=1");
  for (const [id,name,status] of [[2,'viewed.mp4','completed'],[3,'edited.mp4','completed'],[4,'processing.mp4','processing'],[5,'missing.mp4','failed'],[6,'boundary.mp4','completed']]) {
    await db.execute('INSERT INTO videos VALUES (?, ?, ?, NULL, ?, DATE_SUB(NOW(), INTERVAL 31 DAY), DATE_SUB(NOW(), INTERVAL 31 DAY))', [id,'buyer',name,status]);
    if(id!==5)await fs.writeFile(path.join(dir,name),'keep');
  }
  await touchVideo(db,2,'wrong-owner');
  const [[unchanged]]=await db.execute('SELECT TIMESTAMPDIFF(DAY,last_accessed_at,NOW()) AS age FROM videos WHERE id=2');
  assert.equal(unchanged.age,31);
  await touchVideo(db,2,'buyer');
  await db.execute('UPDATE videos SET updated_at=NOW() WHERE id=3');
  await db.execute('UPDATE videos SET updated_at=updated_at, last_accessed_at=DATE_SUB(NOW(), INTERVAL 29 DAY) WHERE id=6');
  await db.execute("INSERT INTO transcription_jobs VALUES ('old-job','buyer','completed','{\"videoId\":1}'),('keep-job','buyer','completed','{\"videoId\":2}')");
  assert.equal((await cleanupInactiveVideos({connection:db,storageDir:dir})).candidates,2);
  assert.equal(await fs.readFile(path.join(dir,'old.mp4'),'utf8'),'old-media');
  // Activity between candidate listing and locking must prevent removal.
  const wrapper=new Proxy(db,{get(target,key){if(key==='execute')return async(sql,args)=>{const result=await target.execute(sql,args);if(sql.startsWith('SELECT id FROM videos WHERE status'))await touchVideo(target,1,'buyer');return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const first=await cleanupInactiveVideos({connection:wrapper,storageDir:dir,dryRun:false});
  assert.equal(first.deleted,1); // Missing file's database record is still cleaned.
  assert.equal(await fs.readFile(path.join(dir,'old.mp4'),'utf8'),'old-media');
  await db.execute('UPDATE videos SET updated_at=DATE_SUB(NOW(), INTERVAL 31 DAY),last_accessed_at=DATE_SUB(NOW(), INTERVAL 31 DAY) WHERE id=1');
  const failing=new Proxy(db,{get(target,key){if(key==='execute')return async(sql,args)=>{if(sql==='DELETE FROM videos WHERE id = ?')throw new Error('Simulated SQL failure');return target.execute(sql,args);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  await assert.rejects(cleanupInactiveVideos({connection:failing,storageDir:dir,dryRun:false}),/Simulated SQL failure/);
  assert.equal(await fs.readFile(path.join(dir,'old.mp4'),'utf8'),'old-media');
  const [[rollback]]=await db.execute("SELECT COUNT(*) AS n FROM transcription_jobs WHERE id='old-job'");
  assert.equal(rollback.n,1);
  const result=await cleanupInactiveVideos({connection:db,storageDir:dir,dryRun:false});
  assert.equal(result.deleted,1);
  assert.equal(result.bytesRemoved,9);
  const [jobs]=await db.execute('SELECT id FROM transcription_jobs');
  assert.deepEqual(jobs.map(j=>j.id),['keep-job']);
  assert.equal((await cleanupInactiveVideos({connection:db,storageDir:dir,dryRun:false})).deleted,0);
  // Simulate process death after rename, once before SQL commit and once after it.
  for(const id of [2,999]){
    const journal=path.join(dir,'.retention-trash',String(id));await fs.mkdir(journal);
    await fs.writeFile(path.join(journal,'manifest.json'),JSON.stringify({storedPath:id===2?'viewed.mp4':'deleted.mp4'}));
    if(id===2)await fs.rename(path.join(dir,'viewed.mp4'),path.join(journal,'media'));
    else await fs.writeFile(path.join(journal,'media'),'deleted');
  }
  assert.equal((await cleanupInactiveVideos({connection:db,storageDir:dir,dryRun:false})).recovered,2);
  assert.equal(await fs.readFile(path.join(dir,'viewed.mp4'),'utf8'),'keep');
  assert.deepEqual(await fs.readdir(path.join(dir,'.retention-trash')),[]);
  // Traversal must never delete files outside the media directory.
  await db.execute("INSERT INTO videos VALUES (7,'buyer','../outside.mp4',NULL,'completed',DATE_SUB(NOW(), INTERVAL 31 DAY),DATE_SUB(NOW(), INTERVAL 31 DAY))");
  await assert.rejects(cleanupInactiveVideos({connection:db,storageDir:dir,dryRun:false}),/Unsafe stored media path/);
  const [[kept]]=await db.execute('SELECT COUNT(*) AS n FROM videos WHERE id=7');assert.equal(kept.n,1);
});
