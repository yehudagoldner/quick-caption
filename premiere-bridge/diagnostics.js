'use strict';
const fs = require('fs');
const path = require('path');
const { TTL, errorDetails } = require('./diagnostics-schema.js');
// Bounded, private startup log. No raw native messages or file names are stored.
function createBridgeDiagnostics({ root, now = Date.now, io = fs, paths = path } = {}) {
  const filename = paths.join(root, 'diagnostics.json');
  function read() {
    try { if (io.statSync(filename).size > 16384) return []; return JSON.parse(io.readFileSync(filename, 'utf8')).filter(item => item.at > now() - TTL).slice(-32); } catch { return []; }
  }
  function write(rows) {
    try {
      while (Buffer.byteLength(JSON.stringify(rows)) > 16384) rows.shift();
      io.mkdirSync(root, { recursive: true });
      io.writeFileSync(filename + '.tmp', JSON.stringify(rows), { mode: 0o600 }); io.renameSync(filename + '.tmp', filename);
      // Retire only the exact legacy unbounded log owned by this component.
      try { io.unlinkSync(paths.join(root, 'bridge.log')); } catch { /* Missing is normal. */ }
    } catch { /* Diagnostics must not break startup, including read-only disks. */ }
  }
  return { read, sweep: () => write(read()), record: (stage, error) => {
    const details=errorDetails(error);
    details.frames=details.frames.filter(frame=>Number.isInteger(frame.line)&&frame.line>0&&frame.line<=100000).slice(0,6);
    if(!['Error','TypeError','SyntaxError','RangeError'].includes(details.errorType))delete details.errorType;
    write([...read(), { ...details, at: now(), stage: stage === 'bridge-start' ? stage : 'placement', outcome: 'error' }].slice(-32));
  } };
}
module.exports = { createBridgeDiagnostics };
