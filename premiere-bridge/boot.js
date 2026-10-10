/* Adobe's CEP native methods are also used by its CSInterface.js SDK. */
(function () {
  'use strict';
  var node = window.cep_node;
  var path = node.require('path');
  var os = node.require('os');
  var extensionPath = window.__adobe_cep__.getSystemPath('extension');
  if (/^file:\/\//i.test(extensionPath)) {
    extensionPath = decodeURIComponent(extensionPath.replace(/^file:\/\//i, ''));
    if (node.process.platform === 'win32') extensionPath = /^\/[a-z]:/i.test(extensionPath) ? extensionPath.slice(1) : extensionPath.startsWith('/') ? extensionPath : '//' + extensionPath;
  }
  var environment = node.require(path.join(extensionPath, 'environment.js'));
  extensionPath = environment.extensionDirectory(window.__adobe_cep__.getSystemPath('extension'), node.process.platform);
  var root = environment.runtimeDirectories({ platform: node.process.platform, env: node.process.env, home: os.homedir() }).root;
  var diagnostics = node.require(path.join(extensionPath, 'diagnostics.js')).createBridgeDiagnostics({ root: root });
  diagnostics.sweep();
  setInterval(function () { diagnostics.sweep(); }, 15 * 60000);
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
          if (!data.ok) throw Object.assign(new Error(data.error), { code: data.code, nativeLine: data.line });
          resolve(data);
        } catch (error) { reject(error); }
      });
    });
  };
  var logError = function (error) { diagnostics.record('bridge-start', error); };
  try {
    var development;
    try { development = node.require(path.join(extensionPath, 'bridge-config.json')); } catch (missingDevelopmentConfig) { /* Signed distribution contains no pairing secret. */ }
    var config = node.require(path.join(extensionPath, 'pairing.js')).loadPairing({home:os.homedir(), development:development});
    node.require(path.join(extensionPath, 'server.js')).startBridge({ root: root, token: config.token, port: config.port, evalHost: evalHost, diagnostics: diagnostics }).on('error', logError);
  }
  catch (error) { logError(error); }
}());
