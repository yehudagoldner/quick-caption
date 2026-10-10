import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {inflateRawSync} from 'node:zlib';
import {stageBundle,zipDirectory,VERSION} from '../scripts/premiere-package.mjs';
import connection from '../premiere-plugin/runtime-connection.js';
import pairing from '../premiere-bridge/pairing.js';
import bridgeClient from '../premiere-plugin/bridge.js';
import bridgeServer from '../premiere-bridge/server.js';

async function temporary(action) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'quick-caption-installer-'));
  try {return await action(directory);} finally {await rm(directory,{recursive:true,force:true});}
}
function unzip(bytes) {
  const files=new Map();let at=0;
  while(bytes.readUInt32LE(at)===0x04034b50) {
    const compressed=bytes.readUInt32LE(at+18),length=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),start=at+30+length+extra;
    files.set(bytes.subarray(at+30,at+30+length).toString(),inflateRawSync(bytes.subarray(start,start+compressed)));
    at=start+compressed;
  }
  assert.equal(bytes.readUInt32LE(at),0x02014b50);return files;
}
test('distribution contains root manifests and code, excludes local keys, account JSON, media and certificates',()=>temporary(async root=>{
  const source=path.join(root,'source'),stage=path.join(root,'stage');await mkdir(source);
  const files={'manifest.json':JSON.stringify({id:'fixture',version:'0.1'}),'config.js':'old configuration','panel.js':'require("./config.js")','bridge-config.json':'SECRET_TOKEN','account.json':'SECRET_ACCOUNT','signing.p12':'PRIVATE_KEY','local.log':'PERSONAL_LOG','Adobe.mogrt':'PROPRIETARY','Wave.epr':'PROPRIETARY','sample.mp4':'PERSONAL_MEDIA'};
  for(const [file,value] of Object.entries(files))await writeFile(path.join(source,file),value);
  await stageBundle(source,stage,'uxp');
  assert.deepEqual((await readdir(stage)).sort(),['config.js','manifest.json','panel.js']);
  const zip=path.join(root,'fixture.ccx');await zipDirectory(stage,zip);const archive=unzip(await readFile(zip));
  assert.equal(JSON.parse(archive.get('manifest.json')).version,VERSION);
  assert.match(archive.get('config.js').toString(),/https:\/\/quick-caption\.com\/qa/);
  for(const value of archive.values())assert.doesNotMatch(value.toString(),/SECRET|PRIVATE|PROPRIETARY|PERSONAL/);
  const duplicate=path.join(root,'duplicate.ccx');await zipDirectory(stage,duplicate);assert.deepEqual(await readFile(zip),await readFile(duplicate));
}));
test('signed CEP staging upgrades only extension versions and keeps vendor attribution',()=>temporary(async root=>{
  const source=path.join(root,'source'),stage=path.join(root,'stage');await mkdir(path.join(source,'CSXS'),{recursive:true});
  await writeFile(path.join(source,'CSXS','manifest.xml'),'<ExtensionManifest Version="7.0" ExtensionBundleVersion="1.0.0"><Extension Version="1.0.0"/></ExtensionManifest>');
  await writeFile(path.join(source,'THIRD-PARTY.md'),'Original license');await stageBundle(source,stage,'cep');
  const xml=await readFile(path.join(stage,'CSXS','manifest.xml'),'utf8');assert.match(xml,/Version="7.0"/);assert.equal((xml.match(/1\.0\.1/g)||[]).length,2);
  assert.equal(await readFile(path.join(stage,'THIRD-PARTY.md'),'utf8'),'Original license');
}));
test('archive builder preserves UTF-8 file names and file contents',()=>temporary(async root=>{
  const folder=path.join(root,'משתמש עם רווחים');await mkdir(folder);await writeFile(path.join(folder,'שלום.js'),'שלום עולם');
  const zip=path.join(root,'archive.ccx');await zipDirectory(folder,zip);assert.equal(unzip(await readFile(zip)).get('שלום.js').toString(),'שלום עולם');
}));
test('packaging refuses symbolic links instead of shipping broken signatures',()=>temporary(async root=>{
  const source=path.join(root,'source');await mkdir(source);await mkdir(path.join(root,'external'));
  await symlink(path.join(root,'external'),path.join(source,'link'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(stageBundle(source,path.join(root,'stage'),'uxp'),/Symbolic links/);
}));
for(const home of ['C:\\Users\\שלום Editor','/Users/Editor Name','//server/profiles/Editor'])test(`private rendezvous path: ${home}`,()=>{
  assert.equal(connection.connectionPath(home),home.replace(/\\/g,'/')+'/.quick-caption/premiere-qa/connection.json');
});
test('file URLs support Windows, Mac, UNC and Unicode without double-slash Mac authorities',()=>{
  assert.equal(connection.nativeFileUrl('C:\\Users\\שלום\\preset.epr'),'file:/C:/Users/שלום/preset.epr');
  assert.equal(connection.nativeFileUrl('/Applications/Premiere.app/a.epr'),'file:/Applications/Premiere.app/a.epr');
  assert.equal(connection.nativeFileUrl('\\\\server\\profiles\\preset.epr'),'file://server/profiles/preset.epr');
});
test('each clean install gets its own key, restart retains it, and the signed source is never modified',()=>temporary(async root=>{
  const one=pairing.loadPairing({home:path.join(root,'first')});const two=pairing.loadPairing({home:path.join(root,'second')});
  assert.notEqual(one.token,two.token);assert.equal(one.token.length,64);assert.equal(one.port,37289);
  assert.deepEqual(pairing.loadPairing({home:path.join(root,'first')}),one);
  assert.deepEqual(await readdir(path.dirname(connection.connectionPath(path.join(root,'first')))),['connection.json']);
}));
test('corrupt pairing is rejected; migration preserves the developer key',()=>temporary(async root=>{
  const home=path.join(root,'home'),development={token:'f'.repeat(64),port:37289};
  assert.deepEqual(pairing.loadPairing({home,development}),development);
  await writeFile(connection.connectionPath(home),'{"token":"bad","port":80}');assert.throws(()=>pairing.loadPairing({home}),/Invalid local pairing/);
}));
test('runtime discovery retries after a missing companion, uses IPv4 and never sends account data',async()=>{
  let available=false;const urls=[];
  const client=new bridgeClient.TimelineBridge({configurationProvider:async()=>{if(!available)throw Error('missing');return {token:'f'.repeat(64),port:37289};},fetcher:async(url,options)=>{urls.push(url);assert.deepEqual(options.headers,{'X-Quick-Caption-Bridge':'f'.repeat(64)});return {ok:true,json:async()=>({ok:true})};}});
  await assert.rejects(client.request('/health'),{code:'bridge_unavailable'});available=true;await client.request('/health');assert.deepEqual(urls,['http://127.0.0.1:37289/health']);
});
test('preset discovery requires the same local authentication as timeline mutation',()=>temporary(async root=>{
  const server=bridgeServer.startBridge({root,token:'f'.repeat(64),port:0,evalHost:async method=>({ok:true,method,audioPresets:['/Applications/Premiere.app/wave.epr']})});
  await new Promise(resolve=>server.on('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try {assert.equal((await fetch(base+'/setup-info')).status,403);const response=await fetch(base+'/setup-info',{headers:{'X-Quick-Caption-Bridge':'f'.repeat(64)}});assert.equal(response.status,200);assert.equal((await response.json()).method,'setupInfo');}
  finally {await new Promise(resolve=>server.close(resolve));}
}));
test('native preset discovery uses installed application roots without requiring a project',async()=>{
  const source=await readFile(new URL('../premiere-bridge/host.jsx',import.meta.url),'utf8');
  function Folder(value){this.exists=value?.includes('3F3F3F3F_57415645');this.getFiles=()=>[new File(value+'/Waveform Audio.epr')];}
  Folder.startup={fsName:'C:/Adobe/Premiere'};Folder.appPackage={fsName:'/Applications/Premiere.app'};
  function File(value){this.fsName=value;}const context=vm.createContext({$:{},Folder,File,app:{}});vm.runInContext(source,context);
  const result=JSON.parse(context.$._quickCaptionBridge.setupInfo('{}'));assert.equal(result.ok,true);assert.equal(result.audioPresets.length,3);assert.match(result.audioPresets[0],/MediaIO\/systempresets/);
});
