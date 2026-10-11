# Premiere QA downloads — 1.0.2

The QA download and installation page is https://quick-caption.com/qa/premiere.html.
The QA badge in the application links to it. The page is public so a tester can
download before connecting a Quick Caption account.

1.0.2 uses the manifest-authorized `http://localhost:37289` in the UXP client;
Premiere rejected `127.0.0.1` even when that literal was listed in the manifest.
The companion still binds to IPv4 and requires its private installation token.
The package preserves the current single-panel layout and pending-job recovery.

Build the shared sources, Windows packages and then the Mac wrapper with:

```sh
node scripts/build-premiere-shared.mjs
node scripts/build-premiere-installer.mjs
node scripts/build-premiere-mac-installer.mjs
```

The package version lives in `src/premiereRelease.js`. Keep both installer
version checks and page filenames in sync; `tests/premiere-downloads.test.mjs`
checks those boundaries. Only the Mac ZIP, Windows EXE and SHA256SUMS are
publicly downloadable. Neither signing material nor private pairing keys are
published. Never serve the package build directory as a general static root.

Verified packages are stored in `/home/quick-caption-qa/shared/plugin-downloads`.
The `/downloads/premiere` router is enabled only when `VITE_APP_ENV=qa`;
Apache preserves the public `/qa/` prefix and strips it before the app.
`PREMIERE_DOWNLOAD_DIR` can override the storage location. Upload to temporary
filenames, verify hashes, then rename before enabling the new application code.
Keep the previous package version for rollback. The code update uses the existing
QA checkout/process; no migration or extra server environment is needed.

The Mac beta remains unsigned/unnotarized by Apple and uses the Windows-signed
Adobe CEP package. Simulation and archive validation do not confirm installation
or rendering on a real Mac. See [Mac instructions](premiere-installer-mac.md).
