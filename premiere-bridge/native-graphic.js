'use strict';
// Premiere's native text API cannot read Source Text in 25.6. Generate an
// importable, editable native MOGRT from the user's installed Adobe caption
// template instead. Never redistribute Adobe assets or modify that template.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const unsupported = message => { throw Object.assign(new Error(message), { code: 'unsupported_graphics' }); };
const crcTable = Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(buffer){let c=0xffffffff;for(const b of buffer)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function readZip(buffer) {
  let end = -1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)unsupported('Invalid installed template ZIP');
  const count=buffer.readUInt16LE(end+10), entries=new Map();let at=buffer.readUInt32LE(end+16), total=0;
  if(count>1000)unsupported('Unexpected template size');
  for(let i=0;i<count;i++){
    if(at+46>buffer.length||buffer.readUInt32LE(at)!==0x02014b50)unsupported('Invalid template directory');
    const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),crc=buffer.readUInt32LE(at+16),packed=buffer.readUInt32LE(at+20),size=buffer.readUInt32LE(at+24),nameSize=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),offset=buffer.readUInt32LE(at+42);
    total+=size;if(flags&1||![0,8].includes(method)||size>16*1024*1024||total>64*1024*1024||offset+30>buffer.length||buffer.readUInt32LE(offset)!==0x04034b50)unsupported('Unsupported installed template ZIP');
    const name=buffer.subarray(at+46,at+46+nameSize).toString('utf8');
    const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);
    if(start+packed>buffer.length||entries.has(name))unsupported('Invalid template entry');
    const body=buffer.subarray(start,start+packed),value=method===8?zlib.inflateRawSync(body,{maxOutputLength:size+1}):body;
    if(value.length!==size||crc32(value)!==crc)unsupported('Template checksum mismatch');
    entries.set(name,value);at+=46+nameSize+extra+comment;
  }
  return entries;
}
function writeZip(entries){
  const local=[],central=[];let offset=0;
  for(const [name,body] of entries){
    const label=Buffer.from(name),packed=zlib.deflateRawSync(body),crc=crc32(body),head=Buffer.alloc(30),entry=Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(8,8);head.writeUInt32LE(crc,14);head.writeUInt32LE(packed.length,18);head.writeUInt32LE(body.length,22);head.writeUInt16LE(label.length,26);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(8,10);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(packed.length,20);entry.writeUInt32LE(body.length,24);entry.writeUInt16LE(label.length,28);entry.writeUInt32LE(offset,42);
    local.push(head,label,packed);central.push(entry,label);offset+=head.length+label.length+packed.length;
  }
  const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.size,8);end.writeUInt16LE(entries.size,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,index,end]);
}
function installedTemplate(adobeData, { io = fs, paths = path } = {}) {
  const directory=paths.join(adobeData,'Adobe','Common','Motion Graphics Templates');
  let filename=paths.join(directory,'Captions and Subtitles','Classic Web Caption.mogrt');
  if(!io.existsSync(filename)) {
    // Adobe's category folder may be localized or the template moved by the
    // user. Search only the known template, bounded to two category levels.
    const candidates=[]; let inspected=0;
    const scan=(folder,depth)=>{ for(const entry of io.readdirSync(folder,{withFileTypes:true})) {
      if(++inspected>500)unsupported('Too many templates to locate the caption template safely');
      if(entry.isSymbolicLink())continue;
      const value=paths.join(folder,entry.name);
      if(entry.isFile() && entry.name.toLowerCase()==='classic web caption.mogrt')candidates.push(value);
      else if(entry.isDirectory() && depth<2)scan(value,depth+1);
    }};
    if(io.existsSync(directory))scan(directory,0);
    if(candidates.length!==1)unsupported('תבנית הטקסט המובנית חסרה או אינה חד משמעית. התקינו את Classic Web Caption מתוך Graphics Templates.');
    filename=candidates[0];
  }
  if(io.statSync(filename).size>32*1024*1024)unsupported('Unexpected installed template size');
  const bytesOnDisk=io.readFileSync(filename);
  const outer=readZip(bytesOnDisk);let definition;
  try { definition=JSON.parse(outer.get('definition.json').toString('utf8')); }catch{unsupported('Invalid caption template definition');}
  if(definition.authorApp!=='ppro'||!outer.has('project.prgraphic'))unsupported('A native Premiere caption template is required');
  const inner=readZip(outer.get('project.prgraphic'));
  const projects=[...inner.keys()].filter(name=>name.endsWith('.prproj'));
  if(projects.length!==1)unsupported('Unexpected graphic project structure');
  const xml=zlib.gunzipSync(inner.get(projects[0]),{maxOutputLength:16*1024*1024}).toString('utf8');
  const textParams=[...xml.matchAll(/<ArbVideoComponentParam\b[^>]*>[\s\S]*?<\/ArbVideoComponentParam>/g)].filter(match=>/<Name>Source Text<\/Name>/.test(match[0]));
  if(textParams.length!==1)unsupported('Caption template must contain exactly one editable text layer');
  const node=textParams[0][0],value=/<StartKeyframeValue\b[^>]*>([\s\S]*?)<\/StartKeyframeValue>/.exec(node);
  if(!value)unsupported('Missing native text data');
  const bytes=Buffer.from(value[1].replace(/\s/g,''),'base64');let doc;
  if(bytes.length<8||bytes.readUInt32LE(0)!==bytes.length-8)unsupported('Unknown native text encoding');
  try { doc=JSON.parse(bytes.subarray(8).toString('utf16le')); }catch{unsupported('Unknown native text format');}
  if(doc.mVersion!==1||!doc.mTextParam?.mStyleSheet||typeof doc.mTextParam.mStyleSheet.mText!=='string')unsupported('Unknown native text schema');
  return { definition, xml, node, doc, templateHash: crypto.createHash('sha256').update(bytesOnDisk).digest('hex') };
}
function graphicAsset(template,{text,offset=0,length=0,color='#FFD45A',name='Quick Caption',font='ArialMT'}) {
  if(typeof text!=='string'||!text.trim()||text.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)||!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||length<0||offset+length>text.length||!/^#[0-9a-f]{6}$/i.test(color))unsupported('Invalid native caption text');
  const definition=JSON.parse(JSON.stringify(template.definition)),doc=JSON.parse(JSON.stringify(template.doc));
  const uuid=()=>crypto.randomUUID();
  definition.capsuleID=uuid();definition.capsuleName=name;definition.capsuleNameLocalized={strDB:[{localeString:'en_US',str:name}]};
  definition.sourceInfoLocalized={en_US:definition.sourceInfoLocalized.en_US};
  definition.usedFontsLocalized={en_US:[font]};
  for(const control of definition.clientControls){if(control.type===6)control.value={strDB:[{localeString:'en_US',str:text}]};}
  const param=doc.mTextParam,style=param.mStyleSheet;
  param.mRTL=/[\u0590-\u08ff]/.test(text);param.mLigatures=true;param.mAlignment=2;param.mLeading=0;
  style.mText=text;style.mFontName={mParamValues:[[0,font]]};style.mFontSize={mParamValues:[[0,64]]};
  style.mBaselineShift={mParamValues:[[0,0]]};style.mFillVisible={mParamValues:[[0,true]]};
  const colors=[[0,0xffffff]],highlight=parseInt(color.slice(1),16);
  if(length){if(offset===0)colors[0][1]=highlight;else colors.push([offset,highlight]);if(offset+length<text.length)colors.push([offset+length,0xffffff]);}
  style.mFillColor={mParamValues:colors};
  const body=Buffer.from(JSON.stringify(doc),'utf16le'),header=Buffer.alloc(8);header.writeUInt32LE(body.length,0);
  const node=template.node.replace(/<StartKeyframeValue\b[^>]*>[\s\S]*?<\/StartKeyframeValue>/,`<StartKeyframeValue Encoding="base64" BinaryHash="${uuid()}">${Buffer.concat([header,body]).toString('base64')}</StartKeyframeValue>`);
  let xml=template.xml.replace(template.node,()=>node);
  // The installed caption has a reveal animation. Word-state clips must remain
  // stationary when trimmed, otherwise every word would restart the reveal.
  xml=xml.replace(/<Keyframes>[\s\S]*?<\/Keyframes>/g,'').replace(/<IsTimeVarying>true<\/IsTimeVarying>/g,'<IsTimeVarying>false</IsTimeVarying>');
  xml=xml.replace(/<VideoComponentParam\b[^>]*>[\s\S]*?<\/VideoComponentParam>/g,node=>{
    if(!/<Name>Horizontal Scale<\/Name>/.test(node))return node;
    return node.replace(/<StartKeyframe>[^<]*<\/StartKeyframe>/,'<StartKeyframe>-91445760000000000,100.,0,0,0,0,0,0</StartKeyframe>').replace(/<CurrentValue>[^<]*<\/CurrentValue>/,'<CurrentValue>100</CurrentValue>');
  });
  const inner=writeZip(new Map([['quick-caption.prproj',zlib.gzipSync(Buffer.from(xml))]]));
  return writeZip(new Map([['definition.json',Buffer.from(JSON.stringify(definition))],['project.prgraphic',inner]]));
}
function scaffoldXml({frameTicks,width,height,name}) {
  if(!/^\d+$/.test(String(frameTicks))||![width,height].every(n=>Number.isInteger(n)&&n>=16&&n<=16384)||!/^QC-[a-z0-9-]+$/.test(name))unsupported('Invalid native sequence settings');
  const fps=254016000000/Number(frameTicks),base=Math.round(fps),ntsc=Math.abs(fps-base/1.001)<.0001;
  if(!Number.isFinite(fps)||fps<10||fps>240||(!ntsc&&Math.abs(fps-base)>.0001))unsupported('Unsupported fractional sequence frame rate');
  const rate=`<rate><timebase>${base}</timebase><ntsc>${ntsc?'TRUE':'FALSE'}</ntsc></rate>`;
  return `<?xml version="1.0" encoding="UTF-8"?><xmeml version="4"><sequence id="${name}"><name>${name}</name><duration>1</duration>${rate}<media><video><format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format><track/></video><audio><channelcount>2</channelcount><track/></audio></media></sequence></xmeml>`;
}
module.exports={installedTemplate,graphicAsset,readZip,writeZip,scaffoldXml};
