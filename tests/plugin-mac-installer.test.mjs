import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {VERSION,PACKAGE_NAMES,readZipEntries,zipDirectory,sha256} from '../scripts/premiere-package.mjs';
import {buildMacInstaller} from '../scripts/build-premiere-mac-installer.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const shell=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
const backend=path.join(root,'installer','macos','installer.sh');
const cleanup=path.join(root,'installer','macos','cleanup.sh');
const quote=value=>"'"+String(value).replace(/'/g,"'\"'\"'")+"'";
const bashPath=value=>process.platform==='win32'?value.replace(/\\/g,'/').replace(/^([a-z]):/i,(_,drive)=>'/'+drive.toLowerCase()):value;
async function temporary(action) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'quick-caption-mac-installer-'));
  try{return await action(directory);}finally{await rm(directory,{recursive:true,force:true});}
}
async function packageFixture(directory) {
  const input=path.join(directory,'input'),cep=path.join(directory,'cep'),uxp=path.join(directory,'uxp');
  await mkdir(input);await mkdir(path.join(cep,'CSXS'),{recursive:true});await mkdir(path.join(cep,'META-INF'));await mkdir(uxp);
  await writeFile(path.join(cep,'CSXS','manifest.xml'),`<ExtensionManifest ExtensionBundleId="com.quickcaption.premiere.bridge.qa" ExtensionBundleVersion="${VERSION}"/>`);
  // The fixture mocks the upstream signature-verification boundary. It does
  // not create or validate an Adobe signature or need a private certificate.
  await writeFile(path.join(cep,'META-INF','signatures.xml'),'<fixture-signature/>');
  await writeFile(path.join(cep,'boot.js'),'// CEP fixture');
  await writeFile(path.join(uxp,'manifest.json'),JSON.stringify({id:'com.quickcaption.premiere.qa',version:VERSION,host:{app:'premierepro',minVersion:'25.6.0'}}));
  await writeFile(path.join(uxp,'panel.js'),'// UXP fixture');
  await zipDirectory(cep,path.join(input,PACKAGE_NAMES[0]));await zipDirectory(uxp,path.join(input,PACKAGE_NAMES[1]));
  await writeFile(path.join(input,'build-info.json'),JSON.stringify({version:VERSION,channel:'qa',platform:'win32-x64',zxpSignature:'Signature verified successfully'}));
  const checksums=Object.fromEntries(await Promise.all(PACKAGE_NAMES.map(async name=>[name,await sha256(path.join(input,name))])));
  await writeFile(path.join(input,'checksums.json'),JSON.stringify(checksums));return input;
}
async function runBash(root,script) {
  const file=path.join(root,'fixture.sh');await writeFile(file,script+'\n');
  const result=spawnSync(shell,[bashPath(file)],{encoding:'utf8',timeout:15000,windowsHide:true});
  if(result.error)throw result.error;
  assert.equal(result.status,0,`fixture failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
async function fixture(directory,extra='',body='qc_install; result=$?; qc_finish; printf "result=%s code=%s\\n" "$result" "$QC_CODE"') {
  const resources=path.join(directory,"Editor's מחשב & $(touch INJECTED)",'resources');
  const state=path.join(directory,'private state');await mkdir(resources,{recursive:true});await mkdir(state);
  const agent=path.join(directory,'fake-adobe');await writeFile(agent,'#!/bin/bash\nexit 0\n');
  // Boundaries are replaced after sourcing; the production installer never
  // accepts environment variables that disable integrity or OS checks.
  const script=`source ${quote(bashPath(backend))}
qc_init ${quote(bashPath(resources))}
QC_STATE=${quote(bashPath(state))}; QC_LOG="$QC_STATE/last-install.json"
QC_AGENT=${quote(bashPath(agent))}
chmod 755 "$QC_AGENT"
qc_platform() { printf 'Darwin\\n'; }
qc_arch() { printf 'arm64\\n'; }
qc_os_version() { printf '15.6.1\\n'; }
qc_uuid() { printf '12345678-aaaa-4bbb-8ccc-123456789abc\\n'; }
qc_now() { printf '1800000000\\n'; }
qc_check_payloads() { return 0; }
qc_schedule_cleanup() { printf 'registered' > "$QC_STATE/cleanup-registered"; return 0; }
qc_premiere_running() { return 1; }
qc_host_versions() { printf '25.6.6\\n'; }
qc_run_adobe() {
  QC_PROCESS_EXIT=0
  if [ "$1" = --list ]; then
    QC_OUTPUT=$' Enabled    Quick Caption Timeline Bridge QA 1.0.1\\n Enabled    Quick Caption QA 1.0.1'
  else
    printf '%s\\n' "$2" >> "$QC_STATE/calls"
    QC_OUTPUT='Extension installed successfully'
  fi
}
${extra}
${body}
`;
  return {output:await runBash(directory,script),resources,state};
}
test('all macOS launchers and backend pass Bash syntax validation',async()=>{
  for(const name of await readdir(path.join(root,'installer','macos'))) {
    const result=spawnSync(shell,['-n',bashPath(path.join(root,'installer','macos',name))],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,`${name}: ${result.stderr}`);
  }
  const source=await readFile(backend,'utf8');
  // macOS supplies Bash 3.2: avoid features introduced in Bash 4/5.
  assert.doesNotMatch(source,/declare\s+-A|\bmapfile\b|\breadarray\b|\$\{[^}]*,,[^}]*\}/);
});
test('Adobe status parser handles failed exit-zero responses, multiple statuses and unknown output',()=>temporary(async root=>{
  const script=`source ${quote(bashPath(backend))}
qc_adobe_result 0 'Failed to install, status = -204!'
qc_adobe_result 0 'Extension installed successfully'
qc_adobe_result 0 'Installing extension...'
qc_adobe_result 7 'Extension installed successfully'
qc_adobe_result 0 $'status=0 success\\nFailed status = -201!'
qc_adobe_result 0 'not successful'
qc_adobe_result 0 'status = -1234567 success'
qc_adobe_result 0 'status=garbage success'
qc_adobe_result 0 'status=0.5 success'
qc_adobe_result 0 'success status = '
`;
  assert.deepEqual((await runBash(root,script)).split('\n'),['-204','0','-10000','7','-201','-10000','-10000','-10000','-10000','-10000']);
}));
test('GUI cancellation makes no changes, while a broken dialog reports failure instead of silently succeeding',()=>temporary(async directory=>{
  const common=`source ${quote(bashPath(backend))}
qc_prepare_log() { printf 'prepare\\n'; QC_ID=12345678-aaaa-4bbb-8ccc-123456789abc; }
qc_record() { printf 'record:%s\\n' "$QC_CODE"; }
qc_finish() { return 0; }
`;
  const cancel=await runBash(directory,common+`qc_confirm() { printf 'User canceled. (-128)\\n' >&2; return 1; }; qc_main --gui; printf 'result=%s\\n' "$?"`);
  assert.equal(cancel,'result=0');
  const failure=await runBash(directory,common+`qc_confirm() { printf 'syntax error (-2741)\\n' >&2; return 1; }; qc_main --gui; printf 'result=%s\\n' "$?"`);
  assert.match(failure,/record:ui_unavailable/);assert.match(failure,/result=1/);assert.doesNotMatch(failure,/syntax error|-2741/);
}));
for(const arch of ['arm64','x86_64'])test(`simulated ${arch}: installs both packages, then confirms enabled registrations`,()=>temporary(async directory=>{
  const {output,resources,state}=await fixture(directory,`qc_arch() { printf '${arch}\\n'; }`);
  assert.match(output,/result=0 code=installed/);
  assert.deepEqual((await readFile(path.join(state,'calls'),'utf8')).trim().split('\n'),PACKAGE_NAMES.map(name=>bashPath(path.join(resources,name))));
  const report=JSON.parse(await readFile(path.join(state,'last-install.json'),'utf8'));
  assert.equal(report.arch,arch==='arm64'?'arm64':'x64');assert.equal(report.stage,'complete');assert.equal(report.code,'installed');
  assert.equal(report.bridgeInstalled,true);assert.equal(report.panelInstalled,true);assert.equal(report.cleanupScheduled,true);
  assert.equal(report.expiresAt-report.createdAt,604800);assert.equal(report.hostVersion,'25.6.6');
  assert.ok((await stat(path.join(state,'last-install.json'))).size<8192);
  assert.doesNotMatch(JSON.stringify(report),/Editor|resources|private state|INJECTED|token|account|password/);
  assert.equal((await readdir(state)).includes('install.lock'),false);
  assert.equal((await readdir(resources)).includes('INJECTED'),false);
}));
for(const [name,override,code] of [
  ['Premiere running','qc_premiere_running() { return 0; }','premiere_running'],
  ['old Premiere','qc_host_versions() { printf "25.5.9\\n24.9\\n"; }','unsupported_host'],
  ['old macOS','qc_os_version() { printf "12.7.6\\n"; }','unsupported_os'],
  ['wrong platform','qc_platform() { printf "Linux\\n"; }','unsupported_platform'],
  ['unknown architecture','qc_arch() { printf "riscv64\\n"; }','unsupported_architecture'],
  ['damaged payload','qc_check_payloads() { return 1; }','invalid_package'],
  ['missing Creative Cloud','QC_AGENT="$QC_STATE/no-such-agent"','creative_cloud_missing'],
])test(`preflight refuses ${name} before any Adobe install`,()=>temporary(async directory=>{
  const {output,state}=await fixture(directory,override);assert.match(output,new RegExp(`result=1 code=${code}`));
  assert.equal((await readdir(state)).includes('calls'),false);
  const report=JSON.parse(await readFile(path.join(state,'last-install.json'),'utf8'));assert.equal(report.code,code);
}));
test('a newer compatible Premiere coexisting with an old version passes preflight',()=>temporary(async directory=>{
  const {output,state}=await fixture(directory,'qc_host_versions() { printf "24.9\\n25.5.0\\n26.1.0\\n"; }');
  assert.match(output,/result=0/);assert.equal(JSON.parse(await readFile(path.join(state,'last-install.json'),'utf8')).hostVersion,'26.1.0');
}));
test('Adobe validates a custom host location which standard discovery did not find',()=>temporary(async directory=>{
  const {output}=await fixture(directory,'qc_host_versions() { return 0; }');assert.match(output,/result=0 code=installed/);
}));
test('bridge rejection at process exit zero stops before charging, panel installation or success',()=>temporary(async directory=>{
  const {output,state}=await fixture(directory,`qc_run_adobe() { printf '%s\\n' "$1" >> "$QC_STATE/calls"; QC_PROCESS_EXIT=0; QC_OUTPUT='Failed to install, status = -201! /Users/private@example.com/project'; }`);
  assert.match(output,/result=1 code=adobe_rejected/);
  assert.equal((await readFile(path.join(state,'calls'),'utf8')).trim(),'--install');
  const report=JSON.parse(await readFile(path.join(state,'last-install.json'),'utf8'));
  assert.equal(report.adobeStatus,-201);assert.equal(report.processExit,0);assert.equal(report.bridgeInstalled,false);assert.equal(report.panelInstalled,false);
  assert.doesNotMatch(JSON.stringify(report),/private@example|\/Users|project/);
}));
test('partial installation retains the first component and reports the failing second component',()=>temporary(async directory=>{
  const {output,state}=await fixture(directory,`qc_run_adobe() {
  printf '%s\\n' "$2" >> "$QC_STATE/calls"; QC_PROCESS_EXIT=0
  case "$2" in *.zxp) QC_OUTPUT='Installed successfully';; *) QC_OUTPUT='Failed status=-204!';; esac
}`);
  assert.match(output,/result=1/);const report=JSON.parse(await readFile(path.join(state,'last-install.json'),'utf8'));
  assert.equal(report.stage,'panel-install');assert.equal(report.adobeStatus,-204);assert.equal(report.bridgeInstalled,true);assert.equal(report.panelInstalled,false);
  assert.equal((await readFile(path.join(state,'calls'),'utf8')).trim().split('\n').length,2);
}));
test('an unrecognized, disabled or wrong-version registration never becomes success',()=>temporary(async directory=>{
  const {output,state}=await fixture(directory,`qc_run_adobe() {
  QC_PROCESS_EXIT=0; QC_OUTPUT='Installed successfully'
  if [ "$1" = --list ]; then QC_OUTPUT=$' Enabled Quick Caption Timeline Bridge QA 1.0.1\\n Disabled Quick Caption QA 1.0.0'; fi
}`);
  assert.match(output,/result=1 code=registration_unverified/);
  assert.equal(JSON.parse(await readFile(path.join(state,'last-install.json'),'utf8')).stage,'verify-installation');
}));
test('a concurrent attempt preserves the existing report and does not call Adobe',()=>temporary(async directory=>{
  const {output,state}=await fixture(directory,'mkdir "$QC_STATE/install.lock"; printf "existing" > "$QC_LOG"');
  assert.match(output,/result=1 code=installer_busy/);assert.equal(await readFile(path.join(state,'last-install.json'),'utf8'),'existing');
  assert.equal((await readdir(state)).includes('calls'),false);
}));
test('Premiere reopened after first component aborts the next mutation',()=>temporary(async directory=>{
  const {output,state}=await fixture(directory,`qc_premiere_running() { [ "$QC_BRIDGE" = true ]; }`);
  assert.match(output,/result=1 code=premiere_running/);assert.equal((await readFile(path.join(state,'calls'),'utf8')).trim().split('\n').length,1);
}));
test('an unavailable cleanup registration is visible in the bounded report',()=>temporary(async directory=>{
  const {output,state}=await fixture(directory,'qc_schedule_cleanup() { return 1; }');assert.match(output,/result=0/);
  assert.equal(JSON.parse(await readFile(path.join(state,'last-install.json'),'utf8')).cleanupScheduled,false);
}));
test('version boundaries and XML escaping handle Intel/Apple Silicon home paths without code evaluation',()=>temporary(async directory=>{
  const output=await runBash(directory,`source ${quote(bashPath(backend))}
for version in 24.9 25.5.9 25.6 25.6.0 26.0; do qc_host_supported "$version"; printf '%s\\n' "$?"; done
qc_xml ${quote(`/Users/Editor's מחשב & <tag> "quotes" $(touch INJECTED)`)}
`);
  assert.deepEqual(output.split('\n').slice(0,5),['1','1','0','0','0']);
  assert.match(output,/Editor&apos;s מחשב &amp; &lt;tag&gt; &quot;quotes&quot; \$\(touch INJECTED\)/);
}));
test('hourly expiry removes only the exact report, preserves project assets and rejects oversized/malformed reports',()=>temporary(async directory=>{
  const expired=path.join(directory,'last-install.json'),asset=path.join(directory,'caption.srt');
  await writeFile(asset,'user project');await writeFile(expired,'{"expiresAt":1800000000}');
  await runBash(directory,`source ${quote(bashPath(cleanup))}; qc_expire_report ${quote(bashPath(expired))} 1800000000`);
  assert.equal((await readdir(directory)).includes('last-install.json'),false);assert.equal(await readFile(asset,'utf8'),'user project');
  for(const value of ['{"expiresAt":1800000001}','invalid json','x'.repeat(9000)]) {
    await writeFile(expired,value);await runBash(directory,`source ${quote(bashPath(cleanup))}; qc_expire_report ${quote(bashPath(expired))} 1800000000`);
    assert.equal((await readdir(directory)).includes('last-install.json'),value.includes('1800000001'));
  }
}));
test('Mac ZIP marks .app and .command launchers as Unix executables and data as non-executable',()=>temporary(async directory=>{
  await writeFile(path.join(directory,'launcher.command'),'#!/bin/bash\n');await writeFile(path.join(directory,'data.json'),'{}');
  const zip=path.join(directory,'example.zip');await zipDirectory(directory,zip,{unixModes:{'launcher.command':0o755}});
  const bytes=await readFile(zip);let at=bytes.readUInt32LE(bytes.length-6);const modes={};
  while(bytes.readUInt32LE(at)===0x02014b50) {
    const length=bytes.readUInt16LE(at+28),name=bytes.subarray(at+46,at+46+length).toString();
    assert.equal(bytes.readUInt16LE(at+4)>>>8,3);modes[name]=(bytes.readUInt32LE(at+38)>>>16)&0o777;
    at+=46+length+bytes.readUInt16LE(at+30)+bytes.readUInt16LE(at+32);
  }
  assert.deepEqual(modes,{'data.json':0o644,'launcher.command':0o755});
}));
test('archive inspection refuses traversal, duplicate names and corrupted data',()=>temporary(async directory=>{
  const stage=path.join(directory,'stage');await mkdir(stage);await writeFile(path.join(stage,'safe.js'),'some content');
  const zip=path.join(directory,'archive.zip');await zipDirectory(stage,zip);const bytes=await readFile(zip);
  const central=bytes.readUInt32LE(bytes.length-6),changed=Buffer.from(bytes);Buffer.from('../a.js').copy(changed,central+46);
  assert.throws(()=>readZipEntries(changed),/Unsafe ZIP/);
  const corrupted=Buffer.from(bytes);corrupted[37]^=0xff;assert.throws(()=>readZipEntries(corrupted));
}));
test('Mac beta archive preserves supplied Adobe payloads, executable modes, no credentials and explicit Mac limits',()=>temporary(async directory=>{
  const input=await packageFixture(directory),result=await buildMacInstaller({input,output:path.join(directory,'built')});const bytes=await readFile(result.archive),files=readZipEntries(bytes);
  const resources='Quick Caption Setup.app/Contents/Resources/';
  for(const name of PACKAGE_NAMES)assert.equal(sha256Buffer(files.get(resources+name)),await sha256(path.join(input,name)));
  const metadata=JSON.parse(files.get(resources+'build-info.json'));
  assert.equal(metadata.appleSigned,false);assert.equal(metadata.notarized,false);assert.equal(metadata.nativeMacValidated,false);assert.equal(metadata.cepSignaturePlatform,'win32');
  assert.equal(files.get('README.md').equals(files.get(resources+'README.md')),true);
  assert.match(files.get('Quick Caption Setup.app/Contents/Info.plist').toString(),/<key>CFBundleExecutable<\/key><string>QuickCaptionSetup<\/string>/);
  assert.equal(files.has('Quick Caption Diagnostics.command'),true);
  for(const name of files.keys())assert.doesNotMatch(name,/\.p12|\.exe|\.env|bridge-config|\.local-secrets|\.DS_Store|\.mp[34]|\.epr|\.mogrt/);
  let at=bytes.readUInt32LE(bytes.length-6);const executable=[];
  while(bytes.readUInt32LE(at)===0x02014b50) {
    const length=bytes.readUInt16LE(at+28),name=bytes.subarray(at+46,at+46+length).toString();
    if(((bytes.readUInt32LE(at+38)>>>16)&0o777)===0o755)executable.push(name);
    at+=46+length+bytes.readUInt16LE(at+30)+bytes.readUInt16LE(at+32);
  }
  assert.equal(executable.length,5);assert.ok(executable.includes('Quick Caption Setup.app/Contents/MacOS/QuickCaptionSetup'));
}));
import {createHash} from 'node:crypto';
function sha256Buffer(bytes){return createHash('sha256').update(bytes).digest('hex');}
test('builder rejects a tampered Adobe package before writing an installer',()=>temporary(async directory=>{
  const input=await packageFixture(directory);
  await writeFile(path.join(input,PACKAGE_NAMES[0]),'damaged');
  await assert.rejects(buildMacInstaller({input,output:path.join(directory,'output')}),/checksum mismatch/);
  assert.equal((await readdir(directory)).includes('output'),false);
}));
test('extracted installer resources pass hash verification and refuse a changed cleanup script',()=>temporary(async directory=>{
  const input=await packageFixture(directory),result=await buildMacInstaller({input,output:path.join(directory,'built')});
  const files=readZipEntries(await readFile(result.archive)),resources=path.join(directory,'resources'),prefix='Quick Caption Setup.app/Contents/Resources/';
  await mkdir(resources);
  for(const [name,value] of files)if(name.startsWith(prefix))await writeFile(path.join(resources,name.slice(prefix.length)),value);
  const script=`source ${quote(bashPath(backend))}; qc_init ${quote(bashPath(resources))}
qc_checksum() { (cd "$QC_RESOURCES" && sha256sum -c SHA256SUMS) >/dev/null 2>&1; }
qc_check_payloads; printf '%s\\n' "$?"
printf '# changed' >> "$QC_RESOURCES/cleanup.sh"
qc_check_payloads; printf '%s\\n' "$?"
`;
  assert.equal(await runBash(directory,script),'0\n1');
}));
test('real child-process capture reads Adobe rejection and removes private temporary output',()=>temporary(async directory=>{
  const agent=path.join(directory,'agent.sh');await writeFile(agent,"#!/bin/bash\nprintf 'Failed to install, status = -204! /Users/private/project\\n'\nexit 0\n");
  const script=`source ${quote(bashPath(backend))}; qc_init ${quote(bashPath(directory))}
QC_STATE=${quote(bashPath(directory))}; QC_AGENT=${quote(bashPath(agent))}; chmod 755 "$QC_AGENT"
qc_run_adobe --install '/Users/Editor with spaces/package.ccx'
qc_adobe_result "$QC_PROCESS_EXIT" "$QC_OUTPUT"
qc_finish
`;
  assert.equal(await runBash(directory,script),'-204');assert.equal((await readdir(directory)).some(name=>name.startsWith('adobe.')),false);
}));
test('real child-process timeout terminates its own Adobe child and cleans output',()=>temporary(async directory=>{
  const agent=path.join(directory,'agent.sh');await writeFile(agent,'#!/bin/bash\nexec sleep 10\n');
  const script=`source ${quote(bashPath(backend))}; qc_init ${quote(bashPath(directory))}
QC_STATE=${quote(bashPath(directory))}; QC_AGENT=${quote(bashPath(agent))}; chmod 755 "$QC_AGENT"
qc_now() { if [ -f "$QC_STATE/clock" ]; then echo 301; else touch "$QC_STATE/clock"; echo 0; fi; }
qc_run_adobe --install package.ccx
printf '%s %s\\n' "$QC_PROCESS_EXIT" "$QC_CODE"
qc_finish
`;
  assert.equal(await runBash(directory,script),'124 adobe_timeout');assert.equal((await readdir(directory)).some(name=>name.startsWith('adobe.')),false);
}));
test('excessive Adobe output is bounded and cannot be parsed as success',()=>temporary(async directory=>{
  const agent=path.join(directory,'agent.sh');await writeFile(agent,"#!/bin/bash\nhead -c 70000 /dev/zero\nprintf 'success'\n");
  const script=`source ${quote(bashPath(backend))}; qc_init ${quote(bashPath(directory))}
QC_STATE=${quote(bashPath(directory))}; QC_AGENT=${quote(bashPath(agent))}; chmod 755 "$QC_AGENT"
qc_run_adobe --install package.ccx
qc_adobe_result "$QC_PROCESS_EXIT" "$QC_OUTPUT"
qc_finish
`;
  assert.equal(await runBash(directory,script),'125');assert.equal((await readdir(directory)).some(name=>name.startsWith('adobe.')),false);
}));
test('installer cannot disable OS/Adobe security, auto-close Premiere or upload unauthenticated reports',async()=>{
  const sources=(await Promise.all((await readdir(path.join(root,'installer','macos'))).map(name=>readFile(path.join(root,'installer','macos',name),'utf8')))).join('\n').replace(/^#.*$/gm,'');
  assert.doesNotMatch(sources,/spctl\s+--|xattr\s+-|PlayerDebugMode|sudo\s+|killall|curl\s+|wget\s+|https:\/\/quick-caption/);
  assert.doesNotMatch(sources,/rm\s+-r|rm\s+-f\s+.*CEP|rm\s+-f\s+.*Premiere Bridge/);
  assert.match(sources,/StartInterval<\/key><integer>3600/);assert.match(sources,/launchctl bootstrap/);
});
