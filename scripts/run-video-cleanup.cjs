// Stable cron launcher: discover the current release rather than pinning an old checkout.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--apply', '--dry-run'].includes(args[0])) throw new Error('An explicit cleanup mode is required');
  const apps = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' })).filter(app => app.name === 'caption');
  if (apps.length !== 1 || apps[0].pm2_env.status !== 'online') throw new Error('Expected one online caption app');
  const app = apps[0], cwd = app.pm2_env.pm_cwd;
  if (!path.isAbsolute(cwd) || app.pm2_env.pm_exec_path !== path.join(cwd, 'server.js')) throw new Error('Unexpected app directory');
  const environment = Object.fromEntries(fs.readFileSync(`/proc/${app.pid}/environ`, 'utf8').split('\0').filter(Boolean).map(value => {
    const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)];
  }));
  const child = spawnSync(app.pm2_env.exec_interpreter, [path.join(cwd, 'scripts/cleanup-videos.js'), args[0]], { cwd, env: environment, stdio: 'inherit' });
  if (child.error || child.status !== 0) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ task: 'video-retention-launcher', error: error.code ?? error.name }));
  process.exitCode = 1;
}
