const { readStoredJson } = require('./storage-json.js');
class PluginClient {
  constructor({ baseUrl, storage, fetcher = fetch, now = Date.now, version = '1.0.0' }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.storage = storage; this.fetcher = fetcher; this.now = now;
    this.version = version;
    this.session = null; this.refreshing = null; this.epoch = 0;
  }
  async restore() {
    try { this.session = readStoredJson(await this.storage.getItem('account')); }
    catch { this.session = null; }
  }
  async accept(data) {
    this.session = { ...data, expiresAt: this.now() + data.expiresIn * 1000 };
    await this.storage.setItem('account', JSON.stringify(this.session));
  }
  async publicRequest(path, body) {
    const response = await this.fetcher(`${this.baseUrl}/api/plugin/link${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'החיבור נכשל'), { status: response.status });
    return data;
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    if (!this.session) throw new Error('נדרשת התחברות');
    const epoch = this.epoch;
    const refreshToken = this.session.refreshToken;
    this.refreshing = (async () => {
      try {
        const data = await this.publicRequest('/refresh', { refreshToken });
        if (epoch !== this.epoch) throw new Error('החשבון השתנה');
        await this.accept(data);
      } catch (error) {
        if (error.status === 401 && epoch === this.epoch) await this.clear();
        throw error;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
  async request(path, options = {}, retry = true) {
    if (!this.session) throw new Error('נדרשת התחברות');
    if (this.session.expiresAt < this.now() + 30000) await this.refresh();
    const epoch = this.epoch;
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...options, headers: { ...options.headers, Authorization: `Bearer ${this.session.accessToken}`, 'X-Quick-Caption-Version': this.version },
    });
    if (epoch !== this.epoch) throw new Error('החשבון השתנה');
    if (response.status === 401 && retry && (options.method === undefined || options.method === 'GET' || path === '/api/plugin/quote')) {
      await this.refresh();
      return this.request(path, options, false);
    }
    const data = await response.json();
    if (response.status === 401 && data.code === 'CONNECTION_REVOKED' && epoch === this.epoch) await this.clear();
    if (!response.ok) throw Object.assign(new Error(data.error || 'הבקשה נכשלה'), { status: response.status, code: data.code });
    return data;
  }
  json(path, body) { return this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  async settlePreviousJob(previous) {
    if (!previous || previous.finished || previous.uid !== this.session?.user.uid) return previous;
    let state;
    try { state = await this.request(`/api/transcribe/jobs/${previous.id}`); }
    catch { throw new Error('מצב ההעלאה הקודמת עדיין אינו ידוע. בדקו את התמלול האחרון לפני שליחה חדשה.'); }
    if (!['completed', 'failed'].includes(state.status)) throw new Error('התמלול הקודם עדיין מתבצע. בדקו את התמלול האחרון לפני שליחה חדשה.');
    if (state.status === 'completed' && !state.result?.videoId) throw new Error('תוצאת התמלול הקודם עדיין אינה זמינה. בדקו את אותה משימה לפני שליחה חדשה.');
    return state.status === 'completed' ? { ...previous, finished: true, result: state.result, delivery: previous.delivery || { status: 'pending' } } : { ...previous, finished: true };
  }
  async clear() {
    this.epoch++; this.session = null;
    try { await this.storage.removeItem('account'); } catch { /* Already empty. */ }
  }
}
module.exports = { PluginClient };
