import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function useLiveCredits(uid?: string) {
  const [balance, setBalance] = useState<{ uid: string; credits: number } | null>(null);
  const currentUid = useRef(uid);
  currentUid.current = uid;
  const generation = useRef(0);
  const pending = useRef<{ uid: string; promise: Promise<void> } | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (!uid) return Promise.resolve();
    if (pending.current?.uid === uid) return pending.current.promise;
    const epoch = generation.current;
    let promise: Promise<void>;
    promise = (async () => {
      try {
        const response = await apiFetch(`${API_BASE}/api/users/credits`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Balance unavailable');
        const data = await response.json();
        if (!Number.isSafeInteger(data.credits) || data.credits < 0) throw new Error('Invalid balance');
        if (currentUid.current === uid && generation.current === epoch) setBalance({ uid, credits: data.credits });
      } catch {
        // Unknown balance must never appear as a current number or as zero.
        if (currentUid.current === uid && generation.current === epoch) setBalance(null);
      } finally {
        if (pending.current?.uid === uid && generation.current === epoch) pending.current = null;
      }
    })();
    pending.current = { uid, promise };
    return promise;
  }, [uid]);
  useEffect(() => {
    setBalance(null);
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const timer = window.setInterval(visibleRefresh, 30000);
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      generation.current++;
      pending.current = null;
      window.clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [refresh]);
  return { credits: balance && balance.uid === uid ? balance.credits : null, refresh };
}
