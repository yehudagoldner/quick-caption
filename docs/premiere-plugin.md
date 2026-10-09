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
  An unresolved earlier upload also blocks a new transcription until its outcome is
  known, preventing a user retry from inadvertently creating a second billed job.
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
4. Select one or more existing timeline clips, including their audible audio items.
   Invoke Window > UXP Plugins > Quick Caption QA > קבלת כתוביות לקטעים שנבחרו,
   or press the same button in the plugin panel. The documented UXP command entrypoint
   appears in this menu; this build does not insert a command in Premiere's native
   timeline right-click menu.
5. If the account is disconnected, the plugin opens browser pairing and resumes the
   captured selection after the user confirms the matching code and account.
6. First use asks for an existing Waveform Audio `.epr` preset. Its persistent file
   permission is saved; this is export configuration, not another media file. On this
   Windows installation the Adobe preset is at `C:\Program Files\Adobe\Adobe Premiere Pro 2025\MediaIO\systempresets\3F3F3F3F_57415645\Waveform Audio 48kHz 16-bit.epr`.
   The plugin automatically prepares a temporary WAV from the selected timeline items.
   No extra clip import, media picker, output folder or manual duration entry is needed.
   Only a positively identified temporary sequence clone is edited. Unselected clips
   are removed from it, gaps are compacted and the original sequence is preserved.
   The source items, timing and playback settings are checked before export and upload.
   Complete WAV size/header validation must pass before any upload is possible.
7. The duration is derived from the union of selected ranges, counting linked audio/video
   once and omitting gaps. Select the spoken language and review the server quote.
   The server probes the actual media duration on upload and performs its authoritative
   credit check again. The quote is an estimate, not a maximum-price guarantee.
8. Confirm transcription. On completion choose a permanent SRT destination and import it.
   Captions are mapped back to the original timeline positions, splitting cues at omitted
   gaps. Return to the original sequence; changed selected clips block automatic mapping.
   Drag the imported SRT from the Project panel into the timeline at sequence time zero
   to create captions with their mapped offsets.
   Existing saved videos and local guest SRT files can also be imported.

Premiere 25.6's documented UXP API supports SRT project import but does not expose a
documented API for creating and filling caption tracks. This beta therefore requires the
final drag into the timeline. Export presets are chosen by the user; no fabricated preset
or undocumented host method is bundled. On Premiere 25.6.6, plugin loading, the native
command, account pairing/restoration, the library, selected linked audio/video capture,
WAV export and a live QA quote have been verified. The current full `amit` selection
received an estimate of 66 credits with a 64-credit balance; upload was correctly disabled.
No paid transcription was submitted. Multiple disjoint selections have automated host
fixture coverage; actual disjoint export, paid transcription and SRT import still need
host verification before distributing a `.ccx` built using UDT.

## Verification and rollout

Local fixture checks:

```
npm run build
node --test tests/plugin-policy.test.mjs tests/plugin-client.test.mjs tests/plugin-selection.test.mjs tests/model-credit-calculator.test.mjs tests/transcription-jobs.test.mjs tests/video-security.test.mjs
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
