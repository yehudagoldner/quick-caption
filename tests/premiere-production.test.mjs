import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {stageBundle,distributionText,VERSION} from '../scripts/premiere-package.mjs';
const require=createRequire(import.meta.url);
test('production packages pair privately on their own port and connect only to the production account service',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'caption-production-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [source,kind] of [['premiere-plugin','uxp'],['premiere-bridge','cep']])await stageBundle(source,path.join(root,kind),kind,'production');
  const manifest=JSON.parse(await readFile(path.join(root,'uxp/manifest.json')));
  assert.equal(manifest.id,'com.quickcaption.premiere');assert.equal(manifest.name,'Quick Caption');assert.equal(manifest.version,VERSION);
  assert.deepEqual(require(path.join(root,'uxp/config.js')),{baseUrl:'https://quick-caption.com',version:VERSION});
  assert.ok(manifest.requiredPermissions.network.domains.includes('http://localhost:37290'));
  assert.ok(!manifest.requiredPermissions.network.domains.some(d=>d.includes('37289')));
  const pairing=require(path.join(root,'cep/pairing.js'));
  const home=path.join(root,'profile');const paired=pairing.loadPairing({home});
  const uxp=require(path.join(root,'uxp/runtime-connection.js'));
  assert.equal(paired.port,37290);assert.equal(paired.token.length,64);
  const stored=JSON.parse(await readFile(uxp.connectionPath(home)));
  assert.deepEqual(stored,paired);assert.match(uxp.connectionPath(home),/premiere-production/);
  assert.deepEqual(pairing.loadPairing({home}),paired);
  const xml=await readFile(path.join(root,'cep/CSXS/manifest.xml'),'utf8');
  assert.ok(xml.includes('ExtensionBundleId="com.quickcaption.premiere.bridge"'));assert.ok(!xml.includes('.qa'));
  const panel=await readFile(path.join(root,'uxp/panel.js'),'utf8');assert.ok(panel.includes("item.id === 'com.quickcaption.premiere'"));
  for(const source of ['installer/windows/QuickCaptionSetup.cs','installer/macos/installer.sh']){
    const text=distributionText(await readFile(source,'utf8'),'production');
    assert.ok(!text.includes('com.quickcaption.premiere.qa'));assert.ok(!text.includes('Quick Caption QA'));
    assert.ok(text.includes(VERSION));
  }
});
test('unknown distribution channels fail closed',()=>assert.throws(()=>distributionText('anything','prodution'),/Unknown/));
