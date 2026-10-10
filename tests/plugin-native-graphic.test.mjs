import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import graphic from '../premiere-bridge/native-graphic.js';

function template() {
  const doc = {mVersion:1,mTextParam:{mStyleSheet:{mText:'Original'}}};
  const body=Buffer.from(JSON.stringify(doc),'utf16le'),head=Buffer.alloc(8);head.writeUInt32LE(body.length);
  const node=`<ArbVideoComponentParam><Name>Source Text</Name><StartKeyframeValue Encoding="base64">${Buffer.concat([head,body]).toString('base64')}</StartKeyframeValue></ArbVideoComponentParam>`;
  return {doc,node,xml:`<Project>${node}<Keyframes>reveal</Keyframes></Project>`,definition:{authorApp:'ppro',clientControls:[{type:6}],sourceInfoLocalized:{en_US:{hasaudio:false}}}};
}
function decode(asset) {
  const outer=graphic.readZip(asset),inner=graphic.readZip(outer.get('project.prgraphic'));
  const xml=zlib.gunzipSync(inner.get('quick-caption.prproj')).toString();
  const bytes=Buffer.from(/<StartKeyframeValue[^>]*>(.*?)<\/StartKeyframeValue>/.exec(xml)[1],'base64');
  assert.equal(bytes.readUInt32LE(0),bytes.length-8);
  return {xml,doc:JSON.parse(bytes.subarray(8).toString('utf16le')),definition:JSON.parse(outer.get('definition.json').toString())};
}
test('native graphic preserves editable Hebrew and colors only the selected UTF16 span',()=>{
  const source=template(),before=JSON.stringify(source);
  const result=decode(graphic.graphicAsset(source,{text:'אני רוצה כתוביות',offset:4,length:4}));
  assert.equal(result.doc.mTextParam.mStyleSheet.mText,'אני רוצה כתוביות');
  assert.equal(result.doc.mTextParam.mRTL,true);
  assert.deepEqual(result.doc.mTextParam.mStyleSheet.mFillColor.mParamValues,[[0,0xffffff],[4,0xffd45a],[8,0xffffff]]);
  assert.equal(result.definition.clientControls[0].value.strDB[0].str,'אני רוצה כתוביות');
  assert.doesNotMatch(result.xml,/<Keyframes>/);
  assert.equal(JSON.stringify(source),before);
});
test('first and last word color runs do not recolor adjacent text',()=>{
  assert.deepEqual(decode(graphic.graphicAsset(template(),{text:'one two',offset:0,length:3})).doc.mTextParam.mStyleSheet.mFillColor.mParamValues,[[0,0xffd45a],[3,0xffffff]]);
  assert.deepEqual(decode(graphic.graphicAsset(template(),{text:'one two',offset:4,length:3})).doc.mTextParam.mStyleSheet.mFillColor.mParamValues,[[0,0xffffff],[4,0xffd45a]]);
});
test('ZIP decoding verifies checksums and rejects corrupted files',()=>{
  const entries=new Map([['עברית.txt',Buffer.from('שלום')],['data',Buffer.from([0,1,2])]]);
  const zip=graphic.writeZip(entries);assert.deepEqual(graphic.readZip(zip),entries);
  const corrupt=Buffer.from(zip),central=corrupt.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  corrupt.writeUInt32LE(1,central+16);
  assert.throws(()=>graphic.readZip(corrupt),{code:'unsupported_graphics'});
  assert.throws(()=>graphic.readZip(Buffer.from('not a ZIP')),{code:'unsupported_graphics'});
});
test('scaffold contains no source footage or caption tracks and preserves NTSC frame rate',()=>{
  const xml=graphic.scaffoldXml({frameTicks:'10594584000',width:1920,height:1080,name:'QC-test'});
  assert.match(xml,/<timebase>24<\/timebase><ntsc>TRUE<\/ntsc>/);
  assert.doesNotMatch(xml,/<clipitem|<file|<generatoritem/);
  assert.throws(()=>graphic.scaffoldXml({frameTicks:'0',width:1920,height:1080,name:'QC-test'}),{code:'unsupported_graphics'});
  assert.throws(()=>graphic.graphicAsset(template(),{text:'שלום',offset:3,length:2}),{code:'unsupported_graphics'});
});
