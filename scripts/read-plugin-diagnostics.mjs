// Run in the active QA checkout over SSH, never expose this private file via
// static hosting. Prints only sanitized, unexpired technical reports.
import fs from 'node:fs/promises';
import path from 'node:path';
import schema from '../premiere-plugin/diagnostics-schema.js';
const args=process.argv.slice(2),value=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const id=value('--id');if(id&&!schema.UUID.test(id))throw Error('Invalid diagnostic ID');
const filename=value('--file') || path.join(path.dirname(await fs.realpath('stored-videos')),'plugin-diagnostics','reports.json');
const now=Date.now();let rows=[];
try {
  if((await fs.stat(filename)).size>1024*1024)throw Error('Diagnostic storage exceeds configured bound');
  rows=JSON.parse(await fs.readFile(filename,'utf8'));
} catch(error) { if(error.code!=='ENOENT')throw error; }
const reports=[];
for(const row of rows) {
  if(row.expiresAt<=now || (id&&row.report?.id!==id.toLowerCase()))continue;
  try { reports.push({...schema.sanitizeReport(row.report,now),expiresAt:new Date(row.expiresAt).toISOString()}); } catch { /* Ignore damaged reports. */ }
}
console.log(JSON.stringify({reports:reports.slice(-20)},null,2));
