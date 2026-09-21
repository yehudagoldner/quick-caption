import type { User } from "firebase/auth";

export const isDevAuthBypass =
  typeof __DEV_AUTH_BYPASS__ !== "undefined" && __DEV_AUTH_BYPASS__ === true;

export const devAuthUid =
  typeof __DEV_AUTH_UID__ !== "undefined" && __DEV_AUTH_UID__ ? __DEV_AUTH_UID__ : "local-dev-user";

export function createDevAuthUser(): User {
  return {
    uid: devAuthUid,
    email: "dev@localhost",
    displayName: "משתמש דמה",
    photoURL: null,
    phoneNumber: null,
    emailVerified: true,
    isAnonymous: false,
    providerData: [{ providerId: "dev-bypass", uid: devAuthUid, displayName: "משתמש דמה", email: "dev@localhost", phoneNumber: null, photoURL: null }],
    metadata: {
      lastSignInTime: new Date().toISOString(),
      creationTime: new Date().toISOString(),
    },
  } as User;
}
