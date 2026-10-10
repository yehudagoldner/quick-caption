#!/bin/bash
# Bash 3.2 and tools supplied by macOS. No Node, Python, sudo or developer mode.
# Sourcing defines functions only, so local fixtures can replace OS boundaries.
QC_VERSION=1.0.1
QC_AGENT='/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent'

qc_platform() { /usr/bin/uname -s; }
qc_arch() { /usr/bin/uname -m; }
qc_os_version() { /usr/bin/sw_vers -productVersion; }
qc_now() { /bin/date +%s; }
qc_uuid() { /usr/bin/uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]'; }
qc_premiere_running() {
  /usr/bin/pgrep -x 'Adobe Premiere Pro' >/dev/null 2>&1 ||
    /usr/bin/pgrep -f '/Adobe Premiere Pro[^/]*\.app/Contents/MacOS/' >/dev/null 2>&1
}
qc_host_versions() {
  local file value
  for file in /Applications/Adobe\ Premiere\ Pro*/*.app/Contents/Info.plist \
    /Applications/Adobe\ Premiere\ Pro*.app/Contents/Info.plist \
    "$HOME"/Applications/Adobe\ Premiere\ Pro*/*.app/Contents/Info.plist; do
    [ -f "$file" ] || continue
    value=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$file" 2>/dev/null) || continue
    qc_valid_version "$value" && printf '%s\n' "$value"
  done
}
qc_valid_version() { [[ "$1" =~ ^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$ ]]; }
qc_host_supported() {
  local major minor rest
  IFS=. read -r major minor rest <<< "$1"
  [ "$major" -gt 25 ] || { [ "$major" -eq 25 ] && [ "${minor:-0}" -ge 6 ]; }
}
qc_checksum() { (cd "$QC_RESOURCES" && /usr/bin/shasum -a 256 -c SHA256SUMS) >/dev/null 2>&1; }
qc_check_payloads() {
  local file
  for file in "QuickCaption-Timeline-Bridge-$QC_VERSION.zxp" "QuickCaption-Premiere-$QC_VERSION.ccx" \
    installer.sh cleanup.sh README.md build-info.json SHA256SUMS; do
    [ -f "$QC_RESOURCES/$file" ] && [ ! -L "$QC_RESOURCES/$file" ] || return 1
  done
  qc_checksum
}
qc_xml() {
  local value="$1"
  value=${value//&/\&amp;}; value=${value//</\&lt;}; value=${value//>/\&gt;}
  value=${value//\"/\&quot;}; value=${value//\'/\&apos;}
  printf '%s' "$value"
}
qc_schedule_cleanup() {
  local directory="$HOME/Library/LaunchAgents" agent uid script
  mkdir -p "$directory" || return 1
  agent="$directory/com.quickcaption.installer-log-cleanup.plist"
  [ ! -L "$agent" ] && [ ! -L "$QC_STATE/cleanup.sh" ] || return 1
  cp "$QC_RESOURCES/cleanup.sh" "$QC_STATE/cleanup.sh" || return 1
  chmod 700 "$QC_STATE/cleanup.sh" || return 1
  script=$(qc_xml "$QC_STATE/cleanup.sh")
  cat > "$agent.tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.quickcaption.installer-log-cleanup</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$script</string></array>
<key>StartInterval</key><integer>3600</integer><key>RunAtLoad</key><true/>
</dict></plist>
EOF
  chmod 600 "$agent.tmp" && mv -f "$agent.tmp" "$agent" || return 1
  uid=$(/usr/bin/id -u)
  /bin/launchctl print "gui/$uid/com.quickcaption.installer-log-cleanup" >/dev/null 2>&1 ||
    /bin/launchctl bootstrap "gui/$uid" "$agent" >/dev/null 2>&1
}
qc_init() {
  QC_RESOURCES="$1"
  QC_STATE="$HOME/Library/Application Support/Quick Caption/Installer"
  QC_LOG="$QC_STATE/last-install.json"
  QC_STAGE=preflight QC_CODE=unknown QC_ADOBE_STATUS=0 QC_PROCESS_EXIT=0
  QC_BRIDGE=false QC_PANEL=false QC_CLEANUP=false QC_LOCKED=false QC_CHILD='' QC_CAPTURE=''
  QC_ID='' QC_AT=0 QC_OS=unknown QC_MACHINE=unknown QC_HOST=unknown
}
qc_prepare_log() {
  [ -n "$HOME" ] && [[ "$HOME" = /* ]] && [[ "$HOME" != *$'\n'* ]] && [[ "$HOME" != *$'\r'* ]] || return 1
  [ ! -L "$QC_STATE" ] && [ ! -L "$QC_LOG" ] && [ ! -L "$QC_STATE/install.lock" ] || return 1
  umask 077
  mkdir -p "$QC_STATE" && chmod 700 "$QC_STATE" || return 1
  # A concurrent installer must not overwrite its predecessor's report or files.
  mkdir "$QC_STATE/install.lock" 2>/dev/null || { QC_CODE=installer_busy; return 1; }
  QC_LOCKED=true
  QC_ID=$(qc_uuid)
  [[ "$QC_ID" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$ ]] || return 1
  QC_AT=$(qc_now); [[ "$QC_AT" =~ ^[0-9]{1,12}$ ]] || return 1
  QC_OS=$(qc_os_version); qc_valid_version "$QC_OS" || QC_OS=unknown
  case "$(qc_arch)" in arm64) QC_MACHINE=arm64;; x86_64) QC_MACHINE=x64;; *) QC_MACHINE=unknown;; esac
  # Hash the cleanup code before copying it into a persistent LaunchAgent.
  if qc_check_payloads && qc_schedule_cleanup; then QC_CLEANUP=true; fi
}
qc_record() {
  [ "$QC_LOCKED" = true ] && [ -n "$QC_ID" ] || return 1
  [ ! -L "$QC_LOG" ] || return 1
  local temporary
  temporary=$(mktemp "$QC_STATE/report.XXXXXXXX") || return 1
  printf '{"schema":1,"id":"%s","version":"%s","channel":"qa","platform":"darwin","arch":"%s","osVersion":"%s","hostVersion":"%s","createdAt":%s,"expiresAt":%s,"stage":"%s","code":"%s","adobeStatus":%s,"processExit":%s,"bridgeInstalled":%s,"panelInstalled":%s,"cleanupScheduled":%s}\n' \
    "$QC_ID" "$QC_VERSION" "$QC_MACHINE" "$QC_OS" "$QC_HOST" "$QC_AT" "$((QC_AT + 604800))" \
    "$QC_STAGE" "$QC_CODE" "$QC_ADOBE_STATUS" "$QC_PROCESS_EXIT" "$QC_BRIDGE" "$QC_PANEL" "$QC_CLEANUP" > "$temporary"
  chmod 600 "$temporary" && mv -f "$temporary" "$QC_LOG"
}
qc_finish() {
  if [ -n "$QC_CHILD" ]; then kill "$QC_CHILD" 2>/dev/null; wait "$QC_CHILD" 2>/dev/null; QC_CHILD=''; fi
  if [ -n "$QC_CAPTURE" ]; then rm -f "$QC_CAPTURE"; QC_CAPTURE=''; fi
  if [ "$QC_LOCKED" = true ]; then rmdir "$QC_STATE/install.lock" 2>/dev/null; QC_LOCKED=false; fi
}
qc_adobe_result() {
  local exitcode="$1" output="$2" code match
  # Exit zero alone is not proof: Adobe can print status=-204 and exit zero.
  # Check every printed status, including output containing a success first.
  while IFS= read -r match; do
    code=${match##*=}; code=${code//[[:space:]]/}
    [[ "$code" =~ ^-?[0-9]{1,6}$ ]] || { printf '%s\n' -10000; return; }
    [ "$code" -eq 0 ] || { printf '%s\n' "$code"; return; }
  done < <(printf '%s\n' "$output" | /usr/bin/grep -Eio 'status[[:space:]]*=[[:space:]]*[^[:space:]!,;]*' || true)
  if [ "$exitcode" -ne 0 ]; then printf '%s\n' "$exitcode"; return; fi
  if printf '%s\n' "$output" | /usr/bin/grep -Eiq '(^|[^[:alpha:]])(failed|failure)([^[:alpha:]]|$)|not[[:space:]]+success'; then printf '%s\n' -10000; return; fi
  if printf '%s\n' "$output" | /usr/bin/grep -Eiq '(^|[^[:alpha:]])success(ful(ly)?)?([^[:alpha:]]|$)'; then printf '0\n'; else printf '%s\n' -10000; fi
}
qc_run_adobe() {
  local started current
  QC_OUTPUT='' QC_PROCESS_EXIT=0
  QC_CAPTURE=$(mktemp "$QC_STATE/adobe.XXXXXXXX") || { QC_PROCESS_EXIT=1; return; }
  # Capture transient output only; it may contain private paths. Never persist it.
  "$QC_AGENT" "$@" > "$QC_CAPTURE" 2>&1 & QC_CHILD=$!
  started=$(qc_now)
  while kill -0 "$QC_CHILD" 2>/dev/null; do
    current=$(qc_now)
    if [ "$(wc -c < "$QC_CAPTURE")" -gt 65536 ]; then
      kill "$QC_CHILD" 2>/dev/null; wait "$QC_CHILD" 2>/dev/null
      QC_PROCESS_EXIT=125; break
    fi
    if [ "$((current - started))" -ge 300 ]; then
      kill "$QC_CHILD" 2>/dev/null; wait "$QC_CHILD" 2>/dev/null
      QC_PROCESS_EXIT=124; QC_CODE=adobe_timeout; break
    fi
    sleep 1
  done
  if [ "$QC_PROCESS_EXIT" -ne 124 ] && [ "$QC_PROCESS_EXIT" -ne 125 ]; then wait "$QC_CHILD"; QC_PROCESS_EXIT=$?; fi
  QC_CHILD=''
  # Bounded in-memory parse; unrecognized or truncated output cannot be success.
  if [ "$(wc -c < "$QC_CAPTURE")" -gt 65536 ]; then QC_OUTPUT=''; QC_PROCESS_EXIT=125;
  else QC_OUTPUT=$(cat "$QC_CAPTURE"); fi
  rm -f "$QC_CAPTURE"; QC_CAPTURE=''
}
qc_preflight() {
  local version found=false supported=false major
  [ "$(qc_platform)" = Darwin ] || { QC_CODE=unsupported_platform; return 1; }
  case "$(qc_arch)" in arm64|x86_64) ;; *) QC_CODE=unsupported_architecture; return 1;; esac
  version=$(qc_os_version)
  qc_valid_version "$version" || { QC_CODE=unsupported_os; return 1; }
  major=${version%%.*}; [ "$major" -ge 13 ] || { QC_CODE=unsupported_os; return 1; }
  qc_check_payloads || { QC_CODE=invalid_package; return 1; }
  [ -x "$QC_AGENT" ] || { QC_CODE=creative_cloud_missing; return 1; }
  qc_premiere_running && { QC_CODE=premiere_running; return 1; }
  while IFS= read -r version; do
    qc_valid_version "$version" || continue
    found=true
    if qc_host_supported "$version"; then supported=true; QC_HOST="$version"; fi
  done < <(qc_host_versions)
  if [ "$found" = true ] && [ "$supported" = false ]; then QC_CODE=unsupported_host; return 1; fi
  # Custom host installation locations are left to Adobe's compatibility check.
  # Refuse to replace a known, unsigned developer bridge on a testing Mac.
  local folder
  for folder in "$HOME/Library/Application Support/Adobe/CEP/extensions"/*; do
    [ -f "$folder/CSXS/manifest.xml" ] || continue
    if /usr/bin/grep -q 'ExtensionBundleId="com.quickcaption.premiere.bridge.qa"' "$folder/CSXS/manifest.xml" &&
      [ ! -f "$folder/META-INF/signatures.xml" ]; then QC_CODE=development_bridge_present; return 1; fi
  done
  QC_CODE=ready
}
qc_registered() {
  printf '%s\n' "$QC_OUTPUT" | /usr/bin/grep -Eq "^[[:space:]]*Enabled[[:space:]]+Quick Caption Timeline Bridge QA[[:space:]]+1[.]0[.]1[[:space:]]*$" &&
    printf '%s\n' "$QC_OUTPUT" | /usr/bin/grep -Eq "^[[:space:]]*Enabled[[:space:]]+Quick Caption QA[[:space:]]+1[.]0[.]1[[:space:]]*$"
}
qc_install() {
  qc_prepare_log || { [ "$QC_CODE" = installer_busy ] || QC_CODE=log_unavailable; return 1; }
  if ! qc_preflight; then qc_record; return 1; fi
  qc_record || { QC_CODE=log_unavailable; return 1; }
  local package
  for package in "QuickCaption-Timeline-Bridge-$QC_VERSION.zxp" "QuickCaption-Premiere-$QC_VERSION.ccx"; do
    # Recheck before each mutation: user may have reopened Premiere meanwhile.
    if qc_premiere_running; then QC_CODE=premiere_running; qc_record; return 1; fi
    case "$package" in *.zxp) QC_STAGE=bridge-install;; *) QC_STAGE=panel-install;; esac
    QC_CODE=installing; qc_record || return 1
    printf 'Quick Caption: %s\n' "$QC_STAGE"
    qc_run_adobe --install "$QC_RESOURCES/$package"
    QC_ADOBE_STATUS=$(qc_adobe_result "$QC_PROCESS_EXIT" "$QC_OUTPUT")
    if [ "$QC_ADOBE_STATUS" -ne 0 ]; then
      [ "$QC_CODE" = adobe_timeout ] || QC_CODE=adobe_rejected
      qc_record; return 1
    fi
    case "$package" in *.zxp) QC_BRIDGE=true;; *) QC_PANEL=true;; esac
  done
  QC_STAGE=verify-installation; QC_CODE=verifying; qc_record
  qc_run_adobe --list all
  if [ "$QC_PROCESS_EXIT" -ne 0 ] || ! qc_registered; then QC_CODE=registration_unverified; qc_record; return 1; fi
  QC_STAGE=complete QC_CODE=installed QC_ADOBE_STATUS=0
  qc_record || { QC_CODE=log_unavailable; return 1; }
}
qc_message() {
  case "$QC_CODE" in
    installed) printf 'ההתקנה הסתיימה. פתחו את פרימייר: Window → UXP Plugins → Quick Caption QA. התחברו לחשבון Quick Caption. גרסת QA.';;
    premiere_running) printf 'שמרו את הפרויקט וסגרו את פרימייר, ואז הפעילו שוב את המתקין.';;
    creative_cloud_missing) printf 'כלי ההתקנה של Adobe חסר. התקינו או עדכנו את Creative Cloud Desktop והפעילו אותו.';;
    invalid_package) printf 'החבילה חסרה או השתנתה. הורידו וחלצו אותה מחדש.';;
    unsupported_host) printf 'נדרשת גרסת Premiere Pro 25.6 ומעלה.';;
    unsupported_os|unsupported_platform|unsupported_architecture) printf 'נדרש Mac עם macOS 13 ומעלה, Intel או Apple Silicon, וגרסת פרימייר תואמת.';;
    installer_busy) printf 'מתקין אחר פועל או נקטע. אין שינוי נוסף. ראו README להנחיות.';;
    development_bridge_present) printf 'נמצא רכיב Quick Caption לא חתום מפיתוח קודם. יש לגבות ולהעביר אותו מחוץ לתיקיית CEP לפני ההתקנה. המתקין השאיר אותו כפי שהוא.';;
    adobe_timeout) printf 'Adobe לא השלים את הפעולה בתוך 5 דקות. אין אישור שההתקנה הושלמה.';;
    registration_unverified) printf 'Adobe לא אישר ששני הרכיבים מותקנים ופעילים. ההתקנה דורשת בדיקה.';;
    log_unavailable) printf 'אין אפשרות לכתוב דוח תקלה או לנעול את ההתקנה. בדקו את הרשאות תיקיית המשתמש.';;
    ui_unavailable) printf 'macOS לא הצליח לפתוח את חלון האישור. ההתקנה לא התחילה. הפיקו דוח דרך Quick Caption Diagnostics.command.';;
    *) printf 'Adobe סירב להתקנה או לא החזיר תשובה ברורה. קוד Adobe: %s. ייתכן שרכיב אחד כבר הותקן.' "$QC_ADOBE_STATUS";;
  esac
}
qc_dialog() {
  /usr/bin/osascript - "$1" <<'APPLESCRIPT'
on run argv
  display dialog (item 1 of argv) with title "Quick Caption Setup · Mac Beta" buttons {"OK"} default button "OK"
end run
APPLESCRIPT
}
qc_confirm() {
  /usr/bin/osascript <<'APPLESCRIPT'
display dialog "התקנת Quick Caption לפרימייר · גרסת QA ל־Mac.\n\nשמרו וסגרו את פרימייר. Creative Cloud צריך להיות מותקן ומעודכן.\n\nזו גרסת בטא שלא נבדקה עדיין על Mac אמיתי. החבילה מתקינה פאנל ורכיב הצבת כתוביות. אין שינוי בהגדרות האבטחה.\n\nדוח התקנה קטן נשמר מקומית למשך שבעה ימים. ניתן לשלוח אותו דרך Quick Caption Diagnostics.command." with title "Quick Caption Setup" buttons {"ביטול", "התקנה"} default button "התקנה" cancel button "ביטול"
APPLESCRIPT
}
qc_main() {
  local mode="${1:---gui}" result=0 message
  qc_init "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  case "$mode" in
    --verify) qc_check_payloads; return $?;;
    --preflight) qc_preflight; result=$?; printf '{"ok":%s,"code":"%s"}\n' "$([ "$result" -eq 0 ] && echo true || echo false)" "$QC_CODE"; return "$result";;
    --gui)
      if ! QC_CONFIRM_OUTPUT=$(qc_confirm 2>&1); then
        # AppleScript cancellation is -128; other UI failures need a report.
        [[ "$QC_CONFIRM_OUTPUT" = *'(-128)'* ]] && return 0
        qc_prepare_log; QC_CODE=ui_unavailable; qc_record; qc_finish
        qc_message; printf '\nReport: %s\n' "$QC_ID"; return 1
      fi;;
    --install) ;; *) printf 'Usage: installer.sh [--gui|--install|--verify|--preflight]\n'; return 2;;
  esac
  trap 'qc_finish' EXIT
  trap 'QC_CODE=interrupted; qc_record; exit 130' INT TERM HUP
  qc_install || result=1
  message=$(qc_message)
  if [ -n "$QC_ID" ]; then message="$message
מזהה דוח: $QC_ID
להפקת הדוח הפעילו Quick Caption Diagnostics.command."; fi
  if [ -n "$QC_ID" ] && [ "$QC_CLEANUP" = false ]; then message="$message
macOS לא אישר מחיקה מתוזמנת של הדוח. אחרי שליחתו לתמיכה ניתן למחוק את last-install.json לפי README."; fi
  if [ "$mode" = --gui ]; then qc_dialog "$message" >/dev/null 2>&1; else printf '%s\n' "$message"; fi
  return "$result"
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then qc_main "$@"; exit $?; fi
