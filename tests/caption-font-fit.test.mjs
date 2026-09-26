import test from "node:test";
import assert from "node:assert/strict";
import { CAPTION_FONT_EM_RATIO, CAPTION_OUTLINE_WIDTH, captionMarginPixels, captionTextLines, fitCaptionFontSize } from "../src/captionStyle.js";

const base = { maxLineEmWidth: 12.937, maxLineCount: 1, videoWidth: 1080, videoHeight: 1920, marginPercent: 5, offsetYPercent: 20 };

test("auto font size fills the width between the margins without overflowing", () => {
  const size = fitCaptionFontSize(base);
  const lineWidth = base.maxLineEmWidth * size * CAPTION_FONT_EM_RATIO + CAPTION_OUTLINE_WIDTH * 2;
  const available = base.videoWidth - captionMarginPixels(base.marginPercent, base.videoWidth) * 2;
  assert.ok(lineWidth <= available, `${lineWidth} > ${available}`);
  assert.ok(lineWidth > available * 0.95, `${lineWidth} leaves too much room in ${available}`);
});

test("auto font size shrinks for wider margins and longer captions and grows for wider videos", () => {
  const size = fitCaptionFontSize(base);
  assert.ok(fitCaptionFontSize({ ...base, marginPercent: 20 }) < size);
  assert.ok(fitCaptionFontSize({ ...base, maxLineEmWidth: base.maxLineEmWidth * 2 }) < size);
  assert.ok(fitCaptionFontSize({ ...base, videoWidth: 1920, videoHeight: 1080 }) > size);
});

test("short captions are limited by the height above the bottom offset", () => {
  const size = fitCaptionFontSize({ ...base, maxLineEmWidth: 0.5, maxLineCount: 2 });
  const margin = captionMarginPixels(base.marginPercent, base.videoWidth);
  assert.ok(size * 2 <= base.videoHeight * (1 - base.offsetYPercent / 100) - margin);
});

test("caption lines ignore bidi controls, blank lines and surrounding spaces", () => {
  assert.deepEqual(captionTextLines("\u202b שלום \u202c\n\nעולם "), ["שלום", "עולם"]);
});
