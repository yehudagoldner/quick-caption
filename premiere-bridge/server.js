'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildActiveWordPlan } = require('./active-word-plan.js');
const { installedTemplate, graphicAsset, scaffoldXml } = require('./native-graphic.js');
const { runtimeDirectories } = require('./environment.js');
const { errorDetails } = require('./diagnostics-schema.js');
const MAX_BODY = 4 * 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const failure = (message, code, status = 409) => Object.assign(new Error(message), { code, status });

function validateTarget(target) {
  if (!target || typeof target.projectPath !== 'string' || !target.projectPath || typeof target.sequenceId !== 'string' || !target.sequenceId || !Array.isArray(target.clips) || !target.clips.length) throw failure('Missing original timeline', 'invalid_target', 400);
  for (const clip of target.clips) {
    if (!['Audio', 'Video'].includes(clip.kind) || !Number.isInteger(clip.track) || clip.track < 0 || typeof clip.sourcePath !== 'string' || !clip.sourcePath || !['startTicks', 'endTicks', 'inTicks', 'outTicks'].every(key => /^\d+$/.test(clip[key] || '')) || !Number.isFinite(clip.speed) || typeof clip.reversed !== 'boolean' || typeof clip.disabled !== 'boolean') throw failure('Invalid clip snapshot', 'invalid_target', 400);
  }
}
function validateRequest(data) {
  if (!data || !/^[a-zA-Z0-9:_-]{1,160}$/.test(data.id || '')) throw failure('Invalid delivery ID', 'invalid_request', 400);
  validateTarget(data.target);
  if (typeof data.srt !== 'string' || Buffer.byteLength(data.srt, 'utf8') > MAX_BODY / 2) throw failure('Invalid subtitles', 'invalid_subtitles', 400);
  const blocks = data.srt.replace(/\r/g, '').trim().split(/\n\s*\n/);
  if (!blocks.length || blocks.some(block => !/^\d+\n\d+:\d{2}:\d{2},\d{3} --> \d+:\d{2}:\d{2},\d{3}\n[^\0]+$/.test(block))) throw failure('Invalid SRT', 'invalid_subtitles', 400);
}

function createDeliveryService({ root, evalHost, loadTemplate = () => installedTemplate(runtimeDirectories().data) }) {
  fs.mkdirSync(path.join(root, 'captions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'receipts'), { recursive: true });
  let queue = Promise.resolve();
  const serialized = action => { const next = queue.then(action); queue = next.catch(() => {}); return next; };
  const writeReceipt = (filename, receipt) => {
    const temporary = filename + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(receipt), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, filename);
  };
  let graphicsProof = null;
  const probeGraphics = async (render = true) => {
    const info=await evalHost('graphicsInfo',{});
    const template = loadTemplate();
    const directory = path.join(root, 'probe');fs.mkdirSync(directory, { recursive: true });
    const assetPath = path.join(directory, 'native-word.mogrt');
    fs.writeFileSync(assetPath, graphicAsset(template,{text:'אני רוצה כתוביות',offset:4,length:4,name:'Quick Caption compatibility check'}));
    const scaffoldPath=path.join(directory,'native-word.xml');fs.writeFileSync(scaffoldPath,scaffoldXml({...info,name:'QC-probe-'+crypto.randomBytes(8).toString('hex')}));
    return evalHost('inspectNativeGraphics', {render,assetPath,scaffoldPath,projectOutput:path.join(directory,'native-word.prproj'),imageOutput:path.join(directory,'native-word.png')});
  };
  return {
    health: () => serialized(() => evalHost('health', {})),
    setupInfo: () => serialized(() => evalHost('setupInfo', {})),
    inspectNativeGraphics: () => serialized(() => probeGraphics(true)),
    prepare: target => serialized(() => { validateTarget(target); return evalHost('prepare', { target }); }),
    prepareGraphics: target => serialized(async () => {
      validateTarget(target);const info=await evalHost('prepare', {target});
      const signature=JSON.stringify([info.frameTicks,info.width,info.height]);
      const template=loadTemplate();
      if(graphicsProof!==signature){await probeGraphics(false);graphicsProof=signature;}
      return { ...await evalHost('prepare', {target}), environment: { templateCompatible: true, templateHash: template.templateHash, fontVerified: false } };
    }),
    buildGraphics: data => serialized(async () => {
      if(!data||!/^[a-zA-Z0-9:_-]{1,160}$/.test(data.id||''))throw failure('Invalid graphics ID','invalid_graphics',400);
      validateTarget(data.target);
      const identity=hash(data.id),fingerprint=hash(JSON.stringify({target:data.target,segments:data.segments,words:data.words,ranges:data.ranges,color:data.color}));
      const receiptPath=path.join(root,'receipts','graphics-'+identity+'.json');
      let receipt;try{receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
      if(receipt?.fingerprint!==undefined&&receipt.fingerprint!==fingerprint)throw failure('Graphics ID belongs to different captions','delivery_conflict');
      if(receipt?.status==='built')return {...receipt.result,replay:true};
      if(receipt?.status==='building') {
        const cached=await evalHost('lookupGraphics',{id:data.id});
        if(cached.result){writeReceipt(receiptPath,{fingerprint,status:'built',result:cached.result});return {...cached.result,replay:true};}
        throw failure('Graphics may already exist. Recover the existing sequences before retrying.','delivery_uncertain');
      }
      const info=await evalHost('prepare',{target:data.target});
      const plan=buildActiveWordPlan({...data,frameTicks:info.frameTicks});
      const template=loadTemplate();
      const directory=path.join(root,'graphics',identity);fs.mkdirSync(directory,{recursive:true});
      const scaffoldPath=path.join(directory,'empty.xml');fs.writeFileSync(scaffoldPath,scaffoldXml({...info,name:'QC-build-'+identity}));
      for(let i=0;i<plan.phrases.length;i++)for(let j=0;j<plan.phrases[i].states.length;j++) {
        const phrase=plan.phrases[i],state=phrase.states[j],assetPath=path.join(directory,`${i}-${j}.mogrt`);
        fs.writeFileSync(assetPath,graphicAsset(template,{text:phrase.text,offset:state.offset,length:state.length,color:plan.color,name:`Quick Caption ${i+1} · ${state.word||'ללא הדגשה'}`}));
        state.assetPath=assetPath;
      }
      writeReceipt(receiptPath,{fingerprint,status:'building'});
      try {
        const result=await evalHost('buildGraphics',{id:data.id,target:data.target,plan,scaffoldPath});
        writeReceipt(receiptPath,{fingerprint,status:'built',result});return result;
      }catch(error){if(['wrong_project','missing_sequence','changed_clip','unsupported_host'].includes(error.code))writeReceipt(receiptPath,{fingerprint,status:'retryable'});throw error;}
    }),
    deliver: data => serialized(async () => {
      validateRequest(data);
      const identity = hash(data.id);
      const fingerprint = hash(JSON.stringify({ target: data.target, srt: data.srt }));
      const receiptPath = path.join(root, 'receipts', identity + '.json');
      let receipt = null;
      try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (receipt && receipt.fingerprint !== fingerprint) throw failure('Delivery ID already belongs to different subtitles', 'delivery_conflict');
      if (receipt && receipt.status === 'delivered') return { ...receipt.result, replay: true };
      if (receipt && receipt.status === 'applying') {
        // A crash may have occurred after Premiere committed the track. Never blindly replay.
        const cached = await evalHost('lookup', { id: data.id });
        if (cached.result) {
          writeReceipt(receiptPath, { fingerprint, status: 'delivered', result: cached.result });
          return { ...cached.result, replay: true };
        }
        throw failure('Caption placement may already have completed. Check the timeline before recovery.', 'delivery_uncertain');
      }
      await evalHost('prepare', { target: data.target });
      const srtPath = path.join(root, 'captions', identity + '.srt');
      // Stable permanent source path; no save dialog and no temp-file dependency in the project.
      fs.writeFileSync(srtPath, '\uFEFF' + data.srt, { encoding: 'utf8', mode: 0o600 });
      writeReceipt(receiptPath, { fingerprint, status: 'applying' });
      try {
        const result = await evalHost('deliver', { id: data.id, target: data.target, srtPath });
        writeReceipt(receiptPath, { fingerprint, status: 'delivered', result });
        return result;
      } catch (error) {
        // Only an explicit host rejection before createCaptionTrack is safely retryable.
        if (['wrong_project', 'missing_sequence', 'changed_clip', 'unsupported_host', 'import_failed', 'missing_import'].includes(error.code)) writeReceipt(receiptPath, { fingerprint, status: 'retryable' });
        throw error;
      }
    }),
  };
}

function startBridge({ root, token, evalHost, port = 37289, diagnostics }) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Missing installation pairing key');
  const service = createDeliveryService({ root, evalHost });
  const server = http.createServer(async (request, response) => {
    const reply = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
    const expectedHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
    // No CORS headers or OPTIONS handler: websites cannot acquire the pairing key or
    // send this custom authenticated header. Reject browser origins and DNS rebinding.
    if (!expectedHosts.includes(request.headers.host) || request.headers.origin || request.headers['x-quick-caption-bridge'] !== token) { reply(403, { error: 'Forbidden', code: 'forbidden' }); return; }
    try {
      if (request.method === 'GET' && request.url === '/health') { reply(200, { ...await service.health(), environment: { os: process.platform, arch: process.arch, runtimeVersion: process.versions.node }, diagnostics: diagnostics?.read() || [] }); return; }
      if (request.method === 'GET' && request.url === '/setup-info') { reply(200, await service.setupInfo()); return; }
      if (request.method !== 'POST' || !['/prepare', '/deliver', '/native-graphics-probe','/prepare-graphics','/build-graphics'].includes(request.url)) { reply(404, { error: 'Not found' }); return; }
      if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw failure('JSON required', 'invalid_request', 415);
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw failure('Request too large', 'invalid_request', 413); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('Invalid JSON', 'invalid_request', 400); }
      const routes={'/prepare':()=>service.prepare(body.target),'/deliver':()=>service.deliver(body),'/native-graphics-probe':()=>service.inspectNativeGraphics(),'/prepare-graphics':()=>service.prepareGraphics(body.target),'/build-graphics':()=>service.buildGraphics(body)};
      reply(200, await routes[request.url]());
    } catch (error) { diagnostics?.record('placement', error); const details=errorDetails(error); reply(error.status || 409, { error: error.message, code: error.code || 'host_error', line: error.nativeLine, frames: details.frames, errorType: details.errorType }); }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
module.exports = { createDeliveryService, startBridge, validateRequest };
