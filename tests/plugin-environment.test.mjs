import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import http from 'node:http';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import environment from '../premiere-bridge/environment.js';
import graphic from '../premiere-bridge/native-graphic.js';
import bridgeDiagnostics from '../premiere-bridge/diagnostics.js';
import bridgeServer from '../premiere-bridge/server.js';
import bridgeClient from '../premiere-plugin/bridge.js';

function memoryFs(paths, files = {}) {
  const entries = new Map(), key = p => paths.normalize(p);
  function add(p, bytes, directory = false) {
    p=key(p); const parent=paths.dirname(p);
    if(parent!==p && !entries.has(parent))add(parent,null,true);
    entries.set(p,{bytes,directory});
  }
  for(const [p,bytes] of Object.entries(files))add(p,bytes);
  const missing=()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});};
  return { entries, existsSync:p=>entries.has(key(p)), statSync:p=>({size:(entries.get(key(p))||missing()).bytes?.length||0}),
    readFileSync:p=>(entries.get(key(p))||missing()).bytes,
    readdirSync:p=>{if(!entries.has(key(p)))missing();return [...entries].filter(([name])=>name!==key(p)&&paths.dirname(name)===key(p)).map(([name,value])=>({name:paths.basename(name),isFile:()=>!value.directory,isDirectory:()=>value.directory,isSymbolicLink:()=>false}));},
    mkdirSync:p=>add(p,null,true), writeFileSync:(p,bytes)=>add(p,Buffer.from(bytes)), renameSync:(a,b)=>{const value=entries.get(key(a))||missing();entries.delete(key(a));entries.set(key(b),value);}, unlinkSync:p=>{if(!entries.delete(key(p)))missing();} };
}
function templateBytes(schemaVersion = 1) {
  const doc={mVersion:schemaVersion,mTextParam:{mStyleSheet:{mText:'Original'}}};
  const body=Buffer.from(JSON.stringify(doc),'utf16le'),header=Buffer.alloc(8);header.writeUInt32LE(body.length);
  const node=`<ArbVideoComponentParam><Name>Source Text</Name><StartKeyframeValue>${Buffer.concat([header,body]).toString('base64')}</StartKeyframeValue></ArbVideoComponentParam>`;
  return graphic.writeZip(new Map([['definition.json',Buffer.from(JSON.stringify({authorApp:'ppro',clientControls:[{type:6}],sourceInfoLocalized:{en_US:{hasaudio:false}}}))],['project.prgraphic',graphic.writeZip(new Map([['caption.prproj',zlib.gzipSync(`<Project>${node}</Project>`)]]))]]));
}
const scenarios = [
  {name:'Windows x64 default',platform:'win32',home:'C:\\Users\\Editor',env:{APPDATA:'C:\\Users\\Editor\\AppData\\Roaming'},paths:path.win32},
  {name:'Windows relocated Unicode profile',platform:'win32',home:'D:\\משתמשים\\Élodie Gold',env:{APPDATA:'D:\\נתונים משותפים\\Adobe user'},paths:path.win32},
  {name:'Windows APPDATA missing',platform:'win32',home:'C:\\Users\\Other',env:{},paths:path.win32},
  {name:'Windows UNC profile',platform:'win32',home:'\\\\nas\\profiles\\Editor',env:{APPDATA:'\\\\nas\\profiles\\Editor\\AppData\\Roaming'},paths:path.win32},
  {name:'Mac Apple Silicon Unicode home',platform:'darwin',home:'/Users/שלום Élodie',env:{APPDATA:'C:/irrelevant'},paths:path.posix},
  {name:'Mac Intel case sensitive disk',platform:'darwin',home:'/Volumes/Editors/Editor',env:{},paths:path.posix},
];
for(const scenario of scenarios) {
  test(`${scenario.name}: discover localized template and generate editable Hebrew`,()=>{
    const directories=environment.runtimeDirectories(scenario);
    assert.ok(!directories.root.includes('undefined'));
    if(scenario.platform==='darwin')assert.equal(directories.data,scenario.home+'/Library/Application Support');
    const filename=scenario.paths.join(directories.data,'Adobe','Common','Motion Graphics Templates','כתוביות ותמלול','Classic Web Caption.mogrt');
    const io=memoryFs(scenario.paths,{[filename]:templateBytes()});
    const loaded=graphic.installedTemplate(directories.data,{io,paths:scenario.paths});
    assert.match(loaded.templateHash,/^[a-f0-9]{64}$/);
    assert.ok(graphic.readZip(graphic.graphicAsset(loaded,{text:'שלום 👋 עולם',offset:8,length:4})).has('project.prgraphic'));
  });
  for(const problem of ['missing','corrupt','changed-schema','denied','ambiguous'])test(`${scenario.name}: ${problem} template stops with a diagnosable failure`,()=>{
    const {data}=environment.runtimeDirectories(scenario);
    const category=scenario.paths.join(data,'Adobe','Common','Motion Graphics Templates','קטגוריה');
    const file=scenario.paths.join(category,'Classic Web Caption.mogrt');
    const io=memoryFs(scenario.paths,problem==='missing'?{}:{[file]:problem==='corrupt'?Buffer.from('invalid ZIP'):templateBytes(problem==='changed-schema'?2:1)});
    if(problem==='ambiguous')io.writeFileSync(scenario.paths.join(category,'נוספת','Classic Web Caption.mogrt'),templateBytes());
    if(problem==='denied')io.readFileSync=()=>{throw Object.assign(new Error('private path in error'),{code:'EACCES'});};
    assert.throws(()=>graphic.installedTemplate(data,{io,paths:scenario.paths}),{code:problem==='denied'?'EACCES':'unsupported_graphics'});
  });
}
test('file URLs preserve Unicode, spaces, literal percent/hash and Windows network shares',()=>{
  for(const [platform,url,expected] of [
    ['win32','file:///C:/Program%20Files/Adobe/%D7%A9%D7%9C%D7%95%D7%9D%23%25','C:\\Program Files\\Adobe\\שלום#%'],
    ['win32','file://nas/share/Adobe%20CEP','\\\\nas\\share\\Adobe CEP'],
    ['darwin','file:///Users/%D7%A9%D7%9C%D7%95%D7%9D/Library/Application%20Support/Adobe','/Users/שלום/Library/Application Support/Adobe'],
    ['darwin','/Users/Editor/a%20literal','/Users/Editor/a%20literal'],
  ])assert.equal(environment.extensionDirectory(url,platform),expected);
});
const boot = await readFile(new URL('../premiere-bridge/boot.js',import.meta.url),'utf8');
for(const scenario of scenarios)test(`${scenario.name}: CEP bootstrap logs a port conflict without storing raw messages`,()=>{
  const root=environment.runtimeDirectories(scenario).root, extension=scenario.paths.join(scenario.home,'Adobe CEP','extension');
  const io=memoryFs(scenario.paths);let timer;
  const diagnostics=bridgeDiagnostics.createBridgeDiagnostics({root,io,paths:scenario.paths});
  const context=vm.createContext({Promise,JSON,setInterval:fn=>{timer=fn;},window:{__adobe_cep__:{getSystemPath:()=>extension},cep_node:{process:{platform:scenario.platform,env:scenario.env},require(name){
    if(name==='path')return scenario.paths;if(name==='os')return {homedir:()=>scenario.home};
    if(name.endsWith('environment.js'))return environment;
    if(name.endsWith('diagnostics.js'))return {createBridgeDiagnostics:()=>diagnostics};
    if(name.endsWith('bridge-config.json'))return {token:'f'.repeat(64),port:37289};
    if(name.endsWith('pairing.js'))return {loadPairing:({development})=>development};
    if(name.endsWith('server.js'))return {startBridge:()=>{throw Object.assign(new Error('secret path and bearer token'),{code:'EADDRINUSE'});}};
    throw Error('Unexpected require');
  }}}});
  vm.runInContext(boot,context);assert.equal(diagnostics.read()[0].code,'EADDRINUSE');assert.ok(timer);
  assert.doesNotMatch(io.readFileSync(scenario.paths.join(root,'diagnostics.json')).toString(),/secret|bearer|token/);
});
for(const fault of ['IPv6 localhost only','network unavailable','manifest denied','invalid bridge JSON','old native API'])test(`bridge connection simulation: ${fault}`,async()=>{
  const client=new bridgeClient.TimelineBridge({configuration:{token:'f'.repeat(64),port:37289},fetcher:async()=>{
    if(fault==='manifest denied')throw Error('Permission denied');
    if(fault==='invalid bridge JSON')return {ok:true,json:async()=>{throw SyntaxError('invalid');}};
    if(fault==='old native API')return {ok:false,json:async()=>({ok:false,code:'unsupported_host'})};
    throw Object.assign(Error('connection failed'),{code:'ECONNREFUSED'});
  }});
  const expected=fault==='manifest denied'?'bridge_permissions':fault==='invalid bridge JSON'?'invalid_response':fault==='old native API'?'unsupported_host':'bridge_unavailable';
  await assert.rejects(client.request('/health'),{code:expected});
});
test('a real occupied local port produces EADDRINUSE and never calls the native host',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'qc-port-simulation-'));
  const occupied=http.createServer();occupied.listen(0,'127.0.0.1');await once(occupied,'listening');
  let hostCalls=0;const companion=bridgeServer.startBridge({root:directory,port:occupied.address().port,token:'f'.repeat(64),evalHost:()=>{hostCalls++;}});
  const [error]=await once(companion,'error');assert.equal(error.code,'EADDRINUSE');assert.equal(hostCalls,0);
  t.after(async()=>{companion.close();await new Promise(resolve=>occupied.close(resolve));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.match(path.basename(directory),/^qc-port-simulation-/);await rm(directory,{recursive:true,force:true});});
});
