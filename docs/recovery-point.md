# Checkpoint before active-word Premiere work

Git tag: `checkpoint/before-active-word-20261010`.

This checkpoint captures the current website/server code, remote account connection management, Premiere UXP panel, timeline-caption bridge, transcription settings and local legal-page changes before implementing active-word graphics. The proposed timing-editor preview is separate from the running plugin.

The Premiere/bridge suite passed 46 tests before this checkpoint. The account-connection release already passed its relevant build and QA tests. Active QA is commit `b3fa8af2a2503941b50fee3d74861ff9769d3b43`; creating this checkpoint does not deploy anything or change the database.

To inspect the snapshot without modifying files:

```powershell
git show --stat checkpoint/before-active-word-20261010
```

To continue from it, first preserve any later uncommitted work, then create a new branch:

```powershell
git switch -c codex/restore-before-active-word checkpoint/before-active-word-20261010
```

Normal Git ignores still apply: credentials, runtime pairing configuration, installed dependencies, generated builds and media are not committed. A Git checkout does not undo database changes, restore revoked sessions or switch a deployed server release. The QA database backup for connection changes remains protected at `/home/quick-caption-qa/shared/backups/connections-20261010-before.sql`.
