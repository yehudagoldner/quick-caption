#!/bin/bash
# Read/export only the bounded, sanitized installer report. No account or media.
qc_report="$HOME/Library/Application Support/Quick Caption/Installer/last-install.json"
if [ ! -f "$qc_report" ] || [ -L "$qc_report" ] || [ "$(wc -c < "$qc_report")" -gt 8192 ]; then
  printf 'No installation report is available. It may have expired after seven days.\n'
  read -r qc_answer; exit 1
fi
qc_expires=$(sed -n 's/.*"expiresAt":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$qc_report")
if ! [[ "$qc_expires" =~ ^[0-9]{1,12}$ ]] || [ "$qc_expires" -le "$(date +%s)" ]; then
  printf 'The installation report has expired. Run the installer again to reproduce the issue.\n'
  read -r qc_answer; exit 1
fi
/usr/bin/osascript - "$qc_report" <<'APPLESCRIPT'
on run argv
  set reportFile to POSIX file (item 1 of argv)
  set reportText to read reportFile as «class utf8»
  display dialog "דוח ההתקנה מכיל רק גרסה, שלב, קוד תקלה ומזהה דיווח. אין סיסמאות, חשבון או תוכן וידאו.\n\nאחרי אישור, בחרו איפה לשמור ושלחו את הקובץ לתמיכה. העותק שתשמרו יישאר עד שתמחקו אותו; המקור נמחק אוטומטית." with title "Quick Caption Diagnostics" buttons {"ביטול", "שמירת דוח"} default button "שמירת דוח" cancel button "ביטול"
  set destination to choose file name with prompt "שמירת דוח לתמיכה" default name "QuickCaption-Mac-install-report.json"
  set outputFile to open for access destination with write permission
  try
    set eof outputFile to 0
    write reportText to outputFile as «class utf8»
    close access outputFile
  on error messageText number errorNumber
    close access outputFile
    error messageText number errorNumber
  end try
end run
APPLESCRIPT
