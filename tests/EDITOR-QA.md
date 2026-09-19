# Editor QA — 2026-09-19

## Follow-up: settings after transcription

- Upload now contains only file selection/drag-and-drop, preview and submit.
  New uploads use fixed defaults (20 characters, 5-word fallback, SRT), not
  hidden persisted editing settings.
- FPS, direction, character reflow and SRT/VTT/TXT download selection are in
  the result editor. No extra transcription request is needed for these changes.
- Browser checks confirmed 7-character reflow produced 12 clips, increasing to
  20 merged them to 5, and undo restored the previous 12. Moving the slider alone
  did not alter captions. A later manual text edit disabled the earlier undo;
  reflow kept the edited text rather than restoring original transcript words.
- Selecting VTT in the editor changed the download filename to
  `editor-check.vtt`. Five segmentation test groups now pass, including reflow,
  immutable undo inputs, pauses, Unicode, stale metadata and deleted words.
- The server key issue described below was subsequently traced to an inherited
  environment variable overriding `.env`. The server was relaunched without that
  stale variable, and the new key passed authentication. This authentication
  check alone is not a completed live transcription test.

## Scope and environment

Tested the local application on port 3000 and the actual editor components in
`http://localhost:5173/tests/editor-harness.html`, using the Codex in-app browser
and Chrome. The harness uses explicitly labelled fixture captions, not a real
transcript. Harness saves remain in memory and do not modify account records.
Its burn action uses the real local burn endpoint.

## Verified

- All three user-supplied Downloads videos loaded: 544×960 portrait, 1920×1080
  landscape, and 1080×1080 square. Originals were not modified.
- Portrait editing at a 390×844 browser viewport preserved the media aspect ratio
  and had no document-level horizontal overflow. Landscape and square previews
  also fit their stages.
- WAV (8-bit/22.05 kHz, 24-bit/48 kHz, 32-bit float/44.1 kHz), FLAC and MP3
  loaded and played as audio-only media. Duration was available, subtitles could
  be edited, and video burning was disabled for audio-only files.
- A real HTML drag-and-drop selected a FLAC file; chooser selection also worked.
- Character limits 7–20 preserved complete words, punctuation, Unicode and word
  times. Over-limit single words remain intact. Applying the limit in the editor
  updated captions; stale word metadata did not replace edited text.
- FPS selection updated the timeline. At 60 FPS, one keyboard slider step gave
  `00:00:00:01`. Separate utility assertions checked frame rollover at each
  supported FPS and SRT/VTT/TXT serialization, including direction markers.
- RTL/LTR selection, caption visibility, text editing, clip dragging, whole-word
  splitting and inner word editing worked. A word edit produced one save rather
  than competing caption/word writes in the harness.
- Playback with the caption sidebar open did not move document scroll position.
- Chrome downloaded `editor-check.srt` and `editor-check-burned.mp4` to Downloads.
  The SRT was inspected, and ffprobe verified the burned video had video/audio,
  544×960 dimensions and ~6 seconds duration. A decoded output frame visibly
  showed the new Hebrew caption. Pre-existing burned captions naturally remain.
- `node --test tests/subtitle-segmentation.test.mjs` passed (2 test groups).
- `npm run build` passed; Vite reports its existing large-bundle/dependency
  directive warnings. `git diff --check` passed.

## Active-word follow-up — 2026-09-20

- Shared alignment now keeps the current caption text authoritative across
  correction models, manual edits, reflow, JSON reload and rendering. Missing
  words receive bounded estimated timings; the UI explicitly identifies this
  limitation. Repeated words are highlighted by ordinal, not by matching text.
- A live six-second transcription passed the configured timed-transcription,
  high-accuracy and correction stages: 6 captions, 19 words, 2 estimated times.
  Every final caption token had a legal word interval. JSON round-trip alignment
  was unchanged. This direct pipeline test did not write an account record.
- Browser fixture checks verified punctuation, separate occurrences of repeated
  words, inserted words and captions missing all original word timestamps.
  Editing a caption, saving and remounting from serialized data retained the new
  word and its highlight. Character reflow and undo retained that edited text
  and active-word timing. Playback advanced the highlight with the media.
- Actual local video burning now includes active-word highlighting. Decoded
  frames at 0.3, 1.2 and 3.3 seconds verified first/repeated/estimated words and
  stable Hebrew order. Whole-text bidi layout is enabled for this mode only
  (`Encoding=-1`); normal static subtitle burning is unchanged.
- Final burn artifacts are in the local temporary directory
  `C:\Users\goldn\AppData\Local\Temp\active-word-check-nnmtBv`.
  These captions are explicitly synthetic test data, not the video's transcript.
- All 14 segmentation/alignment/export test groups passed. `npm run build`
  passed with the existing dependency-directive and bundle-size warnings.

## Previous blocker / verification limits

The initial transcription request was rejected with HTTP 401. The inherited
stale key was subsequently removed from the server environment, and the live
pipeline check above now succeeds. An authenticated new upload → database save
→ reload round trip was not covered by the isolated follow-up tests.

The harness checks do not prove database persistence for all edit scenarios,
nor universal codec compatibility or absence of all bugs. No synthetic transcript
was presented as a successful live transcription.
Estimated word timings are not forced alignment against the original audio and
cannot establish perfect phonetic synchronization.

## Deliberately deferred

- Silence-frame controls need a decision: caption spacing, or actual media cuts.
- General format conversion, aspect-ratio cropping/padding and audio output
  bit-depth/sample-rate controls need explicit output semantics. Current FPS is
  a timeline/timecode setting, not media conversion.

## Repeating the isolated UI checks

Run the normal local backend and Vite development server, then open
`/tests/editor-harness.html` on the Vite server. Select an audio/video file and
submit to load the editor with fixture captions. The optional local fixture
button expects `tests/fixtures/portrait-short.mp4` (ignored media; not committed).
No API key is needed for fixture captions or local burning.
