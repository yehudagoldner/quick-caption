import '../src/loadAppEnv.js';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { cleanupInactiveVideos } from '../src/videoRetention.js';

const args = process.argv.slice(2);
if (args.some(arg => !['--apply', '--dry-run'].includes(arg)) || args.includes('--apply') && args.includes('--dry-run')) throw new Error('Use --dry-run or --apply');
const connection = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 10000 });
try {
  const summary = await cleanupInactiveVideos({ connection, storageDir: path.join(process.cwd(), 'stored-videos'), dryRun: !args.includes('--apply') });
  console.log(JSON.stringify({ task: 'video-retention', at: new Date().toISOString(), ...summary }));
} catch (error) {
  console.error(JSON.stringify({ task: 'video-retention', error: error.code ?? error.name }));
  process.exitCode = 1;
} finally { await connection.end(); }
