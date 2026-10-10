# Active words in Premiere

In the existing Quick Caption panel, enable **הדגשת המילה הפעילה**, choose a
highlight color, then prepare and approve a transcription of the selected clips.
The result is placed automatically on a new video track. Each caption is one
nested sequence, containing consecutive native Premiere text graphics. Each
internal clip displays the complete caption and highlights its current word.
Pauses retain the caption without a highlighted word.

To correct timing, double-click a caption clip in the main timeline. Inside the
nested sequence, use Premiere's **Rolling Edit** tool to move the shared boundary
between adjacent word states. The full sentence remains one clip in the main
timeline. Use **Properties** to edit the native text graphics; a text change
should be applied to each word state containing that sentence. This is a video
graphic workflow, rather than a native caption-track styling effect.

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

Automated tests cover selection gaps, Unicode spans, corrected caption text,
archive integrity, timing alignment, dedicated tracks, persistence failures,
interrupted builds and placement, locked settings and the existing SRT workflow.

The earlier recovery point remains
`checkpoint/before-active-word-20261010`; see [recovery-point.md](recovery-point.md).
