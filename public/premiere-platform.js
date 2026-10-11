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

export function setupDownloadPage(document, browser) {
  const detected = detectPlatform(browser);
  const labels = {windows: 'Windows', mac: 'Mac'};
  const switcher = document.getElementById('platform-switch');
  const status = document.getElementById('download-status');
  function select(platform, manual = false) {
    const supported = ['windows', 'mac'].includes(platform);
    for (const panel of document.querySelectorAll('[data-platform-panel]')) panel.hidden = supported && panel.dataset.platformPanel !== platform;
    for (const button of document.querySelectorAll('[data-platform]')) button.setAttribute('aria-pressed', String(button.dataset.platform === platform));
    for (const heading of document.querySelectorAll('.platform-heading')) heading.hidden = supported;
    document.getElementById('download-title').textContent = supported ? `Quick Caption ל־${labels[platform]}` : 'מתקין Quick Caption';
    document.getElementById('platform-badge').textContent = supported ? `בטא ל־${labels[platform]}` : 'גרסת בטא';
    document.getElementById('installation-title').textContent = supported ? `התקנה ב־${labels[platform]}, צעד אחר צעד` : 'התקנה, צעד אחר צעד';
    document.getElementById('platform-detection').textContent = manual ? `בחרתם ${labels[platform]}. ההורדה וההוראות עודכנו.` :
      supported ? `זיהינו ${labels[platform]} — זה המתקין המתאים למחשב שלכם. אפשר לבחור מערכת אחרת.` :
      detected === 'mobile' ? 'Premiere פועל במחשב. בחרו את המערכת של המחשב שבו תתקינו את התוסף.' :
      detected === 'unsupported' ? 'התוסף זמין ל־Windows ול־Mac. בחרו את המערכת של מחשב העריכה שלכם.' :
      'לא זיהינו את מערכת ההפעלה. בחרו Windows או Mac.';
    status.hidden = true;
  }
  for (const button of document.querySelectorAll('[data-platform]')) button.addEventListener('click', () => select(button.dataset.platform, true));
  // Keep native same-origin download links and the original user click. Fetching
  // a blob before opening the download can lose the gesture in Safari.
  for (const link of document.querySelectorAll('[data-installer]')) link.addEventListener('click', () => {
    status.hidden = false;
    status.textContent = 'בקשת ההורדה נשלחה. בדקו את רשימת ההורדות של הדפדפן; אם מופיעה חסימה, שלחו לנו את נוסח ההודעה.';
  });
  select(detected);
  switcher.hidden = false;
}

if (typeof document !== 'undefined' && typeof navigator !== 'undefined') setupDownloadPage(document, navigator);
