# Quick Caption Premiere plugin — QA beta

The source is in `premiere-plugin/`. This development build connects only to
`https://quick-caption.com/qa`. It requires Premiere 25.6 or newer, UXP
Developer Tool 2.2 or newer, and the companion in `premiere-bridge/` for automatic
caption-track creation. It has not been submitted to Adobe Marketplace.

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
  The plugin computes a displayed estimate from versioned public rules fetched
  with the account; balance and final charging stay authoritative on the server.
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
- `pluginPolicy()` publishes defaults, languages, media limits, protocol compatibility
  and `creditEstimate` v1 (current audio and correction rates, token rounding and
  USD per credit). `src/creditEstimate.js` is copied to UXP by
  `node scripts/build-premiere-shared.mjs`. Tests compare local estimates with
  server quotes across model/tier changes and rounding boundaries.
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
   For this local QA checkout, run `node scripts/install-premiere-bridge.mjs`.
   This copies the invisible CEP companion to the current user's Adobe extensions
   folder and pairs it with UXP using a random local key. The key is ignored by Git
   and must never be included in a shared package. The installer preserves an
   existing key and does not change registry or security settings.
   This Windows installation uses CEP 12. To test unsigned development code, the
   user must manually enable Adobe's CEP development preference (`CSXS.12`, string
   `PlayerDebugMode=1`), for example by reviewing and importing
   `scripts/enable-premiere-bridge-dev.reg`. Save work and restart Premiere.
   Unload/Load UXP after changing its manifest so the loopback permission is parsed.
   The invisible companion starts on Premiere's ApplicationActivate event; it has
   no extra panel or account login. Production distribution requires signed CEP
   packaging and installation pairing, not disabling signature checking.
4. Select one or more existing timeline clips, including their audible audio items.
   Invoke Window > UXP Plugins > Quick Caption QA > קבלת כתוביות לקטעים שנבחרו,
   or press the same button in the plugin panel. The documented UXP command entrypoint
   appears in this menu; this build does not insert a command in Premiere's native
   timeline right-click menu.
   For a compact shortcut, open the `CC · כתוביות` panel from the same plugin menu
   and drag its panel tab beside Premiere's Tools panel. This is a separate dockable
   panel, not an added native editing tool. Its blue CC button opens the main panel
   and shows a locally computed price for the current selection; it never confirms a paid upload.
   If a job is awaiting completion or placement, the shortcut opens that job instead
   of preparing another selection. Both panels share the same account and state.
   On Premiere 25.6.6 the panel tabs use the plugin name, and a newly opened main
   panel can inherit a floating size. The UXP API does not expose a dock-position
   setter: drag the panel's tab (not the OS title bar) to the outside edge until
   Premiere shows a full-height docking zone, then save a custom workspace.
   The shortcut does not call `showPanel` again while the main panel is visible.
5. If the account is disconnected, connect it through browser pairing and confirm
   the matching code and account. The selection and estimate refresh automatically.
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
   once and omitting gaps. Choose subtitle length (7–20 characters including spaces,
   1–30 words, or unrestricted), the primary transcription language and optional
   additional spoken languages. Choose original scripts, translation of non-primary
   speech into Hebrew, or phonetic transliteration of non-primary speech into Hebrew.
   The primary language is preserved in all three modes, matching the website.
   Character mode defaults to 20 and keeps words whole; word mode initially uses 5.
   A slider and numeric field control the chosen limit. Additional languages have a
   searchable checkbox list; the primary language cannot also be an additional one.
   These preferences persist locally across plugin reloads. Live policy determines
   the available languages/modes without replacing user choices on balance refresh.
   The selected duration and price refresh without exporting audio or requesting a
   server quote. Click `יצירת כתוביות · כ־N קרדיטים` once: preflight, server admission,
   audio preparation, upload, transcription and timeline placement run automatically.
   The server quote is requested internally after that click and must match the
   displayed policy version and price. Selection, settings, policy or price changes
   stop before paid submission and require approval of the updated display.
   The server probes the actual media duration on upload and performs its authoritative
   credit check again. The quote is an estimate, not a maximum-price guarantee.
8. On completion the companion writes a permanent SRT in
   `%APPDATA%/Quick Caption/Premiere Bridge QA/captions`, imports the exact file and
   calls Adobe's `createCaptionTrack` on the original sequence. No save picker,
   media import, or manual timeline drag is part of this flow.
   Captions are mapped back to the original timeline positions, splitting cues at omitted
   gaps. The original project must be open; changed selected clips block placement.
   Another active sequence does not redirect delivery. Existing audio/video and caption
   tracks are preserved; captions are added as a new track. UXP confirms one new track
   ID and actual caption items before reporting success. An empty new track keeps the
   completed job available for placement recovery and cannot report a successful delivery.
   The success message identifies the native track label (for example C5) and actual cue
   count. On reload it restores this summary only when the original project/sequence and
   nonempty delivered track still exist. The main panel shows the timeline action and connected
   balance; account settings are collapsed, and unrelated video history is not loaded.
   If placement is interrupted, the saved completed job remains available through
   the same primary button, `נסיון חוזר · ללא חיוב נוסף`. This retries delivery,
   never the paid transcription. Active words also place automatically; there is
   no separate placement step. One indeterminate progress bar accompanies the
   current stage and disappears on completion or failure.

Premiere 25.6's UXP API does not expose `createCaptionTrack`. Adobe's official CEP
PProPanel sample demonstrates this ExtendScript method. The companion uses that API;
it does not use QE, mouse automation, or simulated dragging. Its HTTP listener binds
only to 127.0.0.1:37289. UXP requests the exact manifest-authorized
`http://localhost:37289` address: this Premiere runtime rejected the IPv4-literal
manifest permission even after Unload/Load. The listener accepts only the matching
localhost or 127.0.0.1 Host header, requires the installation key, rejects browser origins, and
has only health, target-validation and delivery routes. It accepts SRT content, not
arbitrary scripts or caller-supplied output paths. No cloud credentials reach CEP.

Delivery is serialized, identified by the existing job/video ID and journaled before
host mutation. A replay returns the existing receipt. A crash after an ambiguous host
commit is recovered from host memory when possible; otherwise it stops for inspection,
rather than risk duplicate tracks. A changed payload cannot reuse a committed delivery ID.
Source SRT files and receipts are persistent and are not deleted by the installer.

If the companion is unavailable during selection preparation, the panel clears the
audio-preparation text and offers a local connection check before another attempt.
No export, quote or paid upload proceeds while this dependency is unavailable.
The manual Windows development opt-in file is UTF-16LE with CRLF for Registry Editor;
the installer never imports it or changes signature-verification settings itself.

On Premiere 25.6.6, loading, the native command, account pairing/restoration, selected
linked audio/video capture, WAV export and a live QA quote were verified in earlier
work. The user has since completed a paid transcription. Automatic delivery currently
has local HTTP, real-JSX fixture and UXP panel regression coverage. On 2026-10-10 the
user's CEP 12 development opt-in was confirmed, the running companion returned host
version 25.6.6, and a read-only `/prepare` call validated both real A/V clips in the
saved QA sequence (GUID, source path, start/end/in/out ticks, speed and enabled state).
The user enabled the separate UXP developer preference and restarted Premiere.
Actual UXP-to-companion validation and caption creation passed on 2026-10-10 in
`QuickCaption_QA_20261009.prproj`: caption-track count changed from 0 to 1,
and replaying the same fixed delivery ID left the count at 1. Two local fixture cues
appeared on the original sequence at 2–4 and 10–12 seconds; saved project XML
confirmed timing within one sequence frame, and Hebrew text was visible in the
Program monitor. This test used no cloud transcription or credits. Its test captions
remain in the QA project for inspection.

Real-host compatibility fixes normalize UXP's numeric reversal flag to a boolean
and compare Windows extended-length project/media paths with equivalent ordinary
ExtendScript paths, preserving UNC server/share identity. The native panel's blue
button then prepared the selected audio and displayed the live QA estimate of
3 credits, with the connected balance still 114. The paid confirmation was not clicked.
Post-export validation confirmed both original A/V items unchanged and only one
sequence remaining, so the temporary export clone was cleaned up.
The new full paid completion flow has panel regression coverage; it has not been
rerun with another charged transcription. All 51 local plugin tests passed (55 including
the website transcription-settings parser tests).

The compact CC panel was loaded and docked immediately beside the native Tools
panel on 2026-10-10. Clicking it opened the main panel, prepared the selected linked
A/V items and displayed a live QA quote of 3 credits without a new login. The main
panel was docked in the left Learn area for readable controls. The connected balance
was 112 at this later check; the paid confirmation was not clicked. Existing captions
and the user's unsaved project changes were preserved.

The website's length and multilingual controls were added to the native panel on
2026-10-10. Premiere 25.6.6 verified word-mode slider updates, additional-language
selection and restoration after Reload, and original/translation/transliteration
buttons with their contextual help. The upload settings were verified with a mocked
request parsed by the real website settings parser, including character, word and
unrestricted modes. This verification did not submit another paid transcription.

A later reported automatic-placement failure was a timeline viewport issue: native
inspection found C1–C3 empty and C4/C5 with 18 real caption items each. The latest saved
job had a delivered receipt for C5, and its Hebrew text was visible in the Program monitor.
The native caption-area vertical scrollbar was moved upward to expose C4/C5. No delivery
was repeated, track created or transcription submitted. After Reload, the updated panel
confirmed 18 captions in C5 and restored the placement summary. This build reports the
track location; it does not automatically change Premiere's vertical timeline viewport.

Adobe references:
- https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/jsx/PPRO/Premiere.jsx#L2725
- https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md
- https://developer.adobe.com/premiere-pro/uxp/plugins/tutorials/add-panels/

## Verification and rollout

Local fixture checks:

```
npm run build
node --test tests/plugin-policy.test.mjs tests/plugin-client.test.mjs tests/plugin-selection.test.mjs tests/plugin-panel.test.mjs tests/plugin-caption-placement.test.mjs tests/plugin-settings.test.mjs tests/plugin-bridge.test.mjs tests/model-credit-calculator.test.mjs tests/transcription-jobs.test.mjs tests/video-security.test.mjs
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
