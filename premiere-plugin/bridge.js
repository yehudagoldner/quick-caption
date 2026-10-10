const { validateSelection } = require('./selection.js');
const { normalizeCaptionTiming } = require('./caption-timing.js');
const UNAVAILABLE = 'רכיב ההצבה האוטומטית לא נטען בפרימייר. הפעילו את קובץ הגדרת הפיתוח שקיבלתם, הפעילו מחדש את פרימייר ואז נסו שוב. אין צורך בתמלול נוסף.';
const unavailable = () => Object.assign(new Error(UNAVAILABLE), { code: 'bridge_unavailable' });

class TimelineBridge {
  constructor({ configuration, fetcher = fetch }) { this.configuration = configuration; this.fetcher = fetcher; }
  async request(route, body) {
    if (!this.configuration?.token) throw unavailable();
    let response;
    let timer;
    try {
      const request = this.fetcher(`http://localhost:${this.configuration.port}${route}`, {
        method: body ? 'POST' : 'GET', headers: { 'X-Quick-Caption-Bridge': this.configuration.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const timeout = route === '/build-graphics' ? 20 * 60000 : route === '/prepare-graphics' ? 2 * 60000 : 60000;
      response = await Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('ההצבה בפרימייר נמשכת מעבר לזמן ההמתנה. התמלול נשמר; נסיון חוזר לא יתמלל או יחייב שוב.'), {code:'bridge_timeout'})), timeout); })]);
    } catch (error) {
      if (error.code === 'bridge_timeout') throw error;
      if (/Permission denied|Manifest entry not found/i.test(error.message || '')) throw Object.assign(new Error('פרימייר לא טען את הרשאות החיבור המעודכנות. טענו מחדש את התוסף בכלי הפיתוח ונסו שוב.'), { code: 'bridge_permissions' });
      throw unavailable();
    } finally { clearTimeout(timer); }
    const result = await response.json();
    const explanation = {
      delivery_uncertain: 'ייתכן שהכתוביות כבר הוצבו. בדקו את הטיימליין לפני שחזור; לא ייווצר ערוץ נוסף ולא יהיה חיוב נוסף.',
      delivery_conflict: 'התמלול השתנה אחרי ניסיון ההצבה. נדרש לבדוק את הערוץ הקיים לפני עדכון.',
      invalid_subtitles: 'לא נמצאו כתוביות תקינות להצבה בקטעים שנבחרו.',
      invalid_graphics: 'תזמון הכתוביות אינו מאפשר הצבה בטוחה. התמלול נשמר בחשבון, ללא צורך בתמלול או חיוב נוסף.',
    }[result.code];
    if (!response.ok || !result.ok) throw Object.assign(new Error(explanation || result.error || UNAVAILABLE), { code: result.code });
    return result;
  }
  async target(ppro, snapshot) {
    const { project, original, selectedRows } = await validateSelection(ppro, snapshot, { requireAudible: false });
    if (!project.path) throw new Error('שמרו את פרויקט פרימייר פעם אחת לפני יצירת כתוביות');
    const clips = [];
    for (const row of selectedRows) {
      const source = ppro.ClipProjectItem.cast(await row.item.getProjectItem());
      const sourcePath = await source.getMediaFilePath();
      if (!sourcePath) throw new Error('להצבה אוטומטית בחרו קטעי מדיה רגילים עם קובץ מקור');
      clips.push({ kind: row.kind, track: row.track, sourcePath, startTicks: row.startTicks, endTicks: row.endTicks, inTicks: row.inTicks, outTicks: row.outTicks, speed: row.speed, reversed: row.reversed, disabled: row.disabled });
    }
    return { projectPath: project.path, sequenceId: original.guid.toString(), clips };
  }
  async prepare(ppro, snapshot) { return this.request('/prepare', { target: await this.target(ppro, snapshot) }); }
  async prepareGraphics(ppro, snapshot) {
    const health = await this.request('/health');
    if (!health.referenceAudio) throw new Error('נדרש עדכון לרכיב Quick Caption Timeline Bridge לפני יצירת הדגשות עם סאונד. לא נשלח תמלול ולא בוצע חיוב.');
    return this.request('/prepare-graphics', { target: await this.target(ppro, snapshot) });
  }
  async buildGraphics(ppro, snapshot, id, video, color, referenceAudio) {
    const target = await this.target(ppro,snapshot);
    if (referenceAudio) {
      // Permission tokens remain in UXP storage; the bridge only needs the file.
      const {sourcePath,durationSeconds,ranges} = referenceAudio;
      target.referenceAudio = {sourcePath,durationSeconds,ranges};
    }
    const info = await this.request('/prepare', {target});
    const duration = snapshot.ranges.reduce((total, range) => total + range.end - range.start, 0);
    const segments = normalizeCaptionTiming(video.subtitle_json, duration, Number(info.frameTicks) / 254016000000 || .04);
    return this.request('/build-graphics', {target,id,segments,words:video.words_json,ranges:snapshot.ranges,color});
  }
  async deliver(ppro, snapshot, id, srt) { return this.request('/deliver', { target: await this.target(ppro, snapshot), id, srt }); }
  async attachReferenceAudio(ppro, snapshot, id, delivery, referenceAudio) {
    const target = await this.target(ppro,snapshot);
    const {sourcePath,durationSeconds,ranges} = referenceAudio;
    // The existing companion already serializes /prepare and forwards targets.
    // A fixed host operation lets installed companions hot-load this upgrade.
    Object.assign(target,{operation:'attach-reference-audio',id,graphicsDelivery:delivery,referenceAudio:{sourcePath,durationSeconds,ranges}});
    return this.request('/prepare',{target});
  }
}
module.exports = { TimelineBridge };
