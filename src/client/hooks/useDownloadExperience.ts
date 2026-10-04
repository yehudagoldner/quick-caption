import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { startFileDownload, type DownloadFile } from '../contexts/DownloadContext';

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function post(path: string, body: unknown) {
  let result: Response;
  try {
    result = await apiFetch(`${base}/api/downloads${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { throw new Error('לא ניתן לשמור כרגע. בדקו את החיבור ולחצו שוב כדי לנסות שוב.'); }
  const payload = await result.json().catch(() => null);
  if (!result.ok || payload?.success !== true) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'לא התקבל אישור שמירה. לחצו שוב כדי לנסות שוב.');
  }
  return payload;
}

export function useDownloadExperience(videoId: number | null) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [feedbackDownloadId, setFeedbackDownloadId] = useState<string | null>(null);
  const pending = useRef(new Map<string, string>());
  const flights = useRef(new Set<string>());
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    pending.current.clear();
    flights.current.clear();
    setFeedbackDownloadId(null);
    setError(null);
    return () => { generation.current++; };
  }, [videoId, user?.uid]);

  const download = async (kind: 'subtitles' | 'video', file: DownloadFile) => {
    if (!user?.uid || !videoId) {
      setError('נדרשת התחברות וסרטון שמור כדי להוריד.');
      return false;
    }
    const key = `${kind}:${file.name}`;
    if (flights.current.has(key)) return false;
    const version = generation.current;
    const id = pending.current.get(key) ?? crypto.randomUUID();
    pending.current.set(key, id);
    flights.current.add(key);
    setError(null);
    try {
      const payload = await post('', { id, videoId, kind, format: kind === 'video' ? 'mp4' : file.name.split('.').pop()?.toLowerCase() });
      if (payload.downloadId !== id) throw new Error('לא התקבל אישור להורדה. לחצו שוב על הורדה כדי לנסות שוב.');
      if (generation.current !== version) return false;
      startFileDownload(file);
      pending.current.delete(key);
      if (kind === 'video') setFeedbackDownloadId(id);
      return true;
    } catch (cause) {
      if (generation.current === version) setError(cause instanceof Error ? cause.message : 'ההורדה נכשלה. נסו שוב.');
      return false;
    } finally {
      if (generation.current === version) flights.current.delete(key);
    }
  };

  const saveFeedback = async (rating: number, feedback: string) => {
    if (!feedbackDownloadId) throw new Error('לא נמצאה הורדה לדירוג.');
    await post(`/${feedbackDownloadId}/feedback`, { rating, feedback });
    setFeedbackDownloadId(null);
  };
  return {
    actions: {
      downloadSubtitles: (file: DownloadFile) => download('subtitles', file),
      downloadVideo: (file: DownloadFile) => download('video', file),
    },
    error, clearError: () => setError(null), feedbackDownloadId,
    closeFeedback: () => setFeedbackDownloadId(null), saveFeedback,
  };
}
