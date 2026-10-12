// Browser platform hints stay on this page. No identity/account lookup is
// needed to choose an installer, and no high-entropy device hints are requested.
export function detectPlatform(browser = {}) {
  const ua = String(browser.userAgent || '');
  const platform = String(browser.platform || '');
  const hint = String(browser.userAgentData?.platform || '');
  if (/iPhone|iPad|iPod|Android|Windows Phone/i.test(ua) || /Android|iOS/i.test(hint) ||
      (/Mac/i.test(platform) && Number(browser.maxTouchPoints) > 1) || browser.userAgentData?.mobile) return 'mobile';
  if (/^Windows$/i.test(hint)) return 'windows';
  if (/^macOS$/i.test(hint)) return 'mac';
  if (/Linux|Chrome OS|Chromium OS/i.test(hint)) return 'unsupported';
  if (/^Win/i.test(platform) || /Windows NT/i.test(ua)) return 'windows';
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Linux|CrOS/i.test(platform + ' ' + ua)) return 'unsupported';
  return 'unknown';
}
