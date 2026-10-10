'use strict';
// An allowlist, not a text redactor: paths, transcripts, tokens and error messages
// never enter a report, even when a caller accidentally includes them.
const TTL = 7 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const STAGES = ['startup', 'account', 'selection', 'preflight', 'preset', 'export', 'reference-audio', 'admission', 'upload', 'transcription', 'graphics', 'placement', 'complete', 'bridge-start'];
const CODES = ['unknown', 'network', 'permission', 'storage', 'authentication', 'invalid_response', 'preset_missing', 'preset_invalid', 'export_failed', 'template_missing', 'template_ambiguous', 'template_corrupt', 'template_schema', 'bridge_unavailable', 'bridge_permissions', 'bridge_timeout', 'EADDRINUSE', 'EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'ECONNREFUSED', 'CONNECTION_REVOKED', 'unsupported_graphics', 'unsupported_host', 'host_error', 'invalid_graphics', 'invalid_reference_audio', 'missing_reference_audio', 'reference_audio_import_failed', 'graphics_import_failed', 'wrong_project', 'missing_sequence', 'changed_clip', 'delivery_uncertain', 'delivery_conflict', 'invalid_subtitles', 'invalid_target', 'invalid_request', 'forbidden'];
const version = value => typeof value === 'string' && /^\d+(?:\.\d+){0,3}$/.test(value) ? value : undefined;
const FILES = ['panel.js', 'client.js', 'bridge.js', 'selection.js', 'reference-audio.js', 'graphics-placement.js', 'caption-timing.js', 'active-word-plan.js', 'native-graphic.js', 'host.jsx', 'server.js', 'boot.js'];
function errorDetails(error) {
  const frames = [];
  const stack = String(error?.stack || '').slice(0, 8000);
  for (const match of stack.matchAll(/([a-z-]+\.(?:js|jsx)):(\d+)(?::(\d+))?/g)) {
    if (FILES.includes(match[1])) frames.push({ file: match[1], line: Number(match[2]) });
    if (frames.length === 6) break;
  }
  if (Number.isInteger(error?.nativeLine)) frames.push({ file: 'host.jsx', line: error.nativeLine });
  if (Array.isArray(error?.diagnosticFrames)) frames.unshift(...error.diagnosticFrames.slice(0,6));
  return { code: errorCode(error), errorType: error?.nativeType || error?.name, status: error?.status, frames: frames.filter(frame => FILES.includes(frame?.file) && Number.isInteger(frame.line) && frame.line > 0 && frame.line <= 100000).slice(0,6) };
}
function errorCode(error) {
  if (error?.code === 'unsupported_graphics') {
    const message = String(error.message || '');
    if (/תבנית.*חסרה/i.test(message)) return 'template_missing';
    if (/checksum|ZIP|encoding/i.test(message)) return 'template_corrupt';
    if (/schema|format|structure|editable text|template definition/i.test(message)) return 'template_schema';
  }
  if (CODES.includes(error?.code)) return error.code;
  if (error?.status === 401 || error?.status === 403) return 'authentication';
  const text = String(error?.message || '');
  if (/permission|denied|הרשא/i.test(text)) return 'permission';
  if (/preset/i.test(text)) return 'preset_invalid';
  if (/ייצוא|export/i.test(text)) return 'export_failed';
  if (/network|fetch|חיבור לשרת/i.test(text)) return 'network';
  return 'unknown';
}
function sanitizeReport(input, now = Date.now()) {
  if (!input || !UUID.test(input.id || '') || !UUID.test(input.deviceId || '') || !Number.isFinite(input.at) || input.at > now + 60000 || input.at <= now - TTL || !['uxp', 'bridge'].includes(input.source)) throw new Error('Invalid diagnostic report');
  const env = input.environment || {}, environment = {};
  environment.os = ['win32', 'darwin', 'linux'].includes(env.os) ? env.os : 'unknown';
  environment.arch = ['x64', 'arm64', 'ia32'].includes(env.arch) ? env.arch : 'unknown';
  for (const key of ['pluginVersion', 'hostVersion', 'bridgeVersion', 'runtimeVersion']) if (version(env[key])) environment[key] = version(env[key]);
  if (/^[a-f0-9]{64}$/.test(env.templateHash || '')) environment.templateHash = env.templateHash;
  for (const key of ['activeWord', 'templateCompatible', 'fontVerified', 'presetSaved', 'paired', 'simulation', 'clockSkewed']) if (typeof env[key] === 'boolean') environment[key] = env[key];
  const events = (Array.isArray(input.events) ? input.events : []).slice(-32).map(event => {
    const item = { stage: STAGES.includes(event?.stage) ? event.stage : 'startup', outcome: ['start', 'ok', 'error'].includes(event?.outcome) ? event.outcome : 'error', code: CODES.includes(event?.code) ? event.code : 'unknown' };
    if (Number.isFinite(event?.elapsedMs)) item.elapsedMs = Math.min(24 * 60 * 60 * 1000, Math.max(0, Math.round(event.elapsedMs)));
    if (Number.isInteger(event?.status) && event.status >= 0 && event.status <= 599) item.status = event.status;
    if (['Error', 'TypeError', 'SyntaxError', 'RangeError'].includes(event?.errorType)) item.errorType = event.errorType;
    if (Array.isArray(event?.frames)) item.frames = event.frames.filter(frame => FILES.includes(frame?.file) && Number.isInteger(frame.line) && frame.line > 0 && frame.line <= 100000).slice(0,6).map(frame => ({file:frame.file,line:frame.line}));
    for (const key of ['clipCount', 'rangeCount', 'captionCount']) if (Number.isInteger(event?.[key]) && event[key] >= 0 && event[key] <= 20000) item[key] = event[key];
    if (Number.isFinite(event?.durationSeconds)) item.durationSeconds = Math.min(86400, Math.max(0, Math.round(event.durationSeconds)));
    return item;
  });
  return { schema: 1, id: input.id.toLowerCase(), deviceId: input.deviceId.toLowerCase(), at: input.at, source: input.source, environment, events };
}
module.exports = { TTL, UUID, STAGES, errorCode, errorDetails, sanitizeReport };
