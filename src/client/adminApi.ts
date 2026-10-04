import type { User } from 'firebase/auth';

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export async function adminRequest<T>(user: User, path: string, body?: unknown, options: { signal?: AbortSignal } = {}): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(`${base}/api/admin${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: options.signal,
  });
  const data = await response.json().catch(() => { throw new Error('שירות הניהול אינו זמין כרגע. אפשר לנסות שוב.'); });
  if (!response.ok) throw new Error(data.error ?? 'הפעולה נכשלה.');
  return data;
}
