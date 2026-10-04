import { apiHeaders, apiUserUid } from './api';

export type ClientErrorCode = 'upload-invalid-response' | 'upload-connection-lost' | 'upload-timeout' | 'save-network-error' | 'save-invalid-response';
type Report = { code: ClientErrorCode; eventId: string; status?: number };
const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
let flushing = false;
let retryTimer: number | undefined;
const memory = new Map<string, Report[]>();
const key = (uid: string) => `quickcaption:error-reports:${uid}`;
function read(uid: string): Report[] {
  if (memory.has(uid)) return memory.get(uid)!;
  let reports: Report[] = [];
  try {
    const stored = JSON.parse(sessionStorage.getItem(key(uid)) ?? '[]');
    if (Array.isArray(stored)) reports = stored.slice(-50);
  } catch { /* Error reporting must work with storage disabled. */ }
  memory.set(uid, reports); return reports;
}
function write(uid: string, reports: Report[]) {
  memory.set(uid, reports);
  try { sessionStorage.setItem(key(uid), JSON.stringify(reports)); } catch { /* Best effort. */ }
}
export async function flushErrorReports() {
  const uid = apiUserUid();
  if (uid === 'guest' || flushing || !navigator.onLine) return;
  flushing = true;
  try {
    while (read(uid).length && apiUserUid() === uid) {
      const report = read(uid)[0];
      const headers = await apiHeaders({ 'Content-Type': 'application/json' });
      if (apiUserUid() !== uid) break;
      const response = await fetch(`${base}/api/client-errors`, { method: 'POST', headers,
        body: JSON.stringify(report), signal: AbortSignal.timeout(5000) });
      if (response.status === 429 || response.status >= 500) throw new Error('Error reporting unavailable');
      write(uid, read(uid).filter(item => item.eventId !== report.eventId));
    }
  } catch {
    if (retryTimer == null) retryTimer = window.setTimeout(() => {
      retryTimer = undefined; void flushErrorReports();
    }, 30_000);
  } finally { flushing = false; }
}
export function reportClientError(code: ClientErrorCode, status?: number) {
  try {
    const uid = apiUserUid();
    if (uid === 'guest') return;
    write(uid, [...read(uid), { code, status, eventId: crypto.randomUUID() }].slice(-50));
    void flushErrorReports();
  } catch { /* Monitoring must never interrupt the operation being reported. */ }
}
window.addEventListener('online', () => void flushErrorReports());
