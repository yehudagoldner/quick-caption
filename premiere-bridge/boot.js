/* Adobe's CEP native methods are also used by its CSInterface.js SDK. */
(function () {
  'use strict';
  var node = window.cep_node;
  var path = node.require('path');
  var os = node.require('os');
  var extensionPath = decodeURI(window.__adobe_cep__.getSystemPath('extension'));
  extensionPath = node.process.platform === 'win32' ? extensionPath.replace(/^file:\/\/\//, '') : extensionPath.replace(/^file:\/\//, '');
  var config = node.require(path.join(extensionPath, 'bridge-config.json'));
  var root = path.join(node.process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support'), 'Quick Caption', 'Premiere Bridge QA');
  var evalHost = function (method, payload) {
    return new Promise(function (resolve, reject) {
      // The method comes only from our server's fixed whitelist; data is quoted twice.
      var argument = JSON.stringify(JSON.stringify(payload || {})).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      // Reload only our installed source. Preserve delivery receipts in the host
      // across reloads so development updates cannot repeat timeline mutations.
      var loader = JSON.stringify(path.join(extensionPath, 'loader.jsx').replace(/\\/g, '/'));
      var script = '$.evalFile(' + loader + '); $._quickCaptionBridge.' + method + '(' + argument + ')';
      window.__adobe_cep__.evalScript(script, function (result) {
        try {
          var data = JSON.parse(result);
          if (!data.ok) throw Object.assign(new Error(data.error), { code: data.code });
          resolve(data);
        } catch (error) { reject(error); }
      });
    });
  };
  var logError = function (error) {
    var fs = node.require('fs'); fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(path.join(root, 'bridge.log'), new Date().toISOString() + ' ' + error.message + '\n');
  };
  try { node.require(path.join(extensionPath, 'server.js')).startBridge({ root: root, token: config.token, port: config.port, evalHost: evalHost }).on('error', logError); }
  catch (error) { logError(error); }
}());
