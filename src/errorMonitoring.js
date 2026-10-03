import { randomUUID } from 'node:crypto';

export const CLIENT_ERROR_CODES = {
  'upload-invalid-response': ['העלאה', 'השרת החזיר תשובת העלאה לא תקינה'],
  'upload-connection-lost': ['העלאה', 'החיבור לשרת נותק במהלך העלאה או עיבוד'],
  'upload-timeout': ['העלאה', 'זמן ההמתנה לתשובת ההעלאה הסתיים'],
  'save-network-error': ['שמירת כתוביות', 'בקשת השמירה נכשלה לפני קבלת תשובה'],
  'save-invalid-response': ['שמירת כתוביות', 'השרת לא החזיר אישור שמירה תקין'],
};

export function redactErrorMessage(value) {
  return String(value ?? 'Unknown error')
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/((?:token|api[_-]?key|password|secret)\s*[=:]\s*)[^\s,;&"']+/gi, '$1[REDACTED]')
    .slice(0, 1000);
}

// Logging never delays an API response. A bounded queue retries DB outages.
export function createErrorRecorder(store, { retryMs = 5000, maxPending = 500 } = {}) {
  const queue = [];
  let flushing = false, timer;
  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length) {
        await store.recordError(queue[0]);
        queue.shift();
      }
    } catch {
      console.warn('Error monitoring storage unavailable; retrying pending records.');
      timer = setTimeout(() => { timer = undefined; void flush(); }, retryMs);
      timer.unref?.();
    } finally { flushing = false; }
  };
  return {
    record(entry) {
      if (queue.length >= maxPending) {
        console.warn('Error monitoring queue is full; record omitted.');
        return;
      }
      queue.push({ ...entry, id: entry.id ?? randomUUID(),
        message: redactErrorMessage(entry.message), createdAt: new Date() });
      if (!timer && !flushing) void flush();
    },
    close() { clearTimeout(timer); },
  };
}

export function captureApiErrors(recorder) {
  return (req, res, next) => {
    req.errorRequestId = randomUUID();
    res.setHeader('X-Request-Id', req.errorRequestId);
    let message;
    const json = res.json;
    res.json = function (body) {
      if (typeof body?.error === 'string') message = body.error;
      return json.call(this, body);
    };
    res.on('finish', () => {
      if (res.statusCode < 400 || !req.originalUrl.startsWith('/api/') || req.path === '/api/client-errors') return;
      recorder.record({ source: 'server', operation: req.path.slice(0, 160),
        status: res.statusCode, method: req.method, userUid: req.identity?.uid ?? null,
        requestId: req.errorRequestId, message: message ?? `HTTP ${res.statusCode}` });
    });
    next();
  };
}

export function createClientErrorHandler(recorder) {
  const limits = new Map();
  return (req, res) => {
    const { code, eventId, status } = req.body ?? {};
    const definition = Object.hasOwn(CLIENT_ERROR_CODES, code ?? '') && CLIENT_ERROR_CODES[code];
    if (!definition || typeof eventId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(eventId) ||
        (status != null && (!Number.isInteger(status) || status < 0 || status > 599))) {
      return res.status(400).json({ error: 'Invalid error report' });
    }
    const uid = req.identity.uid, now = Date.now();
    for (const [key, limit] of limits) if (limit.until <= now) limits.delete(key);
    const limit = limits.get(uid) ?? { count: 0, until: now + 60_000 };
    if (limit.count >= 20 || (!limits.has(uid) && limits.size >= 10_000)) return res.status(429).json({ error: 'Too many reports' });
    limit.count++; limits.set(uid, limit);
    recorder.record({ id: eventId, source: 'client', operation: definition[0], message: definition[1],
      status: status || null, method: null, userUid: uid, requestId: req.errorRequestId });
    res.status(202).json({ accepted: true });
  };
}
