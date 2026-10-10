# Premiere transcription fix — 2026-10-10

Active in the existing [QA environment](https://quick-caption.com/qa/) at runtime commit `bd4ed0fcef3f009e87bfefb0ae8c2e18957ecde6`. The local Premiere QA plugin already targets this environment. Production was not deployed.

## Behavior

All video/audio inputs now use mono 16 kHz MP3 preparation with floating-point sample negotiation. PCM WAV no longer bypasses preparation or silently takes the integer rematrix path that reduced the level by about 3 dB. Preparation uses private, unique temporary directories and cleans up on failure/success; it does not overwrite the source.

Raw timed-model responses are inspected before correction for repeated-letter decoding loops and extreme compression ratios. Affected decode windows are retried in at most four short requests, cut directly from the original source as mono16 PCM WAV. Crop timestamps are shifted back to the source timeline; overlapping context has one ownership interval per word. Healthy cues outside those windows retain their times.

Recovery rejects persistent loops, invalid timestamps, missing word timestamps and substantial uncovered audible intervals. The audible-interval check is conservative energy coverage, not VAD or proof of speech. It applies only to already flagged recovery windows; ordinary gaps/silence do not trigger retries. Whisper zero-duration words use the existing bounded estimated-word alignment, with the existing estimated-timing warning.

Retries report their audio duration in timed-stage usage, while the high-accuracy pass uses source duration rather than accumulated retry duration. The existing server accounting continues to measure actual AI calls and apply the shared credit policy. Failed recovery throws before the application saves/completes a partial transcription.

## Verification

- 51 automated tests passed locally and in the existing QA checkout, covering source conversion, recovery, timing/overlap, audible omissions, zero-duration words, models, credit calculation, job stages and language settings.
- Local and QA TypeScript/Vite builds passed; existing chunk-size/import warnings remain.
- For the real “בריטים” Premiere WAV, the fresh complete request starts at **2.70 s**, with **54 words before 27.3 s** and 165 formatted words overall. The earlier failing output had no words before 27.3 s.
- Source-PCM recovery starts at **2.36 s**, with **51 words before 27.3 s** and 166 formatted words overall. This integration check used a newly paid first-26-second PCM response plus a previously paid contextual tail response; the initial damaged response was injected from the investigation. It was not a second completely fresh full pipeline run.
- The first attempt exposed two real edge cases: MP3 re-encoding of a short crop returned only three intro words, and Whisper emitted zero-duration words. QA automatically restored the previous commit; the final source-PCM and coverage changes address those cases.
- Four additional approved Whisper calls completed, estimated cost **$0.0140012**, below the $0.04 ceiling. No application endpoints, account-credit mutations or database writes were used by these probes.
- On the private source fixture, fixed application/Premiere uploads have prefix gains of -0.44935 / -0.45016 dB relative to the same float source reference. The previous codec-dependent 3 dB difference is absent.
- QA health, public HTML and JS/CSS SHA-256 checks passed. Other PM2 processes retained their identities/statuses. The original QA WAV SHA-256 is unchanged.

Private recordings/results stay in ignored local `tmp/brits-audio-audit/`. The opt-in real-media regression tests require `QC_AUDIO_AUDIT_DIR`, `QC_AUDIO_AUDIT_RESULTS`, `QC_AUDIO_FIX_DIR` and `QC_AUDIO_FIX_RESULTS`; they read saved files and do not call an API. Remote verification scripts/media/backups were removed after retrieval. The previous QA commit is retained for recovery, along with existing QA checkouts/dependencies.

This fixes the reproduced missing-intro failure and adds a bounded recovery policy. It does not establish perfect word accuracy for every recording; no manual reference transcript/WER evaluation was performed. Existing completed partial jobs/timeline captions were not rewritten; a new transcription uses the fixed code.
