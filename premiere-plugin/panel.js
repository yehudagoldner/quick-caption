const uxp = require('uxp');
const ppro = require('premierepro');
const { PluginClient } = require('./client.js');
const { readStoredJson } = require('./storage-json.js');
const { captureSelection, validateSelection, isolatedSelection, restoreTimelineSrt } = require('./selection.js');
const { baseUrl, version } = require('./config.js');
const fs = uxp.storage.localFileSystem;
const client = new PluginClient({ baseUrl, version, storage: uxp.storage.secureStorage });
const $ = id => document.getElementById(id);
let account = null, file = null, quote = null, busy = false, linkEpoch = 0, offset = 0, timer = null, shown = true;
let accountPending = null;
let uploading = false;
let hasPending = false;
let selectionContext = null;
let ready = null;
const message = text => { $('status').textContent = text; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function invalidateQuote() { quote = null; $('send').disabled = true; $('price').textContent = 'יש לבדוק מחיר לפני השליחה. החיוב הסופי לפי עלות העיבוד בפועל.'; }
function controls() {
  $('selected').disabled = busy || uploading;
  $('connect').disabled = busy || !!client.session;
  $('logout').disabled = busy || uploading || !client.session;
  $('refresh').disabled = busy || !client.session;
  $('quote').disabled = busy || uploading || !account || !file;
  $('send').disabled = busy || uploading || !quote?.canStart || !account || account.credits < quote.estimatedCredits;
  $('language').disabled = busy;
  $('resume').disabled = busy || !hasPending || !client.session;
}
function compatible(policy) {
  const parts = value => value.split('.').map(Number);
  const a = parts(version), b = parts(policy.minPluginVersion);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i] && policy.protocolVersion === 1; }
  return policy.protocolVersion === 1;
}
async function updateAccount() {
  if (accountPending) return accountPending;
  if (!client.session) { account = null; $('account').textContent = 'החשבון אינו מחובר'; $('balance').textContent = 'יתרה: —'; controls(); return; }
  accountPending = (async () => {
    try {
      const next = await client.request('/api/plugin/account');
      if (!compatible(next.policy)) throw new Error('נדרש עדכון לתוסף לפני תמלול');
      if (account?.policy.version !== next.policy.version) invalidateQuote();
      account = next;
      hasPending = !!(await pendingJob());
      $('account').textContent = next.user.displayName || next.user.email || 'חשבון מחובר';
      $('balance').textContent = `${next.credits} קרדיטים · עודכן ${new Date().toLocaleTimeString()}`;
      const language = $('language').value;
      $('language').textContent = '';
      next.policy.languages.forEach(code => {
        const option = document.createElement('option'); option.value = code;
        option.textContent = ({ he: 'עברית', en: 'English', ar: 'العربية', ru: 'Русский' })[code] || code;
        $('language').appendChild(option);
      });
      $('language').value = next.policy.languages.includes(language) ? language : next.policy.defaults.languages[0];
      clearInterval(timer);
      timer = setInterval(() => { if (shown) void updateAccount(); }, next.policy.balanceRefreshSeconds * 1000);
    } catch (error) {
      account = null; invalidateQuote();
      $('balance').textContent = 'היתרה אינה זמינה — יש לרענן את החיבור'; message(error.message);
      if (!client.session) $('account').textContent = 'נדרשת התחברות מחדש';
    } finally { accountPending = null; controls(); }
  })();
  return accountPending;
}
async function connect() {
  const epoch = ++linkEpoch;
  busy = true; controls();
  try {
    const link = await client.publicRequest('/start', {});
    $('link-code').textContent = link.userCode; $('cancel-link').hidden = false;
    message('אשרו בדפדפן את החשבון ואת התאמת הקוד.');
    await uxp.shell.openExternal(`${baseUrl}/?screen=plugin-connect&id=${link.id}&code=${link.userCode}`, 'חיבור החשבון הקיים ל-Quick Caption בפרימייר');
    const deadline = Date.now() + link.expiresIn * 1000;
    while (epoch === linkEpoch && Date.now() < deadline) {
      await sleep(link.pollIntervalSeconds * 1000);
      if (epoch !== linkEpoch) break;
      const result = await client.publicRequest('/poll', { id: link.id, deviceSecret: link.deviceSecret });
      if (result.status === 'approved') {
        // Cancellation after issuance must revoke the granted session, not leave it active.
        await client.accept(result);
        if (epoch !== linkEpoch) { await client.json('/api/plugin/logout', {}); await client.clear(); break; }
        message('החשבון חובר.'); await updateAccount(); await loadVideos(); break;
      }
    }
  } finally { busy = false; $('link-code').textContent = ''; $('cancel-link').hidden = true; controls(); }
}
async function importFile(entry) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error('פתחו פרויקט בפרימייר לפני ייבוא כתוביות');
  const bin = await project.getInsertionBin();
  if (!await project.importFiles([entry.nativePath], true, bin, false)) throw new Error('פרימייר לא הצליח לייבא את הקובץ');
  message('הכתוביות יובאו לפרויקט. גררו את קובץ ה-SRT לטיימליין.');
}
async function importVideo(id) {
  const data = await client.request(`/api/plugin/videos/${id}/subtitles`);
  let mapping = null;
  try { mapping = readStoredJson(await uxp.storage.secureStorage.getItem(`timeline:${client.session.user.uid}:${id}`)); } catch { /* Regular website video. */ }
  if (mapping) {
    const project = await ppro.Project.getActiveProject();
    const sequence = project && await project.getActiveSequence();
    if (!sequence || project.guid.toString() !== mapping.projectId || sequence.guid.toString() !== mapping.sequenceId) {
      throw new Error(`חזרו לסיקוונס ${mapping.sequenceName} בפרויקט המקורי כדי לייבא את הכתוביות בתזמון הנכון`);
    }
    await validateSelection(ppro, mapping);
  }
  const entry = await fs.getFileForSaving(data.filename, { types: ['srt'] });
  if (!entry) return;
  await entry.write(mapping ? restoreTimelineSrt(data.srt, mapping.ranges) : data.srt);
  await importFile(entry);
}
async function loadVideos(more = false) {
  if (!more) { offset = 0; $('videos').textContent = ''; }
  const data = await client.request(`/api/videos?limit=20&offset=${offset}`);
  for (const video of data.videos) {
    const row = document.createElement('div'); row.className = 'video';
    const name = document.createElement('p'); name.textContent = video.original_filename; row.appendChild(name);
    if (video.has_subtitles || video.status === 'completed') {
      const button = document.createElement('button'); button.textContent = 'ייבוא הכתוביות העדכניות';
      button.addEventListener('click', () => run(() => importVideo(video.id))); row.appendChild(button);
    }
    $('videos').appendChild(row);
  }
  offset += data.videos.length; $('more').hidden = !data.hasMore;
  if (!offset) $('videos').textContent = 'עדיין אין סרטונים בחשבון.';
}
async function audioPreset(sequence) {
  let preset = null;
  try { preset = await fs.getEntryForPersistentToken(readStoredJson(await uxp.storage.secureStorage.getItem('audio-preset'))); } catch { /* First use or revoked file permission. */ }
  if (!preset) {
    message('בהפעלה הראשונה בחרו preset של Waveform Audio מסוג EPR. הבחירה תישמר לפעמים הבאות.');
    preset = await fs.getFileForOpening({ types: ['epr'] });
  }
  if (!preset) return null;
  const extension = (await ppro.EncoderManager.getExportFileExtension(sequence, preset.nativePath)).replace(/^\./, '').toLowerCase();
  if (extension !== 'wav') throw new Error('בחרו preset מסוג Waveform Audio (WAV) לייצוא האודיו של הקטעים שנבחרו');
  await uxp.storage.secureStorage.setItem('audio-preset', JSON.stringify(await fs.createPersistentToken(preset)));
  return preset;
}

async function waitForWave(entry, maxMediaBytes) {
  const deadline = Date.now() + 20 * 60000;
  let previous = 0, stable = 0;
  while (Date.now() < deadline) {
    await sleep(1000);
    const { size } = await entry.getMetadata();
    if (size > maxMediaBytes) throw new Error('האודיו המיוצא חורג מהגודל המותר');
    stable = size > 44 && size === previous ? stable + 1 : 0; previous = size;
    if (stable < 2) continue;
    const bytes = new Uint8Array(await entry.read({ format: uxp.storage.formats.binary }));
    const tag = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
    // WAV's declared complete size must match the file before any upload.
    if (tag(0) === 'RIFF' && tag(8) === 'WAVE' && new DataView(bytes.buffer).getUint32(4, true) + 8 === size) return;
    if (stable > 10) throw new Error('הייצוא אינו קובץ WAV שלם. בדקו את הגדרות הייצוא ונסו שוב');
  }
  throw new Error('הייצוא טרם הושלם. לא נשלח קובץ ולא בוצע חיוב');
}

async function captionSelection() {
  if (ready) await ready;
  if (busy || uploading) return;
  await run(async () => {
    // Freeze the selected clips before leaving Premiere to authenticate.
    const snapshot = await captureSelection(ppro);
    if (file) await file.delete();
    file = null; selectionContext = null; invalidateQuote();
    $('file').textContent = 'מכין אודיו מהבחירה בטיימליין…';
    $('selection-summary').textContent = `הבחירה ב־${snapshot.sequenceName} · ${Math.ceil(snapshot.duration)} שניות. הרווחים בין הבחירות לא יתומללו.`;
    $('plugin-main').scrollTop = 0;
    await updateAccount();
    if (!client.session) {
      await connect();
      busy = true; controls();
      if (!client.session) throw new Error('החיבור לא הושלם. הקטעים לא נשלחו לתמלול');
    }
    await updateAccount();
    if (!account) throw new Error('נדרש חיבור עדכני לחשבון לפני התמלול');
    await client.settlePreviousJob(await pendingJob());
    const project = await ppro.Project.getActiveProject();
    const original = project && (await project.getSequences()).find(sequence => sequence.guid.toString() === snapshot.sequenceId);
    if (!original || project.guid.toString() !== snapshot.projectId) throw new Error('הפרויקט השתנה. בחרו שוב את הקטעים');
    const preset = await audioPreset(original); if (!preset) return;
    const folder = await fs.getTemporaryFolder();
    const output = await folder.createFile(`quick-caption-selection-${Date.now()}.wav`, { overwrite: false });
    let isolated = null;
    try {
      isolated = await isolatedSelection(ppro, snapshot);
      message('מייצא רק את הקטעים שנבחרו. התמלול יתחיל לאחר הצגת מחיר ואישור.');
      const accepted = await ppro.EncoderManager.getManager().exportSequence(isolated.sequence, ppro.Constants.ExportType.IMMEDIATELY, output.nativePath, preset.nativePath, true);
      if (!accepted) throw new Error('פרימייר לא התחיל את הייצוא. לא בוצע חיוב');
      await waitForWave(output, account.policy.maxMediaBytes);
      file = output; selectionContext = snapshot;
      $('file').textContent = `האודיו מהקטעים שנבחרו ב־${snapshot.sequenceName}`;
      invalidateQuote(); await getQuote();
      message(quote.canStart ? 'הקטעים מוכנים. בדקו את המחיר ולחצו אישור ושליחה לתמלול.' : 'הקטעים מוכנים, אך היתרה נמוכה מההערכה. אפשר לבחור קטעים קצרים יותר או לרכוש קרדיטים.');
      $('plugin-main').scrollTop = 0;
    } finally {
      if (isolated) await isolated.cleanup();
      if (file !== output) await output.delete();
    }
  });
}
async function getQuote() {
  if (!file || !selectionContext) throw new Error('בחרו קטעים בטיימליין והפעילו קבלת כתוביות');
  await updateAccount();
  if (!account) throw new Error('לא ניתן לבדוק מחיר ללא חיבור עדכני');
  const previous = await client.settlePreviousJob(await pendingJob());
  if (previous) await saveJob(previous);
  const metadata = await file.getMetadata();
  if (metadata.size > account.policy.maxMediaBytes) throw new Error('הקובץ חורג מהגודל המותר לפי הכללים העדכניים');
  const next = await client.json('/api/plugin/quote', { durationSeconds: Math.ceil(selectionContext.duration) });
  quote = next;
  $('price').textContent = `הערכה: ${next.estimatedCredits} קרדיטים. יתרה: ${next.credits}. החיוב הסופי לפי עלות העיבוד בפועל.${next.canStart ? '' : ' אין מספיק קרדיטים להערכה הזאת.'}`;
  controls();
}
async function pendingJob() {
  if (!client.session) return null;
  try { return readStoredJson(await uxp.storage.secureStorage.getItem(`pending-job:${client.session.user.uid}`)); }
  catch { return null; }
}
async function saveJob(job) { await uxp.storage.secureStorage.setItem(`pending-job:${job.uid}`, JSON.stringify(job)); }
async function watchJob(job, allowMissing = false) {
  if (job.uid !== client.session?.user.uid) throw new Error('יש להתחבר לחשבון שבו נשלח התמלול הזה');
  const deadline = Date.now() + 20 * 60000;
  let missing = 0;
  while (Date.now() < deadline) {
    let state;
    try { state = await client.request(`/api/transcribe/jobs/${job.id}`); }
    catch (error) {
      if (allowMissing && error.status === 404 && missing++ < 30) { await sleep(3000); continue; }
      throw error;
    }
    $('progress').textContent = state.stages?.map(stage => stage.detail || stage.message || stage.stage).filter(Boolean).join(' · ') || 'התמלול מתבצע…';
    if (state.status === 'failed') {
      await saveJob({ ...job, finished: true });
      await updateAccount(); throw new Error(state.error || 'התמלול נכשל');
    }
    if (state.status === 'completed') {
      await saveJob({ ...job, finished: true });
      if (job.selection && state.result.videoId) await uxp.storage.secureStorage.setItem(`timeline:${job.uid}:${state.result.videoId}`, JSON.stringify(job.selection));
      $('progress').textContent = `התמלול הסתיים. חויבו ${state.result.creditsUsed ?? 0} קרדיטים.`;
      await updateAccount(); await loadVideos();
      if (state.result.videoId) await importVideo(state.result.videoId);
      return;
    }
    await sleep(3000);
  }
  message('התמלול ממשיך בשרת. אפשר לבדוק את אותה משימה שוב ללא שליחה או חיוב נוסף.');
}
async function send() {
  const approved = quote;
  await updateAccount();
  if (!account || !approved || approved.policyVersion !== account.policy.version || Date.parse(approved.expiresAt) <= Date.now()) {
    invalidateQuote(); throw new Error('המחיר או החיבור השתנו. בדקו מחיר ואשרו שוב.');
  }
  if (!approved.canStart || account.credits < approved.estimatedCredits) throw new Error('היתרה נמוכה מההערכה. בחרו קטעים קצרים יותר או רכשו קרדיטים');
  await validateSelection(ppro, selectionContext);
  const defaults = account.policy.defaults;
  const form = new FormData();
  form.append('media', file, file.name);
  form.append('jobId', approved.jobId); form.append('format', '.srt');
  form.append('billingPolicyVersion', approved.policyVersion);
  form.append('languages', JSON.stringify([$('language').value]));
  form.append('secondaryLanguageMode', defaults.secondaryLanguageMode);
  form.append('maxWordsPerSubtitle', String(defaults.maxWordsPerSubtitle));
  if (defaults.maxCharactersPerSubtitle !== null) form.append('maxCharactersPerSubtitle', String(defaults.maxCharactersPerSubtitle));
  const job = { id: approved.jobId, uid: account.user.uid, selection: selectionContext };
  await saveJob(job);
  hasPending = true; invalidateQuote();
  $('progress').textContent = 'מעלה קובץ ומתחיל תמלול…';
  // Never repeat a paid POST automatically, including after a timeout or a 401.
  let submissionError = null;
  uploading = true;
  const submission = client.request('/api/transcribe', { method: 'POST', body: form }, false).catch(async error => {
    submissionError = error;
    // A definite admission rejection can be retried after a new quote. A lost
    // response or server error stays unresolved until this job is recovered.
    if ([400, 401, 403, 409, 413, 415, 426].includes(error.status)) {
      await saveJob({ ...job, finished: true });
    }
  }).finally(() => { uploading = false; controls(); });
  await sleep(3000);
  try { await watchJob(job, true); }
  catch (error) { message(submissionError?.message || `${error.message}. בדקו את אותה משימה שוב לפני שליחה חדשה.`); }
  // Attach a handler now; do not wait indefinitely for the upload response to close.
  void submission.catch(error => message(error.message));
}
async function run(action) {
  if (busy) return;
  busy = true; controls(); message('');
  try { await action(); } catch (error) { message(error.message || 'הפעולה נכשלה'); }
  finally { busy = false; controls(); }
}
$('connect').addEventListener('click', () => { if (!busy) void connect().catch(error => message(error.message)); });
$('selected').addEventListener('click', () => void captionSelection());
$('cancel-link').addEventListener('click', () => { linkEpoch++; message('החיבור בוטל.'); });
$('logout').addEventListener('click', () => run(async () => {
  // Keep credentials if server revocation fails so the user can retry safely.
  await client.json('/api/plugin/logout', {}); await client.clear(); account = null;
  $('videos').textContent = ''; invalidateQuote(); await updateAccount();
}));
$('refresh').addEventListener('click', () => run(async () => { await updateAccount(); await loadVideos(); }));
$('buy').addEventListener('click', () => run(() => uxp.shell.openExternal(`${baseUrl}/?screen=buy-credits`, 'רכישת קרדיטים בחשבון Quick Caption')));
$('quote').addEventListener('click', () => run(getQuote));
$('send').addEventListener('click', () => run(send));
$('language').addEventListener('change', invalidateQuote);
$('more').addEventListener('click', () => run(() => loadVideos(true)));
$('resume').addEventListener('click', () => run(async () => { const job = await pendingJob(); if (job) await watchJob(job); }));
$('local-srt').addEventListener('click', () => run(async () => { const entry = await fs.getFileForOpening({ types: ['srt'] }); if (entry) await importFile(entry); }));
uxp.entrypoints.setup({ commands: { captionSelection() {
  const plugin = Array.from(uxp.pluginManager.plugins).find(item => item.id === 'com.quickcaption.premiere.qa');
  if (plugin) plugin.showPanel('quickCaption');
  void captionSelection();
} }, panels: { quickCaption: {
  show() { shown = true; void updateAccount(); }, hide() { shown = false; },
  destroy() { shown = false; linkEpoch++; clearInterval(timer); },
} } });
ready = (async () => { await client.restore(); await updateAccount(); if (client.session) await loadVideos(); $('resume').disabled = !(await pendingJob()); })().catch(error => message(error.message));
