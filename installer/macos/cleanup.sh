#!/bin/bash
# One small installation report, not project assets or Adobe's logs. Hourly
# launchd cleanup expires it even when the installer is never opened again.
qc_expire_report() {
  local report="$1" now="$2" expires bytes
  [ -f "$report" ] && [ ! -L "$report" ] || return 0
  bytes=$(wc -c < "$report") || return 1
  expires=$(sed -n 's/.*"expiresAt":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$report")
  if [ "$bytes" -gt 8192 ] || ! [[ "$expires" =~ ^[0-9]{1,12}$ ]] || [ "$expires" -le "$now" ]; then
    rm -f "$report"
  fi
}
qc_cleanup_main() {
  local state="$HOME/Library/Application Support/Quick Caption/Installer"
  [ ! -L "$state" ] || return 1
  qc_expire_report "$state/last-install.json" "$(date +%s)"
  # A completed cleanup job need not remain registered after its report expires.
  # Keep the tiny helper for subsequent installer runs; never touch other data.
  if [ ! -e "$state/last-install.json" ] && [ ! -d "$state/install.lock" ]; then
    local agent="$HOME/Library/LaunchAgents/com.quickcaption.installer-log-cleanup.plist"
    [ ! -L "$agent" ] && rm -f "$agent"
    /bin/launchctl bootout "gui/$(/usr/bin/id -u)/com.quickcaption.installer-log-cleanup" >/dev/null 2>&1 || true
  fi
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then qc_cleanup_main; fi
