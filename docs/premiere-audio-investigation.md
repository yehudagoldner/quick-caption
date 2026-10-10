# Premiere transcription investigation: בריטים

Investigation completed 2026-10-10. Headless file, code and automated tests only; no desktop/browser control. Application runtime code was not changed or deployed.

The investigation below records the pre-fix behavior. The subsequent implementation and QA verification are described in [Premiere transcription fix](premiere-transcription-fix.md).

## Finding

The spoken intro is present in the actual Premiere WAV. The missing subtitles originate in the raw `whisper-1` response, before correction, formatting or timeline placement. With this input, the model produces a long repeated Hebrew letter around 27 seconds and omits the preceding speech. Correction turns the repeated text into a plausible short cue, while retaining the original segment IDs/times; it cannot recreate timestamps for omitted speech.

The experiment supports an interaction between audio level/conversion and decoding context. Attenuating the application's audio by about 3 dB reproduces the omission. Raising the Premiere audio recovers intro coverage. Transcribing its first 26 seconds separately also recovers intro coverage without raising its level. This is not evidence that all Premiere exports lose audio quality, or that a fixed gain adjustment solves every clip.

## Inputs and preparation

- Original: `C:\Users\goldn\Videos\Movavi Library\בריטים.mp4` (126,697,796 bytes), AAC 44.1 kHz stereo; video duration 75.2752 s.
- Actual Premiere export: existing QA video 30, PCM s16le WAV, 48 kHz stereo, 75.308417 s. File SHA-256: `84817fc2883730ef4c13e6d32ffec0c1031f7b6e708a2e6fd2398fefedf8ddd1`.
- The original AAC stream was copied into an audio-only MP4 without re-encoding. Original versus stream-copy decoded PCM SHA-256 matched: `f582b38e0f7f81f53685ee7d6fd40958fe4f3e28669b3c853665c9b1eab8ef66`.
- `scripts/audit-premiere-audio.mjs` invokes the real application preparation path through `transcribeMedia`, intercepting the SDK request before network access. Thus the application MP3 and WAV pass-through are actual preparation outputs, rather than assumed conversion recipes.
- `src/transcription.js:898` converts video to mono 16 kHz / 128 kbps MP3, but passes audio under the upload limit through unchanged. The actual Premiere WAV follows the latter path.
- Sample correlation for the intro was 0.996724, with a 23.25 ms lead in the Premiere export. Both retain the spoken intro. Removing Adobe/container metadata while preserving every decoded WAV sample does not change the failure.
- Float mono decoding shows nearly equal source/WAV level. Integer mono decoding and MP3 preparation show different levels. Equal float samples/correlation do **not** establish equal level in the eventual mono conversion.

All paid tests used the existing `caption-qa` checkout at commit `56a03ec2a933e6fca2e0eef010528e0b5e047be3`, Node 22.23.3, FFmpeg 4.4.2. Local signal tests used FFmpeg 7.1.1. No extra server environment, database or PM2 application was created.

## Six variants, two rounds each

Requests used identical settings: `whisper-1`, `language: he`, `temperature: 0`, `response_format: verbose_json`, word and segment timestamps, no translation. The second round reversed variant order. SDK retries were disabled; each request was journaled before invocation. These are raw model results, before GPT correction or subtitle segmentation.

| Input | First cue, rounds 1 / 2 (s) | Words starting before 27.3 s, rounds 1 / 2 |
| --- | --- | --- |
| Original AAC → actual application MP3 | 2.72 / 2.72 | 58 / 58 |
| Actual Premiere WAV, unchanged | 27.32 / 27.32 | 0 / 0 |
| Premiere WAV → same mono16 MP3 recipe | 27.32 / 27.32 | 0 / 0 |
| Premiere WAV → canonical stereo48 WAV, identical PCM | 27.32 / 27.32 | 0 / 0 |
| Premiere WAV → mono16 WAV | 27.32 / 27.32 | 0 / 0 |
| Premiere WAV → mono48 WAV | 27.32 / 27.32 | 0 / 0 |

Changing sample rate, channels or container alone did not fix this clip. In particular, simply applying the application's MP3 conversion to the Premiere WAV did not recover the intro.

## Four approved control calls

| Control | First cue (s) | Words before 27.3 s | Interpretation |
| --- | --- | --- | --- |
| Premiere WAV → MP3 with `volume=3.0103dB` | 2.70 | 55 | Raising the effective level recovered intro coverage; measured increase was about **6 dB**, not a pure 3 dB adjustment. |
| Original AAC → MP3 with `volume=-3.0103dB` | 27.74 | 0 | Lowering the application path by about 3 dB reproduced the missing intro and repeated-letter failure. |
| Premiere mono16 WAV + 372 zero samples (23.25 ms) | 27.74 | 0 | Correcting the measured start offset did not recover the intro. |
| First 26 s of Premiere mono16 WAV | 2.28 | 44 | A shorter decoding context recovered speech without increasing level, though text remained imperfect. |

Each control was run once within the approved additional budget. This experiment identifies a strong level/context sensitivity for this recording; it does not measure word error rate against a manually verified reference or establish a universally safe gain/segment length.

### Effective level, not just the filter argument

QA FFmpeg measured the following 0–27.3 s mono16/s16 RMS levels:

| Input | RMS dBFS | Peak dBFS |
| --- | --- | --- |
| Application MP3 | -15.849 | 0.000 |
| Actual Premiere WAV | -18.415 | -1.313 |
| Premiere → mono16 MP3 | -18.863 | -1.700 |
| Attenuated application MP3 | -18.855 | -1.711 |
| Boosted Premiere MP3 | -12.995 | 0.000 |

The two failing MP3 paths have nearly identical levels. FFmpeg's verbose negotiation shows unfiltered PCM WAV using an integer mono rematrix (`s16 → s16p`), whereas AAC and the volume-filtered WAV use floating point (`fltp`). Inserting the gain filter therefore changes the rematrix/sample negotiation as well as the requested gain. The boosted file peaks at full scale; blindly adding gain is not a suitable production fix. The provider's internal preprocessing was not inspected, so these measured FFmpeg paths should not be described as proof of its exact implementation.

## Why the application treats an incomplete result as success

The first failing raw segment has `compression_ratio ≈ 29.733`, a long repeated `ו`, and its first timestamp at 27.32 s. The successful application response starts at 2.72 s with normal text and `compression_ratio ≈ 2.145`. `no_speech_prob` alone does not distinguish them: both are about 0.61.

`extractSegmentsFromTranscription` (`src/transcription.js:773`) drops these raw quality fields. `mergeCorrectedSegments` (`src/wordAlignment.js:131`) changes text for existing IDs while preserving their times. A local mocked pipeline test confirms that even an accurate second-pass transcript containing the intro cannot add missing timed cues through the current merge. This test demonstrates the code's constraint; it does not assert that the real second-pass model recovered every omitted word.

The earlier saved Premiere result begins at 27.32 s after correction, with the loop rendered as “וואו”. Its existing cues are placed at the expected timeline times. The absence therefore starts upstream of placement, rather than being caused by SRT insertion.

## Tests and retained evidence

26 automated tests passed, with both private-media opt-in variables enabled:

```powershell
$env:QC_AUDIO_AUDIT_DIR='C:\ai projects\25\subtitles 2.0\tmp\brits-audio-audit\local-prepared'
$env:QC_AUDIO_AUDIT_RESULTS='C:\ai projects\25\subtitles 2.0\tmp\brits-audio-audit\qa-results.json'
node --test tests/audio-audit-metrics.test.mjs tests/transcription-audio-preparation.test.mjs tests/transcription-models.test.mjs tests/premiere-audio-regression.test.mjs
```

These tests cover actual preparation with network interception, sample preservation/offset, a raw Hebrew decoding loop, the correction/timestamp limitation, and the recorded 16-response experiment. The private-media tests read saved files and never make paid requests; they skip when their opt-in variables are absent. The recorded-result tests verify this investigation's evidence, rather than asserting that production behavior has been repaired.

Private media and raw results remain in ignored local `tmp/brits-audio-audit/`, including `qa-results.json`, `rematrix.jsonl`, `final-tests.log` and the exact four QA-encoded MP3 inputs in `qa-prepared/`. No private audio/transcript fixtures were added to tracked files. Remote verification copies/scripts were removed after retrieval; the existing QA media and running checkout were preserved. Local and public QA health both returned HTTP 200 afterward, with the same recorded checkout/commit and PM2 online.

16 of 16 approved paid requests completed. Estimated API cost was $0.090393 + $0.025206 = **$0.115600**, calculated from duration at [Whisper's listed $0.006/minute](https://developers.openai.com/api/docs/models/whisper-1). This is an estimate, not an invoice. Requests bypassed application endpoints and made no account-credit or database writes.

## Recommended implementation follow-up

Use one explicit audio preparation contract for video and audio inputs, specifying channel mix/sample format and checking level/peaks instead of relying on codec-dependent defaults. Preserve raw quality diagnostics before correction. Treat repeated-letter/high-compression decoding as a recoverable quality failure and retry bounded affected audio windows with timestamp offsets and overlap deduplication. Silence/VAD or corroborating transcript evidence is needed before labeling an ordinary caption gap as missing speech.

The 26-second control makes window recovery a promising direction, while its imperfect text cautions against treating it as a completed fix. Validate the recovery policy and credit handling in the existing QA environment before release. No runtime fix or deployment was performed as part of this investigation.
