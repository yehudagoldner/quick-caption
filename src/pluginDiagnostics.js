import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import schema from '../premiere-plugin/diagnostics-schema.js';
export const DIAGNOSTIC_LIMITS = Object.freeze({ ttlMs: schema.TTL, maxReports: 200, perAccount: 20, maxBytes: 1024 * 1024, maxReportBytes: 16384, sweepMs: 15 * 60000 });
const ownerKey = uid => createHash('sha256').update(uid).digest('hex');
export function createDiagnosticStore({ directory, now = Date.now, io = fs, limits = DIAGNOSTIC_LIMITS }) {
  const filename = path.join(directory, 'reports.json'), temporary = filename + '.tmp';
  let queue = Promise.resolve();
  const serialized = action => { const next = queue.then(action); queue = next.catch(() => {}); return next; };
  async function read() {
    try {
      if ((await io.stat(filename)).size > limits.maxBytes) return [];
      const data = JSON.parse(await io.readFile(filename, 'utf8'));
      if (!Array.isArray(data)) return [];
      const rows=[];
      for (const row of data.slice(-limits.maxReports)) {
        if (!/^[a-f0-9]{64}$/.test(row.owner || '') || !Number.isFinite(row.expiresAt) || row.expiresAt <= now()) continue;
        try { const report=schema.sanitizeReport(row.report,now()); rows.push({owner:row.owner,report,expiresAt:Math.min(row.expiresAt,report.at+limits.ttlMs)}); } catch { /* Corrupt records cannot leak unvalidated data. */ }
      }
      return rows;
    } catch (error) { if (!['ENOENT', 'SyntaxError'].includes(error.code || error.name)) throw error; return []; }
  }
  async function write(rows) {
    const counts = new Map();
    rows = rows.slice().reverse().filter(row => { const count = (counts.get(row.owner) || 0) + 1; counts.set(row.owner, count); return count <= limits.perAccount; }).reverse().slice(-limits.maxReports);
    while (Buffer.byteLength(JSON.stringify(rows)) > limits.maxBytes) rows.shift();
    await io.mkdir(directory, { recursive: true, mode: 0o700 });
    await io.writeFile(temporary, JSON.stringify(rows), { encoding: 'utf8', mode: 0o600 });
    await io.rename(temporary, filename);
    return rows;
  }
  return {
    accept: (uid, input) => serialized(async () => {
      if (Buffer.byteLength(JSON.stringify(input) || '') > limits.maxReportBytes) throw Object.assign(new Error('Diagnostic too large'), { status: 413 });
      const receivedAt=now();
      let report; try {
        if(!Number.isFinite(input?.at)||input.at<=0||input.at>8640000000000000)throw Error('Invalid timestamp');
        // Retention uses the server clock. A different machine's clock cannot
        // retain reports forever or prevent useful diagnostics from arriving.
        report = schema.sanitizeReport({...input,at:receivedAt,environment:{...input.environment,clockSkewed:Math.abs(input.at-receivedAt)>60000}}, receivedAt);
      } catch { throw Object.assign(new Error('Invalid diagnostic'), { status: 400 }); }
      const owner = ownerKey(uid), rows = await read();
      let saved=rows.find(row => row.owner === owner && row.report?.id === report.id);
      if (!saved) { saved={owner,report,expiresAt:receivedAt+limits.ttlMs}; rows.push(saved); }
      await write(rows);
      return { accepted: true, id: report.id, expiresAt: new Date(saved.expiresAt).toISOString() };
    }),
    list: uid => serialized(async () => { const rows = await write(await read()); return rows.filter(row => row.owner === ownerKey(uid)).map(row => ({ ...row.report, expiresAt: new Date(row.expiresAt).toISOString() })); }),
    sweep: () => serialized(async () => { const rows = await write(await read()); return { count: rows.length }; }),
  };
}
export function startDiagnosticCleanup(store, { schedule = setInterval, onError = () => console.error('Diagnostic cleanup unavailable') } = {}) {
  void store.sweep().catch(onError);
  const timer = schedule(() => { void store.sweep().catch(onError); }, DIAGNOSTIC_LIMITS.sweepMs);
  timer.unref?.(); return timer;
}
