import type { User } from 'firebase/auth';

let currentUser: User | null = null;
export function setApiUser(user: User | null) { currentUser = user; }
export function apiUserUid() { return currentUser?.uid ?? 'guest'; }
export async function apiHeaders(initial?: HeadersInit): Promise<Headers> {
  const headers = new Headers(initial);
  const user = currentUser;
  if (user) {
    const token = await user.getIdToken();
    if (currentUser !== user) throw new Error('The signed-in account changed during the request');
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, headers: await apiHeaders(init.headers) });
}
