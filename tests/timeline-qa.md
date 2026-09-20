# Timeline improvements — local review, 2026-09-20

No commit, push, production deployment, or changes to stored user videos.

## Implemented

- Caption and word drafts survive selection changes; caption text, timing and words share one explicit save.
- Split includes the draft and remains available regardless of active-word highlighting.
- Overlap rejection does not modify neighbours. Trimming silence preserves word anchors; cutting through timed words requires an explicit word-timing edit first.
- Both rulers seek the same media player. Frame buttons and playhead update on every frame.
- Caption timing is edited on the track, without duplicate start/end fields. Optional precise word timing remains in the word-edit dialog (HH:MM:SS:FF and frame nudges).
- 100-step session undo/redo restores caption text and word timings together. Keyboard shortcuts ignore text inputs.
- Play-from-selection, caption loop, always-synchronized playhead visibility and fit-all zoom.
- On-demand local audio waveform with click/keyboard seeking; all audio channels contribute.
- Mobile sticky compact preview, larger resize handles and accessible button names.
- Explicit-save failures retain the draft and restore the previous preview/history. Retry remains available.

## Browser checks performed

Real components in `http://localhost:5173/tests/editor-harness.html`, six-second portrait video and deterministic captions; no API transcription or account writes.

- Single-frame advance at 24 FPS: media, timecode and playhead agree.
- Waveform decoded and rendered from the MP4 fixture.
- Text draft survives switching to another caption and back.
- Split uses changed text; undo returns original text/cues; redo restores the split.
- Dragging second cue onto first is rejected and neither boundary changes.
- Trimming final cue's trailing silence changes only its end; both word anchors stay intact.
- Out-of-range added word (10–11 seconds in a 4–6 second caption) is blocked.
- Clicking word ruler at relative second 1 seeks video to absolute second 5 for cue starting at 4.
- Middle cue loops repeatedly inside seconds 2–4, remaining in playback after the full media duration has elapsed.
- Word timing draft survives changing selected cue; save and undo restore the exact previous timing without changing the neighbouring word.
- Simulated save failure preserves draft, restores previous caption preview, and can be retried. Saved data survives editor remount.
- Maximum zoom followed by fit-all brings all captions back into the visible timeline.
- At 390×844: no page horizontal overflow, 18px resize handles, compact preview remains at y=8 while editing words.

## Compact inspector follow-up

- Replaced the inspector card, multiline field, headings and footer actions with one 40px toolbar directly between the caption and word tracks.
- Desktop exposes caption text, play-from, loop, split, cancel draft, word actions, word zoom, save and close in that row. Main zoom is above the caption track.
- Narrow containers expose text/save/close and a labelled secondary-action popover, without wrapping or horizontal page overflow.
- Browser geometry checks: at 1185px and 327px track widths, the toolbar and the entire gap between tracks both measure exactly 40px.
- Verified caption text save, word text edit/save, and word timing edit/save through the mobile popover. The save button is highlighted only while the selected caption has a draft.
- Word data is memoized across playback frames; cursor synchronization happens before paint and skips unchanged times.
- Continuous caption-loop playback after the synchronization fix produced no new console errors (including the earlier maximum-update-depth warning).

## Active-word visibility follow-up

- With active-word highlighting off, the selected caption shows only the 40px text/action toolbar; the word track, word actions and word zoom are absent.
- Re-enabling highlighting restores the word track. Hiding/showing does not change word timestamps or discard caption drafts.
- Browser checks: toggled off/on and compared every displayed word/timing title; edited text while off, toggled on/off with an unsaved draft, then saved successfully while off.
- Caption-boundary protection is unchanged; when a resize would cut through a timed word, the error explains how to re-enable the hidden word editor.

## Main zoom and player seeking follow-up

- Main zoom is in a 40px row directly above the main track (measured gap: 0px), after the optional waveform.
- Default automatic zoom displays 30 seconds, or the whole recording when shorter. Manual zoom, a 30-second reset and fit-all remain available.
- The viewport follows all playhead changes, including native-player seeking while paused, without requiring a follow switch or changing zoom.
- Native-player browser checks with a generated local 90-second silent WAV: dragged from 0 to ~74 seconds while paused; both timeline grids scrolled to 2254px and timecode matched the player. Dragged back to ~4 seconds while playing; grids returned to 0px and playback continued.
- Fit-all reported 90 seconds; the 30-second preset restored 30. At 390px viewport: zoom bar height 40px, zero gap above track, no page horizontal overflow. No console errors during these checks.

## Caption text discovery and popup follow-up

- Selecting a caption shows a blue outlined text field, a pencil and a desktop "edit here" hint; the inspector remains exactly 40px tall.
- Double-clicking a different caption opens its text in an autofocused popup. F2 and the inline expand button also open it, with active-word highlighting either on or off.
- Popup and inline field share one draft: returning to the timeline preserves edits; saving updates the caption and closes the popup. Ctrl+Enter also saves.
- A simulated save failure leaves the popup and edited text intact; retry succeeds. Blank text cannot be saved.
- At 390x844, the popup fits the viewport, its expand button remains available, the toolbar stays 40px and the page has no horizontal overflow. Desktop and narrow layouts were visually inspected.

## Automated checks

`node --test tests/timeline-editing.test.mjs tests/word-alignment.test.mjs tests/active-word-export.test.mjs`

17 tests passed, including automatic window sizing and bidirectional playhead reveal. TypeScript and local production build passed. Existing bundle-size/react-virtualized build warnings remain.

## Limits / further coverage

- Waveform decoding is on demand and limited to browser-supported codecs, 100 MB and 20 minutes; editing/playback remain available if decoding is unavailable.
- Undo/redo and unsaved drafts are session-local. Page exit warns about drafts; save before reloading.
- Responsive layout was tested in a browser viewport, not on physical touch hardware.
- Long-recording performance and real server outage recovery have not been load-tested; save failures were simulated in the local harness.
