import { createFirebaseVerifier as realVerifier } from '../../../src/firebaseIdentity.js?real';
export { createIdentityMiddleware } from '../../../src/firebaseIdentity.js?real';
export function createFirebaseVerifier() {
  return realVerifier({ projectId: 'security-fixture', fetchImpl: async () => ({
    ok: true, headers: new Headers({ 'cache-control': 'max-age=3600' }),
    json: async () => ({ fixture: process.env.TEST_PUBLIC_KEY }),
  }) });
}
