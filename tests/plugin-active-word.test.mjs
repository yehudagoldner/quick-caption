import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import native from '../premiere-bridge/active-word-plan.js';
import { synchronizeWords } from '../src/wordAlignment.js';
import bridgeAlignment from '../premiere-bridge/word-alignment.js';
const frameTicks = String(native.TICKS_PER_SECOND / 25);
const fixture = { frameTicks, segments: [{id:1,start:0,end:2,text:'אני רוצה כתוביות'}], words:[{word:'אני',start:.12,end:.48},{word:'רוצה',start:.6,end:.96},{word:'כתוביות',start:1.12,end:1.8}], ranges:[{start:10,end:12,outputStart:0}] };
test('word highlighting keeps text unchanged, leaves pauses unhighlighted and covers the sentence on whole frames', () => {
  const plan = native.buildActiveWordPlan(fixture), p = plan.phrases[0];
  assert.equal(p.text, fixture.segments[0].text); assert.equal(p.startFrame,250);assert.equal(p.endFrame,300);
  assert.deepEqual(p.states.map(s=>s.word),['','אני','','רוצה','','כתוביות','']);
  assert.equal(p.states[0].startFrame,0);assert.equal(p.states.at(-1).endFrame,50);
  for(let i=0;i<p.states.length;i++){const s=p.states[i];assert.ok(s.endFrame>s.startFrame);assert.ok(Number.isInteger(s.startFrame));if(i)assert.equal(s.startFrame,p.states[i-1].endFrame);if(s.word)assert.equal(p.text.slice(s.offset,s.offset+s.length),s.word);}
});
test('non-contiguous selections split a sentence at gaps and never highlight deselected material', () => {
  const plan = native.buildActiveWordPlan({...fixture,ranges:[{start:10,end:11,outputStart:0},{start:30,end:31,outputStart:1}]});
  assert.deepEqual(plan.phrases.map(p=>[p.startFrame,p.endFrame]),[[250,275],[750,775]]);
  assert.equal(plan.phrases[1].states.at(-2).word,'כתוביות');
});
test('unicode offsets preserve punctuation, line breaks and surrogate pairs', () => {
  const plan = native.buildActiveWordPlan({...fixture,segments:[{id:1,start:0,end:2,text:'שלום!\n😀 עולם'}],words:[{word:'שלום',start:0,end:.5},{word:'😀',start:.6,end:1},{word:'עולם',start:1.1,end:2}]});
  const p=plan.phrases[0];for(const s of p.states)if(s.length)assert.equal(p.text.slice(s.offset,s.offset+s.length),s.word);
});
test('translation or correction aligns to displayed words and never resurrects raw model text', () => {
  const plan = native.buildActiveWordPlan({...fixture,segments:[{id:1,start:0,end:2,text:'אני מבקש כתוביות'}]});
  assert.equal(plan.phrases[0].states.some(s=>s.word==='רוצה'),false);assert.ok(plan.phrases[0].states.some(s=>s.word==='מבקש'));
});
test('invalid data cannot create misleading or out-of-selection graphics', () => {
  for(const changed of [{words:[]},{frameTicks:'0'},{color:'invalid'},{ranges:[{start:10,end:12,outputStart:1}]},{segments:[...fixture.segments,{id:2,start:1,end:2,text:'overlap'}]},{segments:[{id:1,start:0,end:3,text:'outside'}]}])assert.throws(()=>native.buildActiveWordPlan({...fixture,...changed}),{code:'invalid_graphics'});
});
test('the Premiere copy of alignment is generated from the current website rules', async () => {
  const source=await readFile(new URL('../src/wordAlignment.js',import.meta.url),'utf8');const built=await readFile(new URL('../premiere-bridge/word-alignment.js',import.meta.url),'utf8');
  assert.ok(built.includes(createHash('sha256').update(source).digest('hex')),'Regenerate bridge alignment after changing website rules');
  assert.deepEqual(bridgeAlignment.synchronizeWords(fixture.segments,fixture.words),synchronizeWords(fixture.segments,fixture.words));
});
