import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CAPTION_FONTS, getCaptionFont } from "../src/captionFonts.js";
import { buildSubtitlesFilter } from "../routes/burnSubtitles.js";
import { renderActiveWordSrt } from "../src/activeWordSubtitles.js";
import { synchronizeWords } from "../src/wordAlignment.js";

const outputDir = path.resolve("tmp/font-library/burn-check");
await fs.mkdir(outputDir, { recursive: true });
const segments = [{ id: 1, start: 0, end: 1, text: "שלום עולם 123 ABC\nבדיקה, באמת?!" }];
const words = synchronizeWords(segments, []);
const sources = {
  normal: "1\n00:00:00,000 --> 00:00:01,000\n\u202bשלום עולם 123 ABC\u202c\n\u202bבדיקה, באמת?!\u202c\n",
  active: renderActiveWordSrt(segments, words, "rtl"),
};
for (const [mode, content] of Object.entries(sources)) await fs.writeFile(path.join(outputDir, `${mode}.srt`), content);

test("unrecognized font IDs fall back to the bundled default and cannot inject filter options", () => {
  assert.equal(getCaptionFont("Arial,Bold=1':movie=/etc/passwd").id, "assistant");
});

for (const font of CAPTION_FONTS) {
  test(`${font.label} burns with its bundled face, including active-word Hebrew and mixed text`, () => {
    for (const mode of Object.keys(sources)) {
      const filter = buildSubtitlesFilter(path.join(outputDir, `${mode}.srt`), {
        fontId: font.id, fontSize: 40, fontColor: "&H00FFFFFF", outlineColor: "&H00000000",
        offsetYPercent: 20, marginPercent: 5, videoWidth: 544, videoHeight: 320, wholeTextLayout: mode === "active",
      });
      const output = path.join(outputDir, `${font.id}-${mode}.png`);
      const burned = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "verbose", "-y", "-f", "lavfi", "-i", "color=black:s=544x320:d=1", "-vf", filter, "-ss", "0.2", "-frames:v", "1", "-threads", "1", output], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      assert.equal(burned.status, 0, burned.error?.message ?? burned.stderr);
      const selections = burned.stderr.split("\n").filter(line => line.includes("fontselect:"));
      assert.ok(selections.length > 0, `${font.label}: no font was selected`);
      assert.ok(selections.every(line => line.includes(font.postScriptName)), `${font.label} unexpectedly fell back:\n${selections.join("\n")}`);
      assert.doesNotMatch(burned.stderr, /failed to find|Glyph .* not found|Error opening/i);
      // A successful process alone does not prove that it drew any captions.
      const pixels = spawnSync("ffmpeg", ["-v", "error", "-i", output, "-f", "rawvideo", "-pix_fmt", "gray", "-threads", "1", "pipe:1"], { maxBuffer: 544 * 320 * 2 });
      assert.equal(pixels.status, 0);
      assert.ok(pixels.stdout.filter(value => value > 100).length > 100, `${font.label}: blank subtitle image`);
    }
  });
}
