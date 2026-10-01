import { registerHooks } from 'node:module';
globalThis.__appEnvLoaded = true; // Never load deployment secrets or connect to the user's DB.
registerHooks({ resolve(specifier, context, nextResolve) {
  const fixtures = { '/db.js': 'db.mjs', '/transcription.js': 'transcription.mjs', '/firebaseIdentity.js': 'identity.mjs' };
  for (const [suffix, file] of Object.entries(fixtures)) {
    if (specifier.endsWith(suffix)) return { url: new URL(file, import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
await import('../../../server.js');
