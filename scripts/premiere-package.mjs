import {readdir, readFile, lstat, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
export const VERSION = '1.0.1';
export const PACKAGE_NAMES = [`QuickCaption-Timeline-Bridge-${VERSION}.zxp`, `QuickCaption-Premiere-${VERSION}.ccx`];
const safe = name => !/(?:^|\/)(?:\.|node_modules|bridge-config\.json|\.env|\.local-secrets)/.test(name) && /\.(?:js|jsx|json|html|css|xml|md)$/.test(name) && (!name.endsWith('.json') || ['manifest.json','package.json','language-labels.json'].includes(name));
export async function stageBundle(source, destination, kind) {
  await mkdir(destination,{recursive:true});
  async function visit(folder, prefix='') {
    for(const entry of await readdir(folder,{withFileTypes:true})) {
      const name=prefix+entry.name, filename=path.join(folder,entry.name);
      if(entry.isSymbolicLink()) throw Error('Symbolic links are not allowed in installer bundles');
      if(entry.isDirectory()) { if(!entry.name.startsWith('.') && entry.name!=='node_modules') await visit(filename,name+'/'); continue; }
      if(!safe(name)) continue;
      if(!(await lstat(filename)).isFile()) throw Error('Non-regular bundle entry');
      let content=await readFile(filename);
      if(name==='manifest.json') {
        const manifest=JSON.parse(content); manifest.version=VERSION;
        content=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
      }
      if(name==='package.json') { const manifest=JSON.parse(content); manifest.version=VERSION;content=Buffer.from(JSON.stringify(manifest)+'\n'); }
      if(name==='config.js' && kind==='uxp') content=Buffer.from(`// Independent beta distribution uses the existing QA service.\nmodule.exports = {baseUrl:'https://quick-caption.com/qa', version:'${VERSION}'};\n`);
      if(name==='CSXS/manifest.xml') content=Buffer.from(content.toString().replace(/(?:ExtensionBundleVersion|Version)="1\.0\.0"/g,match=>match.replace('1.0.0',VERSION)));
      const output=path.join(destination,name);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,content);
    }
  }
  await visit(source);
}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=buffer=>{let c=0xffffffff;for(const b of buffer)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
// Adobe documents CCX as an ordinary ZIP with a root manifest. Fixed timestamps
// make the unsigned CCX reproducible; UTF-8 names and no symlinks avoid CEP bugs.
export async function zipDirectory(directory, output) {
  const entries=[];
  async function walk(folder,prefix='') {
    for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(entry.isSymbolicLink())throw Error('No symlinks');
      if(entry.isDirectory())await walk(path.join(folder,entry.name),prefix+entry.name+'/');
      else entries.push({name:prefix+entry.name,bytes:await readFile(path.join(folder,entry.name))});
    }
  }
  await walk(directory);
  const chunks=[], central=[];let offset=0;
  for(const entry of entries) {
    const name=Buffer.from(entry.name), data=deflateRawSync(entry.bytes), crc=crc32(entry.bytes);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(0x21,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(entry.bytes.length,22);local.writeUInt16LE(name.length,26);
    chunks.push(local,name,data);
    const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(0x21,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(entry.bytes.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);central.push(record,name);
    offset+=local.length+name.length+data.length;
  }
  const index=Buffer.concat(central), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  await writeFile(output,Buffer.concat([...chunks,index,end]));
  return entries.map(e=>e.name);
}
export async function sha256(filename) { return createHash('sha256').update(await readFile(filename)).digest('hex'); }
