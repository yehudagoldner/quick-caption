#!/bin/bash
qc_directory="$(cd "$(dirname "$0")" && pwd -P)" || exit 1
/bin/bash "$qc_directory/Quick Caption Setup.app/Contents/Resources/installer.sh" --gui
qc_result=$?
if [ "$qc_result" -ne 0 ]; then printf '\nInstallation did not complete. Press Enter to close.\n'; read -r qc_answer; fi
exit "$qc_result"
