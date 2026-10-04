import type { User } from 'firebase/auth';

let currentUser: User | null = null;
let accountReady: Promise<void> = Promise.resolve();
export function setApiUser(user: User | null, ready: Promise<void> = Promise.resolve()) {
  currentUser = user;
  accountReady = ready;
  // Keep the rejection available to requests, without an unhandled rejection
  // when no request is waiting yet.
  void ready.catch(() => {});
  if (user) void import('./errorReporting').then(module => module.flushErrorReports()).catch(() => {});
}
export function apiUserUid() { return currentUser?.uid ?? 'guest'; }
export async function apiHeaders(initial?: HeadersInit): Promise<Headers> {
  const headers = new Headers(initial);
  const user = currentUser;
  if (user) {
    await accountReady;
    if (currentUser !== user) throw new Error('The signed-in account changed during the request');
    const token = await user.getIdToken();
    if (currentUser !== user) throw new Error('The signed-in account changed during the request');
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const requestUid = apiUserUid();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  const savingSubtitles = init.method?.toUpperCase() === 'PUT' && /\/api\/videos\/(?:update-subtitles|\d+\/subtitles)(?:$|\?)/.test(url);
  const reportSaveFailure = (code: 'save-network-error' | 'save-invalid-response', status?: number) => {
    void import('./errorReporting').then(module => {
      if (apiUserUid() === requestUid) module.reportClientError(code, status);
    }).catch(() => {});
  };
  let response: Response;
  try {
    response = await fetch(input, { ...init, headers: await apiHeaders(init.headers) });
  } catch (error) {
    if (savingSubtitles) reportSaveFailure('save-network-error');
    throw error;
  }
  if (savingSubtitles && response.ok) {
    const acknowledgment = await response.clone().json().catch(() => null);
    if (acknowledgment?.status !== 'ok' && acknowledgment?.success !== true) {
      reportSaveFailure('save-invalid-response', response.status);
      throw new Error('לא התקבל אישור שמירה תקין. הטיוטה נשמרה בעורך; אפשר לנסות שוב.');
    }
  }
  return response;
}
