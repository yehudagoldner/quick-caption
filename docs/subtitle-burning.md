# Subtitle burning

Burning remains on the application's server with FFmpeg/libass, including Hebrew text, bundled fonts, active-word highlighting and word-pop animations. Bunny holds the original videos and does not render captions.

- Saved-video exports send `videoId` and caption settings. The server checks ownership using the authenticated identity, reads legacy local sources in place, or streams the Bunny original into a temporary working file. This avoids downloading the original to the browser and uploading it again. The original is preserved; temporary inputs, subtitles and outputs are removed after success, failure or disconnect.
- H.264 uses `libx264`, `veryfast`, CRF 23, with audio copied unchanged. CRF 23 preserves the previous quality target; changing the preset can change compression efficiency and output size. Resolution and caption layout stay unchanged.
- The popup covers preparation, rendering and transfer of the completed file. Rendering percentages come from FFmpeg's `out_time_us` divided by the probed media duration. Progress stays below 100 until FFmpeg exits successfully. Preparation, transfer and unknown-duration rendering use an indeterminate bar.
- `X-Burn-Job-Id` correlates an export with `GET /api/burn-subtitles/progress/:id`. Progress requires the same authenticated owner, is not cached, and completed jobs expire after ten minutes. Progress is held in process memory; multiple API workers require sticky routing or a shared progress store.
- Disconnecting the response cancels the source download and FFmpeg. Polling failures do not interrupt an otherwise successful export.

Validation: `node --test tests/burn-progress.test.mjs tests/caption-motion.test.mjs tests/caption-font-burn.test.mjs`, `npx playwright test tests/burn-progress.spec.ts tests/caption-motion.spec.ts`, and `npm run build`.

Run `node scripts/benchmark-burn.mjs` for a local comparison using 15 seconds of synthetic motion at 1920×1080/30 fps with Hebrew captions. On the development machine on 2026-10-05, two runs per preset averaged 2.85 seconds for `medium` and 1.90 seconds for `veryfast` (33% less encoding time). This measures encoding only; actual gains depend on the source, server and transfer time.
