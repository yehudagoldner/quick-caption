const uxp = require('uxp');
const ppro = require('premierepro');
const { PluginClient } = require('./client.js');
const { readStoredJson } = require('./storage-json.js');
const { captureSelection, validateSelection, isolatedSelection, restoreTimelineSrt } = require('./selection.js');
const { baseUrl, version } = require('./config.js');
const { TimelineBridge } = require('./bridge.js');
const { LIMITS, normalizeSettings, transcriptionFields } = require('./transcription-settings.js');
const languageLabels = require('./language-labels.json');
const { captionPlacementInfo, savedPlacementInfo } = require('./caption-placement.js');
const { placeGraphics } = require('./graphics-placement.js');
const { retainReferenceAudio, referenceAudioExists } = require('./reference-audio.js');
const { estimateCreditsFromRules } = require('./credit-estimate.js');
let bridgeConfiguration = null;
try { bridgeConfiguration = require('./bridge-config.json'); } catch { /* QA installer pairs both local components. */ }
const bridge = new TimelineBridge({ configuration: bridgeConfiguration });
const fs = uxp.storage.localFileSystem;
const client = new PluginClient({ baseUrl, version, storage: uxp.storage.secureStorage });
// Both panels share one document; retain references while their roots are detached.
const ui = new Map(Array.from(document.querySelectorAll('[id]'), node => [node.id, node]));
const $ = id => ui.get(id);
const mainPanel = $('plugin-main'), toolbarPanel = $('quick-caption-toolbar');
mainPanel.remove(); toolbarPanel.remove();
const visiblePanels = new Set();
let account = null, file = null, quote = null, busy = false, linkEpoch = 0, timer = null, shown = true;
let accountPending = null;
let uploading = false;
let hasPending = false;
let canAddReference = false;
let selectionContext = null;
let ready = null;
let booting = true, linking = false, preparing = false, watching = false;
let bridgeBlocked = false;
let selectionPending = null, selectionTimer = null, selectionError = '', numericDraftValid = true;
let settings = normalizeSettings(), settingsRestored = false;
let settingsSaving = Promise.resolve();
const additionalCheckboxes = [];
const settingsKey = () => JSON.stringify(settings);
const languageLabel = code => languageLabels[code] || code;
function availableLanguages() {
  const codes = account?.policy.languages || settings.languages;
  return [...codes.slice(0, 4), ...codes.slice(4).sort((a, b) => languageLabel(a).localeCompare(languageLabel(b)))];
}
function renderAdditionalLanguages() {
  $('additional-options').textContent = ''; additionalCheckboxes.length = 0;
  const search = String($('language-search').value || '').trim().toLowerCase();
  availableLanguages().filter(code => code !== settings.languages[0] && (languageLabel(code).toLowerCase().includes(search) || code.includes(search))).forEach(code => {
    const checkbox = document.createElement('sp-checkbox');
    checkbox.textContent = languageLabel(code); checkbox.checked = settings.languages.includes(code);
    checkbox.disabled = busy || preparing || watching || hasPending;
    checkbox.addEventListener('change', () => {
      if (busy || preparing || watching || hasPending) return;
      settings.languages = checkbox.checked ? [...new Set([...settings.languages, code])] : settings.languages.filter(item => item !== code);
      settingsChanged(false);
    });
    additionalCheckboxes.push(checkbox); $('additional-options').appendChild(checkbox);
  });
  $('language-empty').hidden = additionalCheckboxes.length > 0;
}
function renderSettings() {
  $('active-word').checked = settings.activeWord;
  $('active-word-color').value = settings.activeWordColor;
  $('active-word-options').hidden = !settings.activeWord;
  $('active-word-help').hidden = !settings.activeWord;
  for (const mode of ['characters', 'words', 'none']) {
    $('limit-' + mode).setAttribute('variant', settings.mode === mode ? 'cta' : 'secondary');
    $('limit-' + mode).setAttribute('aria-pressed', String(settings.mode === mode));
  }
  const limits = LIMITS[settings.mode];
  $('limit-controls').hidden = !limits; $('limit-unrestricted').hidden = !!limits;
  if (limits) {
    const value = settings[settings.mode];
    $('limit-value').value = String(value); $('limit-slider').value = value;
    $('limit-slider').setAttribute('min', String(limits.min)); $('limit-slider').setAttribute('max', String(limits.max));
    $('limit-label').textContent = settings.mode === 'characters' ? 'מספר תווים' : 'מספר מילים';
    $('limit-value').setAttribute('aria-label', $('limit-label').textContent);
    $('limit-slider').setAttribute('aria-label', $('limit-label').textContent + ' בכתובית');
    $('limit-help').textContent = settings.mode === 'characters' ? 'כולל רווחים · מילים שלמות' : 'מילים לכל כתובית';
  }
  $('language').textContent = '';
  availableLanguages().forEach(code => {
    const option = document.createElement('option'); option.value = code; option.textContent = languageLabel(code); $('language').appendChild(option);
  });
  $('language').value = settings.languages[0];
  updateAdditionalLabel(); renderAdditionalLanguages();
  const modes = account?.policy.secondaryLanguageModes || ['original', 'translate', 'transliterate'];
  for (const mode of ['original', 'translate', 'transliterate']) {
    $('mode-' + mode).hidden = !modes.includes(mode);
    $('mode-' + mode).setAttribute('variant', settings.secondaryLanguageMode === mode ? 'cta' : 'secondary');
    $('mode-' + mode).setAttribute('aria-pressed', String(settings.secondaryLanguageMode === mode));
  }
  $('mode-help').textContent = ({ original: 'כל שפה מוצגת בכתב המקורי שלה.', translate: 'השפות הלא ראשיות מתורגמות לעברית; השפה הראשית נשמרת.', transliterate: 'לפי ההגייה: Good morning ← גוד מורנינג.' })[settings.secondaryLanguageMode];
}
function updateAdditionalLabel() {
  const extra = settings.languages.slice(1);
  $('additional-toggle').textContent = extra.length === 1 ? 'שפה נוספת: ' + languageLabel(extra[0]) : extra.length ? `${extra.length} שפות נוספות בסרטון` : 'שפות נוספות בסרטון';
}
function settingsChanged(render = true) {
  numericDraftValid = true;
  invalidateQuote(); updateAdditionalLabel();
  if (render) renderSettings();
  const saved = JSON.stringify(settings);
  settingsSaving = settingsSaving.then(() => uxp.storage.secureStorage.setItem('transcription-settings', saved)).catch(() => message('ההגדרות תקפות להפעלה זו, אך לא נשמרו להפעלה הבאה.', true));
}
function setLimit(value, commit = false) {
  const limits = LIMITS[settings.mode]; if (!limits || busy || preparing || watching || hasPending) return;
  const next = Number(value);
  // An empty or partial numeric draft must not silently authorize the old setting.
  if (String(value).trim() === '' || !Number.isFinite(next)) { numericDraftValid = false; invalidateQuote(); if (commit) { numericDraftValid = true; renderSettings(); invalidateQuote(); } return; }
  if (!Number.isInteger(next) || next < limits.min || next > limits.max) {
    numericDraftValid = false; invalidateQuote(); if (!commit) return;
  }
  settings[settings.mode] = Math.max(limits.min, Math.min(limits.max, Math.round(next)));
  settingsChanged();
}
const message = (text, error = false) => {
  $('status').textContent = text; $('status').hidden = !text;
  $('status').className = error ? 'notice error' : 'notice';
};
const progress = (text, complete = false) => {
  $('progress').textContent = text; $('progress-section').hidden = !text;
  $('progress-bar').hidden = !text || complete;
  $('progress-title').textContent = complete ? 'הכתוביות בטיימליין' : 'מכין את הכתוביות';
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const chargedLabel = result => Number.isFinite(result.creditsUsed) ? `חויבו ${result.creditsUsed} קרדיטים.` : 'יתרת החשבון עודכנה.';
function placementMessage(info, result) {
  progress(`${info.cueCount} כתוביות נוספו לערוץ ${info.label} בטיימליין. ${chargedLabel(result)}`, true);
  if (info.kind === 'graphics') { message(`הכתוביות עם ההדגשות נמצאות בערוץ ${info.label}, בסיקוונס ${info.sequenceName}. לחצו פעמיים על כתובית כדי לפתוח את ציר הזמן הפנימי ולתקן תזמונים.`); return; }
  message(`הכתוביות נמצאות בערוץ ${info.label}, בסיקוונס ${info.sequenceName}. אם הערוץ אינו גלוי, גללו מעלה באזור ערוצי הכתוביות בטיימליין.`);
}
const selectionKey = snapshot => JSON.stringify(snapshot);
function invalidateQuote() {
  quote = null;
  if (account && selectionContext && numericDraftValid) {
    try { quote = { estimatedCredits: estimateCreditsFromRules(Math.ceil(selectionContext.duration), account.policy.creditEstimate), policyVersion: account.policy.version, settingsKey: settingsKey(), selectionKey: selectionKey(selectionContext) }; }
    catch { selectionError = 'נדרש עדכון של כללי המחיר מהשרת לפני תמלול'; }
  }
  $('price').textContent = quote ? `${quote.estimatedCredits} קרדיטים` : '—';
  $('price-detail').textContent = quote ? 'הערכה לפי הבחירה וכללי החשבון העדכניים.' : 'סמנו קטעים עם האודיו שלהם בטיימליין.';
  controls();
}
async function refreshSelection() {
  if (selectionPending || busy || preparing || uploading || watching || hasPending || booting) return selectionPending;
  selectionPending = (async () => {
    try {
      const snapshot = await captureSelection(ppro);
      if (busy || preparing || uploading || watching || hasPending) return;
      selectionContext = snapshot; selectionError = '';
      $('selection-summary').textContent = `${snapshot.sequenceName} · ${Math.ceil(snapshot.duration)} שניות`;
    } catch (error) {
      if (busy || preparing || uploading || watching || hasPending) return;
      selectionContext = null; selectionError = error.message;
      $('selection-summary').textContent = 'סמנו את הקטעים הרצויים בטיימליין';
    }
    invalidateQuote();
  })().finally(() => { selectionPending = null; });
  return selectionPending;
}
function disable(id, disabled) {
  $(id).disabled = disabled;
  if (disabled) $(id).setAttribute('disabled', ''); else $(id).removeAttribute('disabled');
}
function controls() {
  const connected = !!client.session;
  const active = busy || preparing || uploading || watching;
  $('login-section').hidden = booting || connected || linking;
  $('link-section').hidden = !linking;
  $('account-menu').hidden = !connected;
  if (!connected) $('account-settings').hidden = true;
  disable('selected', active || booting || (!hasPending && (!account || !quote || account.credits < quote.estimatedCredits)));
  disable('toolbar-caption', busy || preparing || uploading || watching || booting);
  $('toolbar-caption').setAttribute('title', hasPending ? 'פתיחת התמלול הפעיל או הכתוביות המוכנות' : 'קבלת כתוביות לקטעים שנבחרו');
  $('selected').hidden = active;
  $('selection-section').hidden = active || hasPending;
  $('selected').textContent = hasPending ? 'נסיון חוזר · ללא חיוב נוסף' : quote ? `יצירת כתוביות · כ־${quote.estimatedCredits} קרדיטים` : 'יצירת כתוביות לבחירה';
  $('selection-state').textContent = bridgeBlocked ? 'נדרשת הפעלה' : selectionContext ? 'מוכנים להתחיל' : 'ממתין לבחירה';
  $('intro').hidden = active || hasPending;
  $('file').textContent = selectionError || 'רק הקטעים המסומנים יישלחו. הכתוביות יוצבו אוטומטית.';
  $('footer-note').hidden = active || hasPending;
  disable('connect', busy || connected);
  disable('logout', busy || uploading || !connected);
  disable('refresh', busy || !connected);
  $('quote-section').hidden = !quote || active || hasPending;
  $('buy').hidden = !quote || (account && account.credits >= quote.estimatedCredits);
  const settingsLocked = busy || preparing || uploading || watching || hasPending || booting;
  $('transcription-settings').hidden = active || hasPending;
  for (const id of ['language', 'additional-toggle', 'language-search', 'limit-value', 'limit-slider', 'limit-characters', 'limit-words', 'limit-none', 'mode-original', 'mode-translate', 'mode-transliterate', 'active-word', 'active-word-color']) disable(id, settingsLocked);
  additionalCheckboxes.forEach(checkbox => { checkbox.disabled = settingsLocked; });
  $('add-reference-audio').hidden = !canAddReference || !connected;
  disable('add-reference-audio', busy || preparing || uploading || watching || booting || !connected);
}
function compatible(policy) {
  const parts = value => value.split('.').map(Number);
  const a = parts(version), b = parts(policy.minPluginVersion);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i] && policy.protocolVersion === 1; }
  return policy.protocolVersion === 1;
}
async function updateAccount() {
  if (accountPending) return accountPending;
  if (!client.session) { account = null; $('account').textContent = 'החשבון לא מחובר'; $('balance').textContent = '—'; controls(); return; }
  accountPending = (async () => {
    try {
      const next = await client.request('/api/plugin/account');
      if (!compatible(next.policy)) throw new Error('נדרש עדכון לתוסף לפני תמלול');
      if (account?.policy.version !== next.policy.version) invalidateQuote();
      account = next;
      const job = await pendingJob(); hasPending = needsResume(job);
      canAddReference = false;
      if (job?.style?.activeWord && ['delivered','placing'].includes(job.delivery?.status) && job.delivery.built && !job.delivery.built.referenceAudio) {
        try { const project = await ppro.Project.getActiveProject(); canAddReference = project?.guid.toString() === job.selection.projectId; } catch { /* Only show migration in its own project. */ }
      }
      if (booting && !hasPending && job?.delivery?.status === 'delivered') {
        // Show only the completed delivery in this project, never unrelated history.
        try { const placed = await savedPlacementInfo(ppro, job); if (placed) placementMessage(placed, job.result || {}); } catch { /* Reading UI status must not disconnect the account. */ }
      }
      $('account').textContent = '● מחובר';
      $('account-name').textContent = next.user.displayName || next.user.email || 'החשבון שלכם';
      $('balance').textContent = `${next.credits} קרדיטים`;
      const normalized = normalizeSettings(settings, next.policy);
      if (JSON.stringify(normalized) !== settingsKey()) { settings = normalized; invalidateQuote(); }
      // Balance refresh must not replace the user's in-progress numeric draft.
      if (!settingsRestored || $('language').value !== settings.languages[0] || settingsPolicyVersion !== next.policy.version) renderSettings();
      settingsRestored = true; settingsPolicyVersion = next.policy.version;
      invalidateQuote();
      clearInterval(timer);
      timer = setInterval(() => { if (shown) void updateAccount(); }, next.policy.balanceRefreshSeconds * 1000);
    } catch (error) {
      account = null; invalidateQuote();
      $('balance').textContent = 'היתרה לא זמינה'; message(error.message, true);
      $('account').textContent = client.session ? 'מחובר · ללא עדכון' : 'נדרשת התחברות מחדש';
    } finally { accountPending = null; controls(); }
  })();
  return accountPending;
}
async function connect() {
  const epoch = ++linkEpoch;
  busy = true; linking = true; controls();
  try {
    const link = await client.publicRequest('/start', {});
    $('link-code').textContent = link.userCode;
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
        message('החשבון חובר.'); await updateAccount(); break;
      }
    }
  } finally { busy = false; linking = false; $('link-code').textContent = ''; controls(); }
}
const needsResume = job => !!job && (!job.finished || (!!job.result?.videoId && job.delivery?.status !== 'delivered'));
async function captionTrackIds(sequence) {
  const ids = [];
  for (let i = 0, count = await sequence.getCaptionTrackCount(); i < count; i++) ids.push(String((await sequence.getCaptionTrack(i)).id));
  return ids;
}
async function deliverJob(job) {
  if (job.uid !== client.session?.user.uid) throw new Error('יש להתחבר לחשבון שבו נשלח התמלול הזה');
  if (!job.selection || !job.result?.videoId) throw new Error('מפת התזמון של התמלול אינה זמינה. לא ניתן להציב בבטחה את הכתוביות');
  if (job.delivery?.status === 'delivered') return;
  const { original } = await validateSelection(ppro, job.selection, { requireAudible: false });
  if (job.style?.activeWord) {
    progress('הכתוביות מוכנות. מכין את צירי הזמן של ההדגשות…');
    let built = job.delivery?.built;
    if (!built) {
      job = await ensureReferenceAudio(job);
      const data = await client.request(`/api/videos/${job.result.videoId}`);
      if (!data.video) throw new Error('נתוני הכתוביות אינם זמינים. התמלול נשמר; לא יבוצע תמלול נוסף.');
      built = await bridge.buildGraphics(ppro, job.selection, `${job.id}:${job.result.videoId}`, data.video, job.style.activeWordColor, job.referenceAudio);
      await saveJob({...job,delivery:{kind:'graphics',status:'built',built}});
    }
    const delivery = await placeGraphics(ppro,job.selection,built,job.delivery?.status==='placing'?job.delivery:null,async delivery=>saveJob({...job,delivery}));
    await saveJob({...job,delivery}); hasPending=false;
    if(file){await file.delete();file=null;selectionContext=null;invalidateQuote();}
    placementMessage({kind:'graphics',cueCount:delivery.cueCount,label:delivery.trackLabel,sequenceName:job.selection.sequenceName},job.result);
    return;
  }
  const data = await client.request(`/api/plugin/videos/${job.result.videoId}/subtitles`);
  const srt = restoreTimelineSrt(data.srt, job.selection.ranges);
  const beforeTracks = job.delivery?.beforeTracks || await captionTrackIds(original);
  const placing = { ...job, delivery: { status: 'placing', beforeTracks } };
  await saveJob(placing); hasPending = true;
  progress('הכתוביות מוכנות. מציב אותן בטיימליין המקורי…');
  await bridge.deliver(ppro, job.selection, `${job.id}:${job.result.videoId}`, srt);
  const afterTracks = await captionTrackIds(original);
  const newTracks = afterTracks.filter(id => !beforeTracks.includes(id));
  if (newTracks.length !== 1) throw new Error('לא ניתן לאשר ערוץ כתוביות יחיד. בדקו את הטיימליין; ניסיון חוזר לא ייצור ערוץ נוסף ולא יחייב שוב');
  const placed = await captionPlacementInfo(ppro, original, newTracks[0]);
  if (!placed?.cueCount) throw new Error('נוצר ערוץ אך לא נמצאו בו כתוביות. התמלול נשמר; בדקו את ההצבה ללא תמלול נוסף.');
  await saveJob({ ...placing, delivery: { status: 'delivered', trackId: newTracks[0], beforeTracks, cueCount: placed.cueCount, trackLabel: placed.label } });
  hasPending = false;
  if (file) { await file.delete(); file = null; selectionContext = null; invalidateQuote(); }
  placementMessage({ ...placed, sequenceName: job.selection.sequenceName }, job.result);
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

async function ensureReferenceAudio(job) {
  if (await referenceAudioExists(uxp, job.referenceAudio)) return job;
  await validateSelection(ppro, job.selection);
  let output, isolated;
  const reusable = file && JSON.stringify(selectionContext) === JSON.stringify(job.selection);
  try {
    if (reusable) output = file;
    else {
      progress('מכין אודיו מסונכרן לעריכת ההדגשות…');
      isolated = await isolatedSelection(ppro, job.selection);
      const preset = await audioPreset(isolated.sequence);
      if (!preset) throw new Error('נדרש preset אודיו להכנת הסאונד לעריכה. התמלול נשמר; לא יבוצע חיוב נוסף.');
      output = await (await fs.getTemporaryFolder()).createFile(`quick-caption-reference-${Date.now()}.wav`, {overwrite:false});
      if (!await ppro.EncoderManager.getManager().exportSequence(isolated.sequence, ppro.Constants.ExportType.IMMEDIATELY, output.nativePath, preset.nativePath, true)) throw new Error('ייצוא האודיו לעריכה לא התחיל');
      await waitForWave(output, account?.policy.maxMediaBytes || 512 * 1024 * 1024);
    }
    const referenceAudio = await retainReferenceAudio(uxp, output, job.id, job.selection);
    const updated = {...job, referenceAudio};
    await saveJob(updated);
    return updated;
  } finally {
    if (isolated) await isolated.cleanup();
    if (output && !reusable) await output.delete();
  }
}

async function addSoundToExistingCaptions() {
  let job = await pendingJob();
  if (!job?.style?.activeWord || !['delivered','placing'].includes(job.delivery?.status) || !job.delivery.built) throw new Error('לא נמצאו כתוביות עם מילה פעילה מהתמלול האחרון');
  if (job.delivery.built.referenceAudio) { message('האודיו כבר נמצא בתוך המשפטים. לחצו פעמיים על משפט כדי לשמוע אותו ולערוך את ההדגשות.'); return; }
  job = await ensureReferenceAudio(job);
  progress('מוסיף את הסאונד למשפטים הקיימים. ההדגשות שערכתם נשמרות…');
  const existing = {...job.delivery,built:{...job.delivery.built,binName:job.delivery.built.binName || `Quick Caption · active words · ${job.id}:${job.result.videoId}`}};
  const result = await bridge.attachReferenceAudio(ppro,job.selection,`${job.id}:${job.result.videoId}`,existing,job.referenceAudio);
  await saveJob({...job,delivery:result.delivery});
  canAddReference = false;
  hasPending = false;
  message('האודיו נוסף למשפטים הקיימים. לחצו פעמיים על משפט כדי לשמוע אותו בזמן תיקון ההדגשות.');
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
  if (busy || preparing || uploading || watching) return;
  if (hasPending) { await run(async () => { const job = await pendingJob(); if (job) await watchJob(job); }); return; }
  const approved = quote, approvedSnapshot = selectionContext;
  preparing = true;
  try {
  await run(async () => {
    if (!approved || !approvedSnapshot) throw new Error('בחרו קטעים והמתינו להערכת המחיר');
    progress('בודק את הבחירה ואת יתרת החשבון…');
    // Retry the local connection before repeating account work or audio preparation.
    if (bridgeBlocked) { await bridge.request('/health'); bridgeBlocked = false; }
    const snapshot = await captureSelection(ppro);
    if (selectionKey(snapshot) !== approved.selectionKey) {
      selectionContext = snapshot; invalidateQuote();
      throw new Error('הבחירה השתנתה. המחיר עודכן; לחצו שוב כדי לאשר את הבחירה החדשה.');
    }
    if (file) await file.delete();
    file = null; selectionContext = snapshot;
    $('plugin-main').scrollTop = 0;
    await updateAccount();
    if (!account) throw new Error('נדרש חיבור עדכני לחשבון לפני התמלול');
    if (approved.policyVersion !== account.policy.version || approved.settingsKey !== settingsKey()) throw new Error('כללי המחיר או ההגדרות השתנו. בדקו את המחיר המעודכן ולחצו שוב.');
    const previous = await client.settlePreviousJob(await pendingJob());
    if (previous) await saveJob(previous);
    if (needsResume(previous)) throw new Error('הכתוביות מהתמלול הקודם מוכנות להצבה. השלימו את ההצבה לפני תמלול נוסף');
    // The server verifies the displayed local estimate and issues the job identity.
    // This is part of the same click; no export or paid request on a mismatch.
    // Fail before export/paid processing if the automatic placement component is unavailable.
    await preparePlacement(snapshot);
    bridgeBlocked = false;
    const admitted = await getQuote(approved);
    const project = await ppro.Project.getActiveProject();
    const original = project && (await project.getSequences()).find(sequence => sequence.guid.toString() === snapshot.sequenceId);
    if (!original || project.guid.toString() !== snapshot.projectId) throw new Error('הפרויקט השתנה. בחרו שוב את הקטעים');
    const preset = await audioPreset(original); if (!preset) return;
    const folder = await fs.getTemporaryFolder();
    const output = await folder.createFile(`quick-caption-selection-${Date.now()}.wav`, { overwrite: false });
    let isolated = null;
    try {
      isolated = await isolatedSelection(ppro, snapshot);
      progress('מכין אודיו מהקטעים שסימנתם…');
      const accepted = await ppro.EncoderManager.getManager().exportSequence(isolated.sequence, ppro.Constants.ExportType.IMMEDIATELY, output.nativePath, preset.nativePath, true);
      if (!accepted) throw new Error('פרימייר לא התחיל את הייצוא. לא בוצע חיוב');
      await waitForWave(output, account.policy.maxMediaBytes);
      file = output; selectionContext = snapshot;
    } finally {
      if (isolated) await isolated.cleanup();
      if (file !== output) await output.delete();
    }
    await send(admitted);
  });
  } finally {
    preparing = false;
    controls();
  }
}
async function getQuote(approved) {
  if (!selectionContext || !account || !approved) throw new Error('נדרשת בחירה עם הערכת מחיר עדכנית');
  const previous = await client.settlePreviousJob(await pendingJob());
  if (previous) await saveJob(previous);
  if (needsResume(previous)) throw new Error('השלימו את הצבת הכתוביות המוכנות לפני תמלול נוסף');
  const next = await client.json('/api/plugin/quote', { durationSeconds: Math.ceil(selectionContext.duration) });
  if (approved.settingsKey !== settingsKey() || approved.selectionKey !== selectionKey(selectionContext) || next.policyVersion !== approved.policyVersion || next.estimatedCredits !== approved.estimatedCredits) {
    await updateAccount(); throw new Error('המחיר השתנה. בדקו את ההערכה המעודכנת ולחצו שוב.');
  }
  if (!next.canStart || account.credits < next.estimatedCredits) throw new Error('אין מספיק קרדיטים לבחירה. קצרו אותה או הוסיפו קרדיטים.');
  return { ...next, settingsKey: approved.settingsKey, selectionKey: approved.selectionKey };
}
async function pendingJob() {
  if (!client.session) return null;
  try { return readStoredJson(await uxp.storage.secureStorage.getItem(`pending-job:${client.session.user.uid}`)); }
  catch { return null; }
}
async function saveJob(job) { await uxp.storage.secureStorage.setItem(`pending-job:${job.uid}`, JSON.stringify(job)); }
async function watchJob(job, allowMissing = false) {
  if (job.uid !== client.session?.user.uid) throw new Error('יש להתחבר לחשבון שבו נשלח התמלול הזה');
  watching = true; controls();
  try {
  if (job.finished && job.result?.videoId) { await deliverJob(job); return; }
  const deadline = Date.now() + 20 * 60000;
  let missing = 0;
  while (Date.now() < deadline) {
    let state;
    try { state = await client.request(`/api/transcribe/jobs/${job.id}`); }
    catch (error) {
      if (allowMissing && error.status === 404 && missing++ < 30) { await sleep(3000); continue; }
      throw error;
    }
    const stage = state.stages?.at(-1);
    progress(stage?.detail || stage?.message || 'מתמלל את הקטעים שסימנתם…');
    if (state.status === 'failed') {
      await saveJob({ ...job, finished: true });
      await updateAccount(); throw new Error(state.error || 'התמלול נכשל');
    }
    if (state.status === 'completed') {
      if (!state.result?.videoId) throw new Error('התמלול הושלם אך מזהה הכתוביות אינו זמין. בדקו את אותה משימה שוב ללא חיוב נוסף');
      const completed = { ...job, finished: true, result: state.result, delivery: job.delivery || { status: 'pending' } };
      await saveJob(completed);
      if (job.selection && state.result.videoId) await uxp.storage.secureStorage.setItem(`timeline:${job.uid}:${state.result.videoId}`, JSON.stringify(job.selection));
      progress(`הכתוביות מוכנות. ${chargedLabel(state.result)}`);
      await updateAccount();
      await deliverJob(completed);
      return;
    }
    await sleep(3000);
  }
  message('התמלול ממשיך בשרת. אפשר לבדוק את אותה משימה שוב ללא שליחה או חיוב נוסף.');
  } finally { watching = false; controls(); }
}
async function send(approved) {
  await updateAccount();
  if (!account || !approved || approved.settingsKey !== settingsKey() || approved.selectionKey !== selectionKey(selectionContext) || approved.policyVersion !== account.policy.version || Date.parse(approved.expiresAt) <= Date.now()) {
    invalidateQuote(); throw new Error('המחיר או החיבור השתנו. בדקו מחיר ואשרו שוב.');
  }
  if (!approved.canStart || account.credits < approved.estimatedCredits) throw new Error('היתרה נמוכה מההערכה. בחרו קטעים קצרים יותר או רכשו קרדיטים');
  if ((await file.getMetadata()).size > account.policy.maxMediaBytes) throw new Error('הקובץ חורג מהגודל המותר לפי הכללים העדכניים');
  await validateSelection(ppro, selectionContext);
  await preparePlacement(selectionContext);
  const fields = transcriptionFields(settings, account.policy);
  const form = new FormData();
  form.append('media', file, file.name);
  form.append('jobId', approved.jobId); form.append('format', '.srt');
  form.append('billingPolicyVersion', approved.policyVersion);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const job = { id: approved.jobId, uid: account.user.uid, selection: selectionContext, style: {activeWord:settings.activeWord,activeWordColor:settings.activeWordColor} };
  if (settings.activeWord) job.referenceAudio = await retainReferenceAudio(uxp, file, job.id, job.selection);
  await saveJob(job);
  hasPending = true; invalidateQuote();
  progress('מעלה את האודיו ומתחיל תמלול…');
  // Never repeat a paid POST automatically, including after a timeout or a 401.
  let submissionError = null;
  uploading = true;
  const submission = client.request('/api/transcribe', { method: 'POST', body: form }, false).catch(async error => {
    submissionError = error;
    // A definite admission rejection can be retried after a new quote. A lost
    // response or server error stays unresolved until this job is recovered.
    if ([400, 401, 403, 409, 413, 415, 426].includes(error.status)) {
      const current = await pendingJob();
      if (current?.id === job.id && !current.finished) { await saveJob({ ...job, finished: true }); hasPending = false; }
    }
  }).finally(() => { uploading = false; controls(); });
  await sleep(3000);
  try { await watchJob(job, true); }
  catch (error) { $('progress-bar').hidden = true; message(submissionError?.message || `${error.message}. נסיון חוזר ישלים את אותה משימה ללא חיוב נוסף.`, true); }
  // Attach a handler now; do not wait indefinitely for the upload response to close.
  void submission.catch(error => message(error.message));
}
async function run(action) {
  if (busy) return;
  busy = true; controls(); message('');
  try { await action(); } catch (error) {
    if (['bridge_unavailable', 'bridge_permissions'].includes(error.code)) bridgeBlocked = true;
    message(error.message || 'הפעולה נכשלה', true);
    $('progress-bar').hidden = true;
  }
  finally { busy = false; controls(); }
}
async function preparePlacement(snapshot) { return settings.activeWord ? bridge.prepareGraphics(ppro,snapshot) : bridge.prepare(ppro,snapshot); }
$('active-word').addEventListener('change',()=>{
  if(busy||preparing||uploading||watching||hasPending||booting)return;
  settings.activeWord=Boolean($('active-word').checked);settingsChanged();
});
$('active-word-color').addEventListener('change',()=>{
  if(busy||preparing||uploading||watching||hasPending||booting)return;
  settings.activeWordColor=$('active-word-color').value;settingsChanged();
});
$('connect').addEventListener('click', () => { if (!busy) void connect().catch(error => message(error.message, true)); });
$('account-menu').addEventListener('click', () => { $('account-settings').hidden = !$('account-settings').hidden; });
$('selected').addEventListener('click', () => void captionSelection());
$('toolbar-caption').addEventListener('click', () => void openTimelineAction().catch(error => message(error.message, true)));
$('cancel-link').addEventListener('click', () => { linkEpoch++; message('החיבור בוטל.'); });
$('logout').addEventListener('click', () => run(async () => {
  // Keep credentials if server revocation fails so the user can retry safely.
  await client.json('/api/plugin/logout', {}); await client.clear(); account = null;
  hasPending = false; invalidateQuote(); await updateAccount();
}));
$('refresh').addEventListener('click', () => run(updateAccount));
$('buy').addEventListener('click', () => run(() => uxp.shell.openExternal(`${baseUrl}/?screen=buy-credits`, 'רכישת קרדיטים בחשבון Quick Caption')));
$('language').addEventListener('change', () => {
  if (busy || preparing || watching || hasPending) return;
  settings.languages = [$('language').value, ...settings.languages.slice(1).filter(code => code !== $('language').value)];
  settingsChanged();
});
for (const mode of ['characters', 'words', 'none']) $('limit-' + mode).addEventListener('click', () => {
  if (busy || preparing || watching || hasPending) return;
  settings.mode = mode; settingsChanged();
});
for (const mode of ['original', 'translate', 'transliterate']) $('mode-' + mode).addEventListener('click', () => {
  if (busy || preparing || watching || hasPending) return;
  settings.secondaryLanguageMode = mode; settingsChanged();
});
$('limit-value').addEventListener('input', () => setLimit($('limit-value').value));
$('limit-value').addEventListener('change', () => setLimit($('limit-value').value, true));
$('limit-value').addEventListener('blur', () => setLimit($('limit-value').value, true));
$('limit-slider').addEventListener('input', () => setLimit($('limit-slider').value, true));
$('limit-slider').addEventListener('change', () => setLimit($('limit-slider').value, true));
$('additional-toggle').addEventListener('click', () => {
  $('additional-picker').hidden = !$('additional-picker').hidden;
  $('additional-toggle').setAttribute('aria-expanded', String(!$('additional-picker').hidden));
});
$('language-search').addEventListener('input', renderAdditionalLanguages);
$('add-reference-audio').addEventListener('click', () => run(addSoundToExistingCaptions));
async function openTimelineAction() {
  if (busy || preparing || uploading || watching || booting) return;
  const plugin = Array.from(uxp.pluginManager.plugins).find(item => item.id === 'com.quickcaption.premiere.qa');
  if (!plugin) throw new Error('לא ניתן לפתוח את חלון הכתוביות');
  // Premiere 25.6 does not reliably deliver hide(); always bring the existing
  // entrypoint forward so a background/closed tab cannot become unreachable.
  await plugin.showPanel('quickCaption');
  // A completed or running job must be resumed, never replaced by a new quote.
  if (hasPending) { mainPanel.scrollTop = 0; return; }
  await refreshSelection();
}
function showPanel(id, body, content) {
  body.appendChild(content); visiblePanels.add(id); shown = true; void updateAccount();
  if (id === 'quickCaption') void refreshSelection();
}
function hidePanel(id) { visiblePanels.delete(id); shown = visiblePanels.size > 0; }
uxp.entrypoints.setup({
  plugin: { create() {}, destroy() { shown = false; linkEpoch++; clearInterval(timer); clearInterval(selectionTimer); } },
  commands: { captionSelection() { void openTimelineAction().catch(error => message(error.message, true)); } },
  panels: {
    quickCaption: { show(body) { showPanel('quickCaption', body, mainPanel); }, hide() { hidePanel('quickCaption'); }, destroy() { hidePanel('quickCaption'); } },
    quickCaptionToolbar: { show(body) { showPanel('quickCaptionToolbar', body, toolbarPanel); }, hide() { hidePanel('quickCaptionToolbar'); }, destroy() { hidePanel('quickCaptionToolbar'); } },
  },
});
let settingsPolicyVersion = null;
ready = (async () => {
  await client.restore();
  try { settings = { ...settings, ...readStoredJson(await uxp.storage.secureStorage.getItem('transcription-settings')) }; } catch { /* First use. */ }
  await updateAccount();
  if (!account) { settings = normalizeSettings(settings, { languages: Object.keys(languageLabels) }); renderSettings(); }
})().catch(error => message(error.message, true)).finally(async () => {
  booting = false; controls(); await refreshSelection();
  selectionTimer = setInterval(() => { if (shown) void refreshSelection(); }, 1000);
});
