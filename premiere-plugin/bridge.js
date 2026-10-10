const { validateSelection } = require('./selection.js');
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
      response = await Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(UNAVAILABLE)), 60000); })]);
    } catch (error) {
      if (/Permission denied|Manifest entry not found/i.test(error.message || '')) throw Object.assign(new Error('פרימייר לא טען את הרשאות החיבור המעודכנות. טענו מחדש את התוסף בכלי הפיתוח ונסו שוב.'), { code: 'bridge_permissions' });
      throw unavailable();
    } finally { clearTimeout(timer); }
    const result = await response.json();
    const explanation = {
      delivery_uncertain: 'ייתכן שהכתוביות כבר הוצבו. בדקו את הטיימליין לפני שחזור; לא ייווצר ערוץ נוסף ולא יהיה חיוב נוסף.',
      delivery_conflict: 'התמלול השתנה אחרי ניסיון ההצבה. נדרש לבדוק את הערוץ הקיים לפני עדכון.',
      invalid_subtitles: 'לא נמצאו כתוביות תקינות להצבה בקטעים שנבחרו.',
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
  async deliver(ppro, snapshot, id, srt) { return this.request('/deliver', { target: await this.target(ppro, snapshot), id, srt }); }
}
module.exports = { TimelineBridge };
