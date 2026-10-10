const { readStoredJson } = require('./storage-json.js');
const { TTL, sanitizeReport, errorDetails, STAGES } = require('./diagnostics-schema.js');
// These identifiers only correlate diagnostics; they never authenticate anything.
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16); });
class Diagnostics {
  constructor({ storage, client, environment = {}, now = Date.now, makeId = uuid }) {
    Object.assign(this, { storage, client, environment, now, makeId });
    this.events = []; this.queue = []; this.flushing = null; this.writes = Promise.resolve();
    this.started = now(); this.lastAttempt = -Infinity;
  }
  async restore() {
    try { const saved = readStoredJson(await this.storage.getItem('diagnostics-v1')); this.deviceId = saved.deviceId; this.queue = saved.queue || []; } catch { /* First run/storage unavailable. */ }
    if (!require('./diagnostics-schema.js').UUID.test(this.deviceId || '')) this.deviceId = this.makeId();
    this.queue = (Array.isArray(this.queue) ? this.queue : []).filter(item => item.report?.at > this.now() - TTL).slice(-10);
    this.persist();
  }
  persist() {
    const value = JSON.stringify({ deviceId: this.deviceId, queue: this.queue });
    this.writes = this.writes.then(() => this.storage.setItem('diagnostics-v1', value)).catch(() => {});
  }
  begin(environment = {}) { this.events = []; this.started = this.now(); this.owner = this.client.session?.user.uid || null; Object.assign(this.environment, environment); this.step('selection'); }
  step(stage, details = {}) {
    if (!STAGES.includes(stage)) return;
    if (stage === 'account' && this.client.session) this.owner = this.client.session.user.uid;
    this.stage = stage;
    this.events.push({ ...details, stage, outcome: details.outcome || 'start', elapsedMs: this.now() - this.started });
    this.events = this.events.slice(-31);
  }
  failure(error) {
    try {
      const id = this.makeId();
      const report = sanitizeReport({ id, deviceId: this.deviceId || (this.deviceId = this.makeId()), at: this.now(), source: 'uxp', environment: this.environment,
        events: [...this.events, { ...errorDetails(error), stage: this.stage || 'startup', outcome: 'error', elapsedMs: this.now() - this.started }] }, this.now());
      this.queue = [...this.queue.filter(item => item.report.at > this.now() - TTL), { owner: this.owner || this.client.session?.user.uid || null, report }].slice(-10);
      this.persist(); void this.flush(); return id;
    } catch { return null; }
  }
  async flush() {
    const alive = this.queue.filter(item => item.report.at > this.now() - TTL);
    if (alive.length !== this.queue.length) { this.queue = alive; this.persist(); }
    if (this.flushing || !this.client.session || this.now() - this.lastAttempt < 30000) return;
    this.lastAttempt = this.now();
    const owner = this.client.session.user.uid;
    // Bind anonymous bootstrap errors at first login. Never upload another user's
    // queue after a switch on a shared computer.
    this.queue = this.queue.filter(item => item.report.at > this.now() - TTL);
    for (const item of this.queue) if (!item.owner) item.owner = owner;
    this.persist();
    // Schedule after assigning the promise. An empty queue for a different
    // account must not leave a resolved promise permanently blocking retries.
    this.flushing = Promise.resolve().then(async () => {
      try {
        for (const item of [...this.queue]) {
          if (this.client.session?.user.uid !== owner) break;
          if (item.owner !== owner) continue;
          let timer;
          try {
            const response = await Promise.race([this.client.request('/api/plugin/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.report) }),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Diagnostic timeout')), 5000); })]);
            if (!response?.accepted || response.id !== item.report.id) throw new Error('Invalid diagnostic receipt');
          } finally { clearTimeout(timer); }
          this.queue = this.queue.filter(row => row.report.id !== item.report.id); this.persist();
        }
      } catch { /* Offline: bounded queue retried after account refresh. */ }
      finally { this.flushing = null; }
    });
    return this.flushing;
  }
}
module.exports = { Diagnostics };
