'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { connectionPath, validConnection } = require('./runtime-connection.js');
function loadPairing({ home = require('os').homedir(), development } = {}) {
  const filename = connectionPath(home);
  fs.mkdirSync(path.dirname(filename), {recursive:true, mode:0o700});
  let config;
  try { config = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (config && !validConnection(config)) throw new Error('Invalid local pairing');
  // Preserve the developer connection during migration to a signed beta.
  if (validConnection(development)) config = development;
  if (!config) config = {port:37289, token:crypto.randomBytes(32).toString('hex')};
  const temporary = filename + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(config), {mode:0o600});
  fs.renameSync(temporary, filename);
  return config;
}
module.exports = { loadPairing };
