import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256,zipDirectory,readZipEntries,VERSION,PACKAGE_NAMES} from './premiere-package.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
export async function buildMacInstaller({input=path.join(root,'artifacts','premiere-installer'),output=path.join(root,'artifacts','premiere-installer-mac')}={}) {
  const provenance=JSON.parse(await readFile(path.join(input,'build-info.json'),'utf8'));
  const expected=JSON.parse(await readFile(path.join(input,'checksums.json'),'utf8'));
  if(provenance.version!==VERSION || provenance.channel!=='qa' || !/Signature verified successfully/i.test(provenance.zxpSignature))throw Error('Unverified Adobe package provenance');
  for(const name of PACKAGE_NAMES)if(!/^[a-f0-9]{64}$/.test(expected[name]||'') || await sha256(path.join(input,name))!==expected[name])throw Error('Adobe package checksum mismatch');
  const cep=readZipEntries(await readFile(path.join(input,PACKAGE_NAMES[0]))),uxp=readZipEntries(await readFile(path.join(input,PACKAGE_NAMES[1])));
  const manifest=JSON.parse(uxp.get('manifest.json'));
  if(manifest.id!=='com.quickcaption.premiere.qa' || manifest.version!==VERSION || manifest.host?.app!=='premierepro' || manifest.host.minVersion!=='25.6.0')throw Error('Unexpected UXP manifest');
  if(!cep.has('META-INF/signatures.xml') || !/ExtensionBundleId="com.quickcaption.premiere.bridge.qa"/.test(cep.get('CSXS/manifest.xml')?.toString()) || !cep.get('CSXS/manifest.xml')?.toString().includes(`ExtensionBundleVersion="${VERSION}"`))throw Error('Unexpected CEP manifest/signature');
  for(const archive of [cep,uxp])for(const name of archive.keys())if(/(?:^|\/)(?:bridge-config\.json|\.env|\.local-secrets|\.DS_Store)|\.(?:p12|epr|mogrt|mp[34]|log)$/i.test(name))throw Error('Private or Adobe-owned asset in input');
  await mkdir(output,{recursive:true});
  const temporaryRoot=path.join(root,'tmp','installer-build');await mkdir(temporaryRoot,{recursive:true});
  const staging=await mkdtemp(path.join(temporaryRoot,'mac-'));
  try {
    const app='Quick Caption Setup.app',contents=path.join(staging,app,'Contents'),resources=path.join(contents,'Resources');
    await mkdir(path.join(contents,'MacOS'),{recursive:true});await mkdir(resources);
    for(const name of PACKAGE_NAMES)await copyFile(path.join(input,name),path.join(resources,name));
    for(const name of ['installer.sh','cleanup.sh'])await copyFile(path.join(root,'installer','macos',name),path.join(resources,name));
    await copyFile(path.join(root,'docs','premiere-installer-mac.md'),path.join(resources,'README.md'));
    await copyFile(path.join(root,'docs','premiere-installer-mac.md'),path.join(staging,'README.md'));
    await copyFile(path.join(root,'installer','macos','QuickCaptionSetup'),path.join(contents,'MacOS','QuickCaptionSetup'));
    for(const name of ['Install Quick Caption.command','Quick Caption Diagnostics.command'])await copyFile(path.join(root,'installer','macos',name),path.join(staging,name));
    const metadata={version:VERSION,channel:'qa',minimumPremiere:'25.6.0',minimumMacOS:'13.0',architectures:['x64','arm64'],builtAt:new Date().toISOString(),appleSigned:false,notarized:false,nativeMacValidated:false,cepSignaturePlatform:provenance.platform.startsWith('darwin')?'darwin':'win32',sourcePackages:expected};
    await writeFile(path.join(resources,'build-info.json'),JSON.stringify(metadata,null,2)+'\n');
    await writeFile(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.quickcaption.premiere.installer.qa</string>
<key>CFBundleName</key><string>Quick Caption Setup</string>
<key>CFBundleDisplayName</key><string>Quick Caption Setup</string>
<key>CFBundleExecutable</key><string>QuickCaptionSetup</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${VERSION}</string>
<key>CFBundleShortVersionString</key><string>${VERSION}</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
    const hashes=[];
    for(const name of (await readdir(resources)).sort())hashes.push(`${await sha256(path.join(resources,name))}  ${name}`);
    await writeFile(path.join(resources,'SHA256SUMS'),hashes.join('\n')+'\n');
    const archive=path.join(output,`QuickCaption-Installer-${VERSION}-Mac-Beta.zip`);
    const executableNames=[`${app}/Contents/MacOS/QuickCaptionSetup`,`${app}/Contents/Resources/installer.sh`,`${app}/Contents/Resources/cleanup.sh`,'Install Quick Caption.command','Quick Caption Diagnostics.command'];
    const files=await zipDirectory(staging,archive,{unixModes:Object.fromEntries(executableNames.map(name=>[name,0o755]))});
    await copyFile(path.join(staging,'README.md'),path.join(output,'README.md'));
    await copyFile(path.join(resources,'build-info.json'),path.join(output,'build-info.json'));
    await writeFile(path.join(output,'checksums.json'),JSON.stringify({[path.basename(archive)]:await sha256(archive)},null,2)+'\n');
    return {archive,files:files.length,...metadata};
  } finally {
    if(path.dirname(staging)!==temporaryRoot)throw Error('Unsafe staging cleanup');
    await rm(staging,{recursive:true,force:true});
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildMacInstaller(),null,2));
