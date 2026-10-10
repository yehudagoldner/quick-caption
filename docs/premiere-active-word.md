# Active words in Premiere

In the existing Quick Caption panel, enable **הדגשת המילה הפעילה**, choose a
highlight color, then prepare and approve a transcription of the selected clips.
The result is placed automatically on a new video track. Each caption is one
nested sequence, containing consecutive native Premiere text graphics. Each
internal clip displays the complete caption and highlights its current word.
Pauses retain the caption without a highlighted word.

New active-word jobs keep the already-rendered selection WAV in the plugin's
persistent `PluginData/reference-audio` folder. Each internal sequence includes
the matching audio interval on A1, including offsets across disconnected selected
ranges. This provides playback and Premiere's waveform for timing edits. The
original audio still supplies the main sequence mix; audio inserted alongside our
nested graphics on the reserved new master track is removed to avoid duplication.
Do not delete reference WAV files while their projects are in use.

Existing graphics can be upgraded with **הוספת סאונד לכתוביות הקיימות**. This
adds only reference audio inside the job's verified native sequences; existing
word edits and master timeline trims are preserved. The job bin must be unique,
contain every recorded nested source, and correspond to the original caption
placements. Existing user audio is never replaced. A retry fills only empty nests
and retains already-added reference clips without duplicate audio. Interrupted
jobs reuse their saved WAV; if it is missing, the plugin can render the selection
again locally without a new paid transcription.

To correct timing, double-click a caption clip in the main timeline. Inside the
nested sequence, use Premiere's **Rolling Edit** tool to move the shared boundary
between adjacent word states. The full sentence remains one clip in the main
timeline. Use **Properties** to edit the native text graphics; a text change
should be applied to each word state containing that sentence. This is a video
graphic workflow, rather than a native caption-track styling effect.

Premiere 25.6's supported UXP/ExtendScript APIs expose no timeline zoom or track
height setter. The panel shows the default shortcuts: click the timeline and use
`\` to fit the sentence, `Ctrl + =` to increase video track height, and `N` to
adjust the word boundary. The plugin does not send simulated keystrokes or change
the user's workspace to force these view preferences.

The option is recorded with a new transcription job. Delivery and recovery use
that recorded choice. An existing completed regular-caption job is not converted
by changing the next job's setting. The feature uses the account's existing
subtitle and word timing data; it adds no transcription request or server change.
Word alignment follows the website's current `src/wordAlignment.js` rules. After
changing those rules, regenerate the bridge copy with:

```powershell
node scripts/build-bridge-alignment.mjs
```

## Implementation and recovery

- The local CEP bridge constructs editable MOGRT assets from the user's installed
  Adobe **Classic Web Caption** template. It does not modify or ship Adobe's
  template. Native Source Text access is incomplete in Premiere 25.6, so the
  generator uses the template's internal project format. Schema and compatibility
  checks run before a paid upload. A future Adobe format change may require an
  update to this generator.
- Assets and receipts live in the existing per-user **Quick Caption/Premiere
  Bridge QA** directory. A clean imported sequence contains the word graphics,
  without inheriting existing caption tracks or footage.
- Video and any temporary nested audio use newly reserved tracks. Only audio
  clips belonging to these new nested sequences are removed. Source media is
  validated before and after placement.
- The plugin saves its destination and owned sequences before insertion. A retry
  inserts only missing phrases. Moved, duplicated or missing sources and occupied
  destination tracks stop recovery for inspection. An ambiguous bridge build
  does not blindly create another set of sequences.
- The bridge reloads only its own installed JSX source between requests and keeps
  its host delivery receipts. Node-side bridge updates take effect at the next
  Premiere restart. UXP changes can be reloaded with Developer Tools.

## Validation on 2026-10-10

Native test in Premiere **25.6.6**, **1920×1080**:

- A rendered Hebrew caption showed only **רוצה** highlighted in yellow.
- Two caption phrases, each containing three native word states, were built and
  inserted into a positively identified temporary copy on **V4**.
- Repeating placement retained two caption clips without duplication.
- All original timeline audio/video fingerprints were unchanged.
- Temporary sequences and their owned test bin were removed.
- No model calls, transcription uploads, account credit deductions or server
  deployments were used in this test.

Reference-audio validation used the open project's rendered selection in a
temporary copy on V5. Both sentence intervals matched the source WAV, master
audio remained unchanged, and both ordinary placement and the legacy audio
upgrade replayed without duplicates. The import's one-frame end truncation was
corrected with explicit native audio clip bounds. Video ProjectItem out bounds
use exact tick strings to avoid a separate floating-point frame truncation.
All owned compatibility bins, reference WAVs, graphics assets and receipts were
removed after verification. The existing 14 sentence nests in the user's project
were then upgraded; each contains one reference clip, with zero nested reference
audio clips in the master sequence. No paid transcription was performed.

Automated tests cover selection gaps, Unicode spans, corrected caption text,
archive integrity, timing alignment, dedicated tracks, persistence failures,
interrupted builds and placement, locked settings and the existing SRT workflow.
The full plugin suite passed **74 tests**, including durable WAV recovery,
disconnected-range mapping, legacy upgrade ownership, retained edits and refusal
to create duplicate master audio.

The earlier recovery point remains
`checkpoint/before-active-word-20261010`; see [recovery-point.md](recovery-point.md).

## Point-cue recovery and one-click flow

The two-selected-clip transcription (QA video 36) contained a cue at
156.419998 seconds with identical start/end. Native clips require a duration.
`normalizeCaptionTiming` preserves that word with up to 300 ms from the free
adjacent gap. When no whole-frame gap exists, it joins a touching timed cue,
preserving text rather than dropping the word or overlapping clips. Negative
intervals, duplicate identities and overlapping timed captions remain errors.
Both UXP and the bridge use the generated normalization copy; UXP normalization
also repairs completed jobs while an installed companion still runs its old
Node module. The original account captions are not overwritten.

The existing completed job was recovered into 67 native sentence nests on V4,
without retranscription or another charge. Native graphic construction exceeded
the former one-minute client timeout; graphics requests now allow 20 minutes,
and timeout messages no longer misdiagnose a slow build as an unloaded bridge.
Receipt replay retained the built sequences for recovery without duplication.

The main action displays a local, policy-based credit estimate before the click.
After one click, transcription and native placement proceed with one progress
indicator. Failed placement reuses that action for an explicitly uncharged retry.
Docking is controlled by Premiere's workspace. UXP provides preferred sizes,
not a forced side/full-height dock API; keep the panel's existing entrypoint and
dock its tab once at the outside edge, then save the workspace.

This update passed 87 plugin tests and 5 credit-accounting tests locally. The
pricing-only QA commit `9751ba9` was applied in place to the existing checkout:
build and 12 relevant tests passed there, with public health/HTML/assets and
Socket.IO verified. Production and the other PM2 applications were unchanged.
