import { apiFetch } from '../api';

export type BurnProgress = { stage: 'preparing' | 'burning' | 'downloading'; percent: number | null };

export async function requestBurn(endpoint: string, data: FormData, onProgress?: (progress: BurnProgress) => void) {
  const jobId = crypto.randomUUID();
  const controller = new AbortController();
  let stopped = false, downloading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  onProgress?.({ stage: 'preparing', percent: null });
  const poll = async () => {
    try {
      const response = await apiFetch(`${endpoint}/progress/${jobId}`, { signal: controller.signal });
      if (response.ok && !stopped && !downloading) {
        const progress = await response.json();
        if (!stopped && !downloading && ['preparing', 'burning', 'downloading'].includes(progress.stage)) {
          onProgress?.({ stage: progress.stage, percent: typeof progress.percent === 'number' && Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : null });
        }
      }
    } catch { /* A missed poll must not interrupt the burn request. */ }
    if (!stopped && !downloading) timer = setTimeout(poll, 1000);
  };
  timer = setTimeout(poll, 500);
  try {
    const response = await apiFetch(endpoint, { method: 'POST', body: data, headers: { 'X-Burn-Job-Id': jobId } });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'אירעה שגיאה בצריבת הכתוביות. נסו שוב.');
    }
    downloading = true;
    onProgress?.({ stage: 'downloading', percent: null });
    const blob = await response.blob();
    return { blob, filename: parseFilename(response.headers.get('Content-Disposition')) };
  } finally {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  }
}

function parseFilename(disposition: string | null) {
  if (!disposition) return undefined;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) { try { return decodeURIComponent(encoded[1]); } catch { /* Use the plain filename. */ } }
  return disposition.match(/filename="([^"]+)"/i)?.[1] ?? disposition.match(/filename=([^;]+)/i)?.[1]?.trim();
}
