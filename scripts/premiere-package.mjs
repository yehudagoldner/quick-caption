import {readdir, readFile, lstat, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
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
export async function zipDirectory(directory, output, {unixModes} = {}) {
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
    const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(unixModes ? 0x0314 : 20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(0x21,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(entry.bytes.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);
    // macOS Archive Utility must retain execute permission for .app launchers
    // and .command files. Ordinary CCX/Windows archives keep their old bytes.
    if(unixModes) {
      const mode=unixModes[entry.name] ?? 0o644;
      if(![0o644,0o755].includes(mode))throw Error('Unsupported distribution file mode');
      record.writeUInt32LE(((0o100000 | mode) * 65536) >>> 0,38);
    }
    central.push(record,name);
    offset+=local.length+name.length+data.length;
  }
  const index=Buffer.concat(central), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  await writeFile(output,Buffer.concat([...chunks,index,end]));
  return entries.map(e=>e.name);
}
export async function sha256(filename) { return createHash('sha256').update(await readFile(filename)).digest('hex'); }
// Inspect small installer inputs without extraction, preserving signed bytes.
// Reject links, traversal, duplicate names and excessive expansion.
export function readZipEntries(bytes) {
  let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(bytes.readUInt32LE(at)===0x06054b50){end=at;break;}
  if(end<0 || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0)throw Error('Invalid ZIP');
  const count=bytes.readUInt16LE(end+10), files=new Map();let at=bytes.readUInt32LE(end+16),total=0;
  if(count>500 || at>=end)throw Error('Invalid ZIP bounds');
  for(let i=0;i<count;i++) {
    if(at+46>end || bytes.readUInt32LE(at)!==0x02014b50)throw Error('Invalid ZIP index');
    const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),crc=bytes.readUInt32LE(at+16),compressed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24);
    const length=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42),mode=bytes.readUInt32LE(at+38)>>>16;
    const name=bytes.subarray(at+46,at+46+length).toString('utf8');
    if(at+46+length+extra+comment>end || flags&1 || ![0,8].includes(method) || !name || /[\\\0]/.test(name) || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..') || files.has(name) || (mode&0o170000)===0o120000)throw Error('Unsafe ZIP entry');
    total+=size;if(total>8*1024*1024)throw Error('Excessive ZIP expansion');
    if(local+30>bytes.length || bytes.readUInt32LE(local)!==0x04034b50)throw Error('Invalid ZIP local entry');
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    if(start+compressed>bytes.readUInt32LE(end+16))throw Error('Invalid ZIP data bounds');
    const data=bytes.subarray(start,start+compressed),value=method===0?Buffer.from(data):inflateRawSync(data,{maxOutputLength:8*1024*1024});
    if(value.length!==size || crc32(value)!==crc)throw Error('ZIP checksum mismatch');
    files.set(name,value);at+=46+length+extra+comment;
  }
  return files;
}
