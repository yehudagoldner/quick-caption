import {mkdtemp, mkdir, readFile, writeFile, rm, copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageBundle,zipDirectory,sha256,VERSION,PACKAGE_NAMES} from './premiere-package.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
if(process.platform!=='win32')throw Error('Build the Windows CEP signature on Windows. Mac signing and validation require a separate Mac build.');
const output=path.join(root,'artifacts','premiere-installer');await mkdir(output,{recursive:true});
const tempRoot=path.join(root,'tmp','installer-build');await mkdir(tempRoot,{recursive:true});
const staging=await mkdtemp(path.join(tempRoot,'build-'));
function run(exe,args,{secret=false,cwd=root}={}) {
  const result=spawnSync(exe,args,{encoding:'utf8',timeout:120000,windowsHide:true,cwd});
  if(result.status!==0)throw Error(`${path.basename(exe)} failed (${result.status}): ${secret?'Signing operation failed; no secrets printed':(result.stderr||result.stdout||result.error?.message)}`);
  return result.stdout;
}
try {
  const signer=path.join(root,'tmp','installer-tools','ZXPSignCmd.exe');
  // Official Adobe CEP Resources 4.1.3 x64 binary. Never ship the build tool.
  if(await sha256(signer)!=='ffc2223167225ce61d024eb463fc5ad1a1be16133f99ef334a646f7311916c98')throw Error('Unexpected Adobe signing tool hash');
  const privateRoot=path.join(root,'.local-secrets','premiere-signing');await mkdir(privateRoot,{recursive:true,mode:0o700});
  const certificate=path.join(privateRoot,'beta.p12'), passwordFile=path.join(privateRoot,'password');
  let password;
  try { password=(await readFile(passwordFile,'utf8')).trim();await readFile(certificate); }
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    const present=await Promise.all([passwordFile,certificate].map(file=>readFile(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;})));
    if(present.some(Boolean))throw Error('Incomplete private signing material; restore the matching certificate and password before rebuilding');
    password=randomBytes(32).toString('hex');
    run(signer,['-selfSignedCert','IL','Israel','Quick Caption','Quick Caption Independent Beta',password,certificate,'-validityDays','1095'],{secret:true,cwd:privateRoot});
    await writeFile(passwordFile,password,{mode:0o600,flag:'wx'});
  }
  const cep=path.join(staging,'cep'),uxp=path.join(staging,'uxp');
  await stageBundle(path.join(root,'premiere-bridge'),cep,'cep');await stageBundle(path.join(root,'premiere-plugin'),uxp,'uxp');
  const bridgePackage=path.join(output,PACKAGE_NAMES[0]), pluginPackage=path.join(output,PACKAGE_NAMES[1]);
  run(signer,['-sign',cep,bridgePackage,certificate,password],{secret:true,cwd:privateRoot});
  const verification=run(signer,['-verify',bridgePackage]);
  if(!/Signature verified successfully/i.test(verification))throw Error('ZXP signature verification failed');
  await zipDirectory(uxp,pluginPackage);
  const checksums=Object.fromEntries(await Promise.all(PACKAGE_NAMES.map(async name=>[name,await sha256(path.join(output,name))])));
  const checksumFile=path.join(staging,'checksums.json');await writeFile(checksumFile,JSON.stringify(checksums));
  const exe=path.join(output,`QuickCaption-Setup-${VERSION}-Windows.exe`);
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  run(compiler,['/nologo','/target:winexe','/platform:x64','/optimize+','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll',`/out:${exe}`,`/resource:${checksumFile},checksums.json`,...PACKAGE_NAMES.map(name=>`/resource:${path.join(output,name)},${name}`),path.join(root,'installer','windows','QuickCaptionSetup.cs')]);
  const payloadTest=run(exe,['--verify']);
  checksums[path.basename(exe)]=await sha256(exe);
  await writeFile(path.join(output,'checksums.json'),JSON.stringify(checksums,null,2)+'\n');
  await writeFile(path.join(output,'build-info.json'),JSON.stringify({version:VERSION,channel:'qa',platform:'win32-x64',minimumPremiere:'25.6.0',builtAt:new Date().toISOString(),zxpSignature:verification.trim(),installerAuthenticode:false,macValidated:false},null,2)+'\n');
  await copyFile(path.join(root,'docs','premiere-installer.md'),path.join(output,'README.md'));
  const share=path.join(staging,'share');await mkdir(share);
  for(const name of [path.basename(exe),'README.md','checksums.json','build-info.json'])await copyFile(path.join(output,name),path.join(share,name));
  await zipDirectory(share,path.join(output,`QuickCaption-Installer-${VERSION}-Windows.zip`));
  console.log(JSON.stringify({output,verification:JSON.parse(payloadTest),files:Object.keys(checksums)},null,2));
} finally {
  // mkdtemp owns this exact verified child; never remove output or user media.
  if(path.dirname(staging)!==tempRoot)throw Error('Unsafe staging cleanup');
  await rm(staging,{recursive:true,force:true});
}
