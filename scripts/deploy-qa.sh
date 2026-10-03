#!/usr/bin/env bash
# QA only. Production continues to use the quick-caption-deploy skill.
set -Eeuo pipefail
umask 077
sha=${1:-}
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]] || [[ $# != 1 ]]; then
  echo 'Usage: deploy-qa.sh <full-40-character-commit-sha>' >&2
  exit 2
fi
ops=/home/quick-caption-ops
root=/home/quick-caption-qa
export PATH=/opt/quick-caption-runtime/node-v22.23.3-linux-x64/bin:/root/.nvm/versions/node/v20.6.1/bin:$PATH
exec 9>"$ops/qa-deploy.lock"
flock -n 9 || { echo 'Another QA deployment is running' >&2; exit 1; }
snapshot=$(mktemp "$ops/qa-before-XXXXXXXX.json")
pm2 jlist > "$snapshot"
old=$(node - "$snapshot" <<'JS'
const fs=require('fs');const apps=JSON.parse(fs.readFileSync(process.argv[2]));
const qa=apps.filter(a=>a.name==='caption-qa');
if(qa.length!==1 || qa[0].pm2_env.status!=='online')throw Error('Expected exactly one online caption-qa app');
process.stdout.write(qa[0].pm2_env.pm_cwd);
JS
)
[[ "$old" == "$root"/release-* ]] || { echo 'Unexpected QA directory' >&2; exit 1; }
test -f "$old/caption-qa.ecosystem.config.cjs"
cd "$old"
git fetch origin
[[ $(git rev-parse "$sha^{commit}") == "$sha" ]]
release=$(mktemp -d "$root/release-${sha:0:7}-XXXXXXXX")
git worktree add --detach "$release" "$sha"
ln -s "$root/shared/.env" "$release/.env"
ln -s "$root/shared/stored-videos" "$release/stored-videos"
cd "$release"
# Preserve the dependency set when the manifests match; never install in shared dependencies.
if cmp -s "$old/package.json" package.json &&
   { { test ! -f package-lock.json && test ! -f "$old/package-lock.json"; } || cmp -s "$old/package-lock.json" package-lock.json; }; then
  ln -s "$(readlink -f "$old/node_modules")" node_modules
elif test -f package-lock.json; then
  npm ci --include=dev
else
  npm install --include=dev
fi
QA_OLD="$old" QA_RELEASE="$release" node --input-type=module - <<'JS'
import fs from 'node:fs';import dotenv from 'dotenv';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const old=process.env.QA_OLD;const release=process.env.QA_RELEASE;
const source=require(old+'/caption-qa.ecosystem.config.cjs');
if(source.apps.length!==1 || source.apps[0].name!=='caption-qa')throw Error('Config is not QA only');
const env=dotenv.parse(fs.readFileSync('/home/quick-caption-qa/shared/.env'));
if(env.DB_NAME!=='quickcaption_qa' || env.DB_USER!=='quickcaption_qa' || env.PORT!=='3100' || env.VITE_API_BASE_URL!=='/qa' || env.VITE_APP_BASE_PATH!=='/qa/' || env.PAYPAL_CLIENT_ID || env.PAYPAL_SECRET)throw Error('Unsafe QA environment');
const app={...source.apps[0],name:'caption-qa',cwd:release,script:release+'/server.js',env:{...env,NODE_ENV:'production',PWD:release}};
fs.writeFileSync(release+'/caption-qa.ecosystem.config.cjs','module.exports = '+JSON.stringify({apps:[app]},null,2)+';\n',{mode:0o600});
JS
npm run build
node --test tests/timeline-editing.test.mjs tests/word-alignment.test.mjs tests/active-word-export.test.mjs tests/paypal-checkout.test.mjs tests/video-security.test.mjs
if test -d "$old/dist/assets"; then cp -an "$old/dist/assets/." dist/assets/; fi
current=$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).filter(a=>a.name==="caption-qa");if(a.length!==1)process.exit(1);process.stdout.write(a[0].pm2_env.pm_cwd)})')
[[ "$current" == "$old" ]] || { echo 'QA changed during preparation' >&2; exit 1; }
health() {
  for i in {1..15}; do
    if curl -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:3100/health >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
rollback() {
  local code=$?
  trap - ERR
  local live
  live=$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).filter(a=>a.name==="caption-qa");if(a.length>1)process.exit(1);process.stdout.write(a[0]?.pm2_env.pm_cwd||"")})') || exit "$code"
  if [[ -z "$live" || "$live" == "$release" ]]; then
    if [[ -n "$live" ]]; then pm2 delete caption-qa >/dev/null; fi
    if pm2 start "$old/caption-qa.ecosystem.config.cjs" --only caption-qa >/dev/null && health && curl -fsS --max-time 10 https://quick-caption.com/qa/health >/dev/null; then
      ln -sfn "$old" "$root/current"
      pm2 save >/dev/null
      echo "QA rollback verified: $old" >&2
    else
      echo "QA rollback failed; inspect $old and $release" >&2
    fi
  else
    echo 'QA changed concurrently; automatic rollback skipped' >&2
  fi
  exit "$code"
}
trap rollback ERR
pm2 delete caption-qa >/dev/null
pm2 start "$release/caption-qa.ecosystem.config.cjs" --only caption-qa >/dev/null
health
curl -fsS --connect-timeout 3 --max-time 10 https://quick-caption.com/qa/health >/dev/null
curl -fsS --connect-timeout 3 --max-time 10 -H 'Cache-Control: no-cache' "https://quick-caption.com/qa/?release=$sha" -o "$ops/qa-public.html"
cmp "$ops/qa-public.html" dist/index.html
QA_RELEASE="$release" QA_SNAPSHOT="$snapshot" node --input-type=module - <<'JS'
import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const html=fs.readFileSync('dist/index.html','utf8');
for(const asset of html.matchAll(/(?:src|href)="(\/qa\/assets\/[^"?]+)"/g)) {
  const remote=execFileSync('curl',['-fsS','--connect-timeout','3','--max-time','15','https://quick-caption.com'+asset[1]],{maxBuffer:20*1024*1024});
  const local=fs.readFileSync('dist/'+asset[1].slice('/qa/'.length));
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  if(hash(remote)!==hash(local))throw Error('Public asset mismatch: '+asset[1]);
}
const before=JSON.parse(fs.readFileSync(process.env.QA_SNAPSHOT));
const first=JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8'}));
await new Promise(r=>setTimeout(r,2000));
const after=JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8'}));
const qa=after.filter(a=>a.name==='caption-qa');const started=first.find(a=>a.name==='caption-qa');
if(qa.length!==1 || qa[0].pm2_env.status!=='online' || qa[0].pm2_env.pm_cwd!==process.env.QA_RELEASE || qa[0].pm2_env.pm_exec_path!==process.env.QA_RELEASE+'/server.js' || qa[0].pm2_env.restart_time!==started.pm2_env.restart_time)throw Error('QA identity or stability check failed');
for(const b of before.filter(a=>a.name!=='caption-qa')){const a=after.find(a=>a.name===b.name);if(!a||a.pid!==b.pid||a.pm2_env.status!==b.pm2_env.status||a.pm2_env.pm_cwd!==b.pm2_env.pm_cwd)throw Error('Other process changed: '+b.name);}
console.log('Public HTML/assets verified; QA stable; production and other processes unchanged');
JS
ln -sfn "$release" "$root/current"
pm2 save >/dev/null
trap - ERR
printf 'QA deployed: %s\nURL: https://quick-caption.com/qa/\nRelease: %s\n' "$sha" "$release"
