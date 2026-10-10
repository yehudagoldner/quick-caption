'use strict';
const path = require('path');
function runtimeDirectories({ platform = process.platform, env = process.env, home = require('os').homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const data = platform === 'win32' ? env.APPDATA || paths.join(home, 'AppData', 'Roaming') : paths.join(home, 'Library', 'Application Support');
  return { data, root: paths.join(data, 'Quick Caption', 'Premiere Bridge QA') };
}
function extensionDirectory(value, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!/^file:\/\//i.test(value)) return paths.normalize(value);
  const decoded = decodeURIComponent(value.replace(/^file:\/\//i, ''));
  return paths.normalize(platform === 'win32' ? (/^\/[a-z]:/i.test(decoded) ? decoded.slice(1) : decoded.startsWith('/') ? decoded : '//' + decoded) : decoded);
}
module.exports = { runtimeDirectories, extensionDirectory };
