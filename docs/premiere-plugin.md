# Quick Caption Premiere plugin — QA beta

The source is in `premiere-plugin/`. This development build connects only to
`https://quick-caption.com/qa`. It requires Premiere 25.6 or newer and UXP
Developer Tool 2.2 or newer. It has not been submitted to Adobe Marketplace.

## Account and credit contract

- Firebase/Google authentication occurs in the browser. The user explicitly confirms
  the displayed pairing code and account; the plugin never receives a Google password
  or Firebase token.
- Pairing expires after 10 minutes and can be consumed once. Device secrets and tokens
  are random; only their SHA-256 hashes are kept in MySQL. Links in browser URLs contain
  only the challenge ID and matching code, never credentials.
- Access tokens last 15 minutes, refresh tokens rotate and expire after 30 days.
  Plugin credentials are kept in UXP secureStorage. Disconnect revokes the server session.
- Website and plugin operate on the same verified user UID and `users.credits` record.
  No balance or price formula is stored in the plugin.
- Quote and upload pre-check both use `currentTranscriptionModels()` and the existing
  `estimateTranscriptionCredits()`. Final billing goes through the existing atomic
  `completeTranscriptionJob()` transaction, using actual AI usage and the existing
  insufficient-balance policy. This change does not redefine that policy.
- Every plugin upload has a saved job ID. Completion replay and repeated submission
  of that ID cannot bill twice. After a network interruption, check/resume that job;
  never automatically submit a second paid POST.
- Balance is fetched immediately on connection, refresh, return to the panel/window,
  and job completion, plus every 30 seconds while the window/panel is visible.
  An unavailable balance is displayed as unknown, not as a current cached number.
  Upload admission and the final deduction still use the current server balance.
- `pluginPolicy()` publishes defaults, languages, media limits and protocol compatibility.
  Its version hashes the pricing, package, usage, transcription setting and media policy
  sources plus current model configuration. A changed version invalidates a pending quote;
  the server rejects a plugin upload with the old version before any paid processing.
- Future pricing changes belong in the shared server policy modules, with quote/billing
  regression tests. Keep API v1 additive; a breaking contract requires updating both the
  minimum supported plugin version (`PLUGIN_MIN_VERSION`) and the API implementation. The
  server checks `X-Quick-Caption-Version` before paid processing. Do not add plugin-only
  formulas. New business rule modules must also be included in the version fingerprint.
- Subtitle export uses the same SRT serializer as the website and reads the latest saved
  captions by owner on each import. Plugins cannot access admin or payment APIs.

## Load and use

1. Install Adobe UXP Developer Tool from Creative Cloud.
2. Enable developer mode in UDT and Premiere Settings > Plugins, then restart Premiere.
3. Add `premiere-plugin/manifest.json` to UDT and choose Load & Watch.
4. Open Window > UXP Plugins > Quick Caption QA.
5. Connect your account, confirm the matching code in the browser, then return to Premiere.
6. Export the active sequence using an existing `.epr` preset (prefer an audio preset).
   The full sequence is exported; wait for Premiere's export to finish and choose the
   generated media file. Alternatively choose an existing media file.
7. Set the estimated duration in seconds, select the spoken language and fetch a quote.
   The server probes the actual media duration on upload and performs its authoritative
   credit check again. The quote is an estimate, not a maximum-price guarantee.
8. Confirm transcription. On completion choose a permanent SRT destination and import it.
   Drag the imported SRT from the Project panel into the timeline to create captions.
   Existing saved videos and local guest SRT files can also be imported.

Premiere 25.6's documented UXP API supports SRT project import but does not expose a
documented API for creating and filling caption tracks. This beta therefore requires the
final drag into the timeline. Export presets are chosen by the user; no fabricated preset
or undocumented host method is bundled. Live Premiere export/import still needs host
verification before distributing a `.ccx` built using UDT.

## Verification and rollout

Local fixture checks:

```
npm run build
node --test tests/plugin-policy.test.mjs tests/plugin-client.test.mjs tests/model-credit-calculator.test.mjs tests/transcription-jobs.test.mjs tests/video-security.test.mjs
npx playwright test tests/live-credits.spec.ts --project=chromium --workers=1
```

In the existing QA checkout only, with the isolated QA environment loaded:

```
node --test tests/plugin-sessions.mysql.test.mjs
```

That integration test uses only its own temporary QA users/jobs/captions, cleans them up,
checks pairing, concurrent token rotation, revocation, current balances, upload replay and
ownership through the real QA process, and makes no paid AI calls. No production rollout
or Marketplace publication is implied. Before production, run a real host/Google pairing
and a representative paid transcription, decide the intended business rules, package with
a stable production ID and production config, and explicitly authorize the production release.
