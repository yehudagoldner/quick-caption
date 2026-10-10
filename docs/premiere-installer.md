# Quick Caption independent beta installer

This build targets **Windows 10/11 x64, Premiere Pro 25.6 or newer**, with an
updated Adobe Creative Cloud Desktop installation. It connects to the existing
QA service, not production. It is a beta for installation testing, not a
Marketplace-approved release or a claim that every Premiere version works.

## Files and installation

`artifacts/premiere-installer/QuickCaption-Setup-1.0.1-Windows.exe` embeds both:

- `QuickCaption-Premiere-1.0.1.ccx`: UXP panel, standard root-manifest ZIP.
- `QuickCaption-Timeline-Bridge-1.0.1.zxp`: CEP companion, signed using Adobe
  ZXPSignCmd 4.1.3 and a private self-signed beta certificate.

For sharing, `QuickCaption-Installer-1.0.1-Windows.zip` contains the EXE,
this README, checksums and build metadata. The target user only needs the EXE.

Save the Premiere project, close Premiere, run the EXE, and click **התקנה**.
The installer calls Adobe's installed UnifiedPluginInstallerAgent for both
packages. Open Premiere, then **Window → UXP Plugins → Quick Caption QA**.
Log in to Quick Caption and authorize the connection on first use. Neither
Node.js, UXP Developer Tools, nor developer/debug mode is required on the target
computer. The installer does not change Adobe signature enforcement or OS
security settings, close Premiere, or delete project assets.

Creative Cloud or enterprise policies can still refuse installation. The EXE
has **no Windows Authenticode publisher signature** yet; the CEP package
signature is a separate Adobe requirement. Resolve publisher signing before a
public release. The beta CEP certificate has a three-year lifetime and this
build is not timestamped; rebuild/re-sign before its expiry.

The EXE checks embedded SHA-256 hashes and manifest identity before installation.
Adobe validates host compatibility and the ZXP signature. `--verify` checks
embedded payloads without installing; `--preflight` reports Creative Cloud,
running Premiere, and host versions found in standard Adobe locations or the
Windows App Paths registry. An unknown custom installation is left to Adobe's
installer to validate. The executable uses Windows' existing .NET Framework;
no extra .NET runtime is downloaded.

`--install` runs the same installation routine without the graphical window,
for automated testing or deployment. It refuses installation while Premiere is
running and emits a result with a diagnostic ID. No elevated/debug-mode
workaround is used.

UPIA can return process exit 0 after a failed install. The wrapper checks
Adobe's printed status and requires an explicit success message; unrecognized
results stop with code -10000 rather than claim success. This behavior was
verified against an intentionally invalid CCX on the installed Adobe tool.

An unsigned developer companion in the known per-user CEP folder is moved to
one `development-bridge-backup` directory under the installer directory before
installation. It cannot shadow the installed signed companion. On failure,
the old directory is restored if its original location is still absent. A
signed installation is left to Adobe's upgrade mechanism. Existing backups
are preserved; an ambiguous migration stops for review. Project caption,
graphics and reference-audio directories are always preserved.

## Runtime setup and remaining prerequisite

The CEP companion creates a private, random connection key on first launch in
`~/.quick-caption/premiere-qa/connection.json`. UXP reads that exact file using
the declared `fullAccess` file permission; it also uses this permission to
open Adobe's installed WAV presets without a picker. This is why installation
asks for file access. No pairing key, account token, user media, Adobe MOGRT,
or Adobe EPR preset is included in the distribution. The signed extension
bundle is never modified to add configuration. The local server uses explicit
IPv4, port 37289, token authentication and origin/host checks.

WAV presets are discovered from the running Adobe application's installed
`MediaIO/systempresets` directory and verified with EncoderManager. If none
can be used, the existing explicit EPR picker remains available.

**Active word still requires Adobe's Classic Web Caption motion graphics
template.** A fresh machine without it can use standard captions; active-word
preflight refuses processing before a paid transcription. Obtain the original
template through Adobe's graphics templates interface. Font availability and
native rendering still require real-machine verification.

## Diagnostics and support

After plugin login, sanitized failure reports use the existing authenticated
QA diagnostic endpoint. Reports from another computer, including a Mac, can
be retrieved here with `scripts/read-plugin-diagnostics.mjs --id REPORT_UUID`;
the existing server retention and size caps still apply. See
`docs/premiere-portability-diagnostics.md` for the complete privacy/expiry rules.

An installation failure before the panel can run cannot upload an authenticated
plugin report. Windows shows an Adobe exit code and an installer UUID, and
keeps one small `last-install.json` under
`%LOCALAPPDATA%/Quick Caption/Installer`. It contains only the UUID, installer
version, stage, exit code and timestamps. That pre-login report stays local
and must be supplied with a support request; its UUID alone is not a server
lookup. It is overwritten by the next attempt and removed at the next installer
start after seven days. No installer reports accumulate on the server.

## Rebuilding

Run `node scripts/build-premiere-shared.mjs`, then
`node scripts/build-premiere-installer.mjs` on Windows. The builder expects
Adobe's official 4.1.3 x64 signing binary at
`tmp/installer-tools/ZXPSignCmd.exe` and verifies its pinned SHA-256. Download
it from the Adobe CEP Resources repository. Signing material remains in
ignored `.local-secrets/premiere-signing/`; back it up privately. Never share
that directory or add its contents to Git. The builder uses temporary staging,
refuses symlinks, excludes local configs and non-code artifacts, verifies the
ZXP, compiles the installer and verifies its payloads. Output includes checksums
and build metadata. Source UI settings are preserved; only staged package
versions/configuration are changed for distribution.

## macOS

Runtime paths and failure cases have automated Mac simulations, but **this
Windows EXE is not a Mac installer**. Native Mac signing/installation and actual
Premiere rendering have not been verified. Adobe has documented cross-platform
CEP signing issues; this build does not advertise the Windows-signed ZXP as a
validated Mac release. Build/sign on a Mac and run the full installation,
Hebrew rendering, audio export and active-word workflow before publishing a
Mac package. A native notarized installer also requires an Apple Developer ID.

Official references:

- https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/package/
- https://blog.developer.adobe.com/en/publish/2022/03/how-to-install-uxp-plugins-using-command-line-tools
- https://github.com/Adobe-CEP/Getting-Started-guides/tree/master/Package%20Distribute%20Install
- https://github.com/Adobe-CEP/CEP-Resources/blob/master/ZXPSignCMD/KnownIssue2024.md

## Verification on 2026-10-10

- 179 automated tests passed, including 13 installer/archive/pairing tests and
  the new automatic WAV preset selection test.
- Adobe ZXPSignCmd verified the produced ZXP signature; the compiled EXE
  validated both embedded archives and its Adobe status parser.
- The installed Adobe UPIA rejected an intentionally invalid CCX with status
  -204 while its process exit was 0; this drove the status-parser regression check.
- Read-only preflight detected Creative Cloud and Premiere 25.6.6.5. Runtime
  file access and the private connection configuration were verified inside
  Premiere's UXP runtime. The installer UI was rendered and inspected without
  opening an interactive window.
- After the user closed Premiere, the compiled installer's shared installation
  routine successfully installed both packages through UPIA. Adobe listed both
  QA extensions as enabled at version 1.0.1. The installed CEP folder signature
  was independently verified and neither installed bundle contains a pairing key.
- The unsigned developer companion was preserved at
  `%LOCALAPPDATA%/Quick Caption/Installer/development-bridge-backup`.
- On relaunch, Adobe reported the UXP plugin in the ordinary `ThirdParty` runtime
  group, loaded from `UXP/Plugins/External`, rather than the development source.
  The installed CEP returned healthy version 1.3.0, reference-audio/native-graphics
  capabilities, and the expected installed WAV preset through authenticated HTTP.
- The computer already had Adobe developer settings enabled; those settings
  were left unchanged. Clean-machine installation with signature enforcement,
  native Mac installation/rendering, and an end-to-end caption workflow on the
  newly installed package remain unverified. No production deployment or paid
  model call was made.
