const DEV_BYPASS_FLAG = "1";
const DEFAULT_DEV_UID = "local-dev-user";

export function isDevAuthBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === DEV_BYPASS_FLAG;
}

export function getDevAuthUid() {
  const uid = String(process.env.DEV_AUTH_UID ?? "").trim();
  return uid || DEFAULT_DEV_UID;
}
