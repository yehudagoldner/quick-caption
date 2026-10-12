// Local browser verification, or pass the published QA URL. Does not install
// packages or open a visible browser; macOS here means browser emulation only.
import {chromium} from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,rm,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPremiereDownloadsRouter} from '../routes/premiereDownloads.js';
import {PREMIERE_DOWNLOADS} from '../src/premiereRelease.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const source=name=>path.join(root,'artifacts',name.includes('-Windows')?'premiere-installer':'premiere-installer-mac',name);
let server,temporary,base=process.argv[2];
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || undefined});
const windowsUA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
const macUA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
async function context(platform,{ua=windowsUA,hint,points=0,javaScriptEnabled=true,viewport={width:1366,height:1000}}={}) {
  const context=await browser.newContext({userAgent:ua,javaScriptEnabled,viewport});
  await context.addInitScript(({platform,hint,points})=>{
    Object.defineProperty(navigator,'platform',{value:platform});
    Object.defineProperty(navigator,'userAgentData',{value:hint});
    Object.defineProperty(navigator,'maxTouchPoints',{value:points});
  },{platform,hint,points});
  return context;
}
async function downloadAndCheck(page,platform) {
  const link=page.locator(`[data-installer="${platform}"]`);
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:15000}),link.click()]);
  assert.equal(await page.locator('#download-status').isVisible(),true);
  assert.match(await page.locator('#download-status').textContent(),/בקשת ההורדה נשלחה/);
  assert.equal(await download.failure(),null);
  const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  const bytes=Buffer.concat(chunks),expected=await readFile(source(download.suggestedFilename()));
  assert.deepEqual(bytes,expected);
  console.log(JSON.stringify({download:download.suggestedFilename(),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
}
try {
  if(!base) {
    temporary=await mkdtemp(path.join(os.tmpdir(),'caption-browser-downloads-'));
    for(const name of PREMIERE_DOWNLOADS.filter(name=>/\.(exe|zip)$/.test(name)))await copyFile(source(name),path.join(temporary,name));
    const app=express();app.use('/qa/downloads/premiere',createPremiereDownloadsRouter({directory:temporary,enabled:true}));
    app.use('/qa',express.static(path.join(root,'dist')));
    server=app.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}/qa/?screen=premiere`;
  }
  for(const scenario of [
    {name:'Windows Chrome/Edge',platform:'Win32',hint:{platform:'Windows',mobile:false},expected:'windows'},
    {name:'Windows Firefox fallback',platform:'Win32',expected:'windows'},
    {name:'Mac Safari',platform:'MacIntel',ua:macUA,expected:'mac'},
    {name:'Mac Chrome',platform:'MacIntel',ua:macUA,hint:{platform:'macOS',mobile:false},expected:'mac'},
    {name:'iPad desktop mode',platform:'MacIntel',ua:macUA,points:5,expected:null,viewport:{width:390,height:844}},
    {name:'Linux',platform:'Linux x86_64',ua:'Mozilla/5.0 (X11; Linux x86_64)',expected:null},
    {name:'unknown browser',platform:'',ua:'Private Browser',expected:null},
  ]) {
    const ctx=await context(scenario.platform,scenario),page=await ctx.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('#platform-switch').waitFor({state:'visible'});
    for(const platform of ['windows','mac'])assert.equal(await page.locator(`[data-installer="${platform}"]`).isVisible(),!scenario.expected||scenario.expected===platform,scenario.name);
    if(scenario.expected) {
      const other=scenario.expected==='windows'?'mac':'windows';
      assert.equal(await page.locator(`ol[data-platform-panel="${scenario.expected}"]`).isVisible(),true);
      assert.equal(await page.locator(`ol[data-platform-panel="${other}"]`).isVisible(),false);
      assert.match(await page.locator('#platform-detection').textContent(),/זיהינו/);
      if(scenario.name==='Windows Chrome/Edge'||scenario.name==='Mac Safari')await downloadAndCheck(page,scenario.expected);
      if(scenario.name==='Windows Chrome/Edge')await downloadAndCheck(page,'windows-zip');
      await page.locator(`[data-platform="${other}"]`).click();
      assert.equal(await page.locator(`[data-installer="${other}"]`).isVisible(),true);
      assert.equal(await page.locator(`[data-installer="${scenario.expected}"]`).isVisible(),false);
      assert.equal(await page.locator(`ol[data-platform-panel="${other}"]`).isVisible(),true);
      assert.match(await page.locator('#platform-detection').textContent(),/בחרתם/);
      assert.equal(await page.locator('#download-status').isVisible(),false);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,scenario.name+' overflow');
    assert.deepEqual(errors,[]);
    console.log('Verified '+scenario.name);await ctx.close();
  }
  for (const width of [1366,390]) {
    const ctx=await context('Win32',{viewport:{width,height:900}}),page=await ctx.newPage();
    const rootUrl=new URL('./',base).href;
    await page.goto(rootUrl,{waitUntil:'networkidle'});
    await page.evaluate(()=>{window.__premiereHeader=document.querySelector('[data-testid="app-header"]');});
    await page.getByRole('button',{name:'תוסף לפרימייר',exact:true}).click();
    await page.locator('#premiere-download').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('screen'),'premiere');
    assert.equal(ctx.pages().length,1,'navigation must stay in the same tab');
    assert.equal(await page.evaluate(()=>window.__premiereHeader===document.querySelector('[data-testid="app-header"]')),true,'shared header must stay mounted');
    await page.getByRole('button',{name:'חזרה לדף הבית',exact:false}).click();
    assert.equal(new URL(page.url()).searchParams.has('screen'),false);
    await page.goBack();await page.locator('#premiere-download').waitFor();
    await page.goForward();await page.locator('#premiere-download').waitFor({state:'detached'});
    await page.goto(new URL('premiere.html#tutorial',rootUrl).href,{waitUntil:'networkidle'});
    await page.locator('#premiere-download').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('screen'),'premiere');assert.equal(new URL(page.url()).hash,'#tutorial');
    await page.reload({waitUntil:'networkidle'});await page.locator('#premiere-download').waitFor();
    const video=page.locator('#tutorial video');
    await video.evaluate(v=>{v.muted=true;return v.play();});
    await page.waitForFunction(()=>document.querySelector('#tutorial video').currentTime>0.3);
    assert.equal(await video.evaluate(v=>v.duration),44);
    assert.equal(await video.evaluate(v=>v.currentSrc.includes('premiere-tutorial-silent.mp4')),true);
    await video.evaluate(v=>{v.currentTime=30;});await page.waitForFunction(()=>document.querySelector('#tutorial video').currentTime>30.3);await video.evaluate(v=>v.pause());
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await mkdir(path.join(root,'tmp'),{recursive:true});await page.screenshot({path:path.join(root,'tmp',`premiere-react-${width}.png`)});
    await page.getByRole('button',{name:'Quick Caption — דף הבית',exact:true}).click();await page.locator('#premiere-download').waitFor({state:'detached'});
    console.log('Verified shared navigation, history, legacy URL and video: '+width);await ctx.close();
  }
  const screenshot=await browser.newPage({viewport:{width:1366,height:1000}});
  await screenshot.goto(base,{waitUntil:'networkidle'});
  await mkdir(path.join(root,'tmp'),{recursive:true});await screenshot.screenshot({path:path.join(root,'tmp','premiere-platform-windows.png'),fullPage:true});
  console.log('Native downloads, platform instructions, React navigation, silent-video playback and layout verified');
} finally {
  await browser.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  if(temporary)await rm(temporary,{recursive:true,force:true});
}
