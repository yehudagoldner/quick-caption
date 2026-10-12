# Premiere production distribution

Version 1.0.3 supports separate QA and production builds from the same source.
Set `PREMIERE_CHANNEL=production` when running both
`node scripts/build-premiere-installer.mjs` and
`node scripts/build-premiere-mac-installer.mjs`. Omit it for QA.

Production packages are emitted into `artifacts/premiere-installer-production`
and `artifacts/premiere-installer-mac-production`. The build verifies the Adobe
signature, package checksums, channel and manifests before creating installers.
Windows and macOS installers use the same verified Adobe packages.

Production uses `https://quick-caption.com`, UXP ID
`com.quickcaption.premiere`, CEP ID `com.quickcaption.premiere.bridge`, and
local port 37290. Its private per-user pairing file is
`~/.quick-caption/premiere-production/connection.json`. QA keeps its `.qa`
plugin IDs, `/qa` service, port 37289 and separate pairing file. Production
requires a fresh account connection; QA account tokens are not migrated.
The local bridge only communicates with Premiere on the editor's computer.

Publish the Windows EXE, Windows ZIP, Mac Beta ZIP and their `SHA256SUMS` into
`/home/quick-caption/plugin-downloads` (or `PREMIERE_DOWNLOAD_DIR`). QA uses
`/home/quick-caption-qa/shared/plugin-downloads`. Never copy QA installers to
the production download directory. The public entry point is `/premiere.html`.

Both distributions remain beta: Windows has no Authenticode publisher
signature, and the Mac wrapper is not Apple signed/notarized or validated on a
physical Mac. Do not describe the generated archive as native Mac validation.
The tutorial is explicitly labeled as a QA recording.

Diagnostic reports remain private beside the persistent media directory and
are pruned by the running server. Install the corresponding diagnostics cron
as an idle fallback. Preserve the existing production video signing key and
take a protected database backup before first enabling the new plugin tables.
