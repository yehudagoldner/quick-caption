# Premiere environment simulation and diagnostics

Implemented on 2026-10-10. Server deployment target is the existing QA only:
https://quick-caption.com/qa/. No transcription/model calls are needed for this suite.

## Run the simulation

```powershell
npm run test:premiere-portability
```

The suite executes the real ZIP/text generator, bridge bootstrap, ExtendScript
source in a mocked Premiere host, client flow, HTTP diagnostics and persistence.
Filesystem adapters supply Windows and POSIX path rules; fixtures do not emulate
an Apple CPU, OS permissions kernel, GPU, Adobe installer or native rendering.

| Environment / fault | What is verified |
| --- | --- |
| Windows default, relocated/Unicode home, absent APPDATA, UNC home | Correct data roots, extension paths, template lookup, bounded startup logs |
| Mac home with Unicode/spaces, case sensitive path rules | POSIX roots and paths, template decoding/generation; no Windows APPDATA leakage |
| QA/release plugin IDs, Developer/External, host folder 25/26.0 | Owned reference WAV accepted on both host path models; unrelated plugin rejected |
| Missing/corrupt/changed/ambiguous/unreadable template | Explicit preflight failure; no blind native build |
| Port occupied, IPv6-only localhost, unavailable network, denied manifest | Real port conflict plus simulated client errors identified; no native mutation |
| Older host API, invalid bridge response, interrupted native placement | Recoverable errors and replay of existing results rather than paid resubmission |
| Offline/revoked account, changed account, disabled local storage | Bounded diagnostics queue and isolation; no `/api/transcribe` from diagnostics |
| Server disk full/read-only, corrupt log, restart, expired/duplicate/flooded logs | Old data preserved on write failure; bounded file, expiry, account isolation |

Simulation can pass by correctly rejecting an unsupported condition. It does not
mean transcription succeeds with missing prerequisites. Remaining real-machine
checks include signed installation, Adobe template compatibility/rendering,
Hebrew layout, ArialMT availability/fallback, WAV EPR preset selection, and
macOS permissions. The IPv4 companion still uses fixed port 37289 and
`localhost`; IPv6-only resolution is diagnosed but not automatically repaired.

## Remote access from a different Mac

Failures in the running UXP panel produce a diagnostic UUID displayed with the
error. A sanitized report goes over HTTPS to
`POST /qa/api/plugin/diagnostics`, using the existing account session. The same
account can retrieve its reports through `GET /qa/api/plugin/diagnostics`.
The owner identity is derived by the server; supplying a different UID in a
request cannot change ownership. No media upload or credit debit is involved.

For this workspace's agent, use `quick-caption-deploy` to connect to the existing
QA host, discover the active `caption-qa` checkout, and run there:

```sh
node scripts/read-plugin-diagnostics.mjs --id <diagnostic-UUID>
```

The script prints only unexpired sanitized reports, without account hashes.
The private QA file is
`/home/quick-caption-qa/shared/plugin-diagnostics/reports.json`.
It is outside static assets. No new PM2 app/database/release directory is used.
Keep this file out of deployment archives and ad-hoc backups; persisted logs are
intentionally ephemeral. The previous QA checkout remains available for code
recovery without making a diagnostic archive.

Reports contain OS/architecture, plugin/host/bridge/runtime versions, template
fingerprint when available, capability flags, bounded workflow steps, timings,
counts, HTTP status/error codes and known source-file line numbers. They never
contain raw error messages/stacks, file paths, project names, subtitles, audio,
email addresses, access tokens or pairing keys. `fontVerified: false` explicitly
means font rendering has not been verified. `simulation: true` marks trial
reports sent while checking the remote transport.

## Automatic deletion and bounds

* Central reports expire **7 days after receipt**, at most **20 per account / 200 total**.
  The private JSON file is at most **1 MiB**. One fixed atomic-write temporary
  file can occupy another 1 MiB during a write; no per-report directories/files.
* Cleanup runs at startup, every **15 minutes**, and on reads/ingestion, even if
  no new errors arrive. Expired records cannot be retrieved. With QA stopped,
  startup removes expired records when service resumes. A QA-only hourly cron
  also deletes the fixed log files once untouched for seven days plus a
  15-minute safety margin, including when QA is stopped or rolled back.
  Duplicate IDs do not
  extend retention. Newest reports replace older ones at the configured limits.
* The offline UXP queue holds **10 reports**, expires after 7 days, prunes every
  30 seconds while the panel runtime runs, and is also pruned on startup. It
  retries only diagnostics, never a paid request. Upload attempts time out in
  5 seconds and are throttled to one batch per 30 seconds.
* Bridge startup errors use one local `diagnostics.json`, **32 events**, with a
  7-day TTL and 15-minute/startup pruning. The exact old unbounded `bridge.log`
  is removed by the new logger. Graphics/audio referenced by Premiere projects
  are persistent project assets and are not deleted as diagnostic logs.

A disconnected/offline account cannot upload immediately; reports wait for
successful login/network recovery within their local TTL. A plugin that never
loads cannot execute this logger. If the bridge cannot bind its port, the panel
can centrally report `bridge_unavailable`; the more specific startup event is
local until the authenticated bridge becomes reachable. Native Adobe/UDT loading
logs may still be needed for failures before our code runs. The server marks
device clock skew and uses its own clock for expiry.

The Mac beta installer has a separate, pre-login diagnostic report. It writes
one sanitized `last-install.json` under the user's Library/Application Support/
Quick Caption/Installer, with stage, Adobe status, architecture and versions.
An hourly user LaunchAgent expires it after seven days and unregisters itself
when no report remains; `cleanupScheduled` records whether macOS accepted it.
`Quick Caption Diagnostics.command` exports that report for attachment here
when the panel cannot load on a different Mac. The exported copy is user-owned.
Installer UUIDs alone are not central lookup keys before authenticated login.
No anonymous endpoint or additional server logs were introduced. See
[Mac installer instructions](premiere-installer-mac.md).

## Verification recorded on 2026-10-10

* Full Premiere/accounting/simulation suite: **164 passed**, no skipped tests,
  both locally on Windows and in the existing Linux QA checkout. QA frontend
  build, public HTML/asset hashes, health and Socket.IO passed; other PM2 apps
  were unchanged. No model/transcription calls were made.
* QA server commit: `a0a26f1485afbf65f09f110f94f5d9b4545a6f5e`.
  Active checkout remained `/home/quick-caption-qa/release-5b0b112-BxZQD2bs`.
* The running Premiere 25.6.6 UXP panel loaded the new logger and sent two
  explicitly synthetic reports: Windows x64 and Mac arm64. They were read
  through the account API and independently through SSH from this workspace.
  The synthetic Mac report validates transport/reading, not Mac-native loading.
* The server held one private file of **1,222 bytes**, directory mode 0700,
  file mode 0600; expiry was 2026-10-17. Cron source matched its installed
  QA-only configuration and cron was active. Account balance stayed 74 credits.
* The local bridge source was installed with its existing pairing key preserved.
  Restart Premiere once after saving the project to activate the updated CEP
  bootstrap/logger; the UXP panel logger is already active after its reload.
