import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import multer from "multer";
import { renderWordPopAss, wordPopCues, wordPopScale, escapeAssText } from "../src/captionMotion.js";
import { createBurnSubtitlesRouter, buildSubtitlesFilter } from "../routes/burnSubtitles.js";

const dir = path.resolve("tmp/caption-motion");
await fs.mkdir(dir, { recursive: true });
const segments = [{ id: 1, start: 0, end: .6, text: "שלום" }, { id: 2, start: .8, end: 1.4, text: "שלום!" }];
const words = segments.map(s => ({ word: s.text, start: s.start, end: s.end, segmentId: s.id, wordIndex: 0 }));

test("repeated words restart motion, silence stays empty and very short cues never overlap", () => {
  const cues = wordPopCues([...words, { word: "קצר", start: 1.401, end: 1.409 }]);
  assert.equal(wordPopScale(cues[0], .3, "strong"), 1);
  assert.equal(wordPopScale(cues[1], .8, "strong"), .65);
  assert.equal(cues.find(w => .7 >= w.start && .7 < w.end), undefined);
  assert.equal(cues[2].end - cues[2].start > 0, true);
  assert.ok(Number.isFinite(wordPopScale(cues[2], 1.405, "strong")));
  const ass = renderWordPopAss(segments, words);
  assert.equal(ass.split("\n").filter(line => line.startsWith("Dialogue:")).length, 2);
  assert.ok(ass.includes("0:00:00.80,0:00:01.40"));
});

test("corrected text and missing timings produce full words; ASS control syntax stays literal", () => {
  const content = renderWordPopAss([{ id: 1, start: 0, end: 1, text: "חדש {\\p1} ABC" }], [], { direction: "ltr" });
  assert.equal(content.split("\n").filter(line => line.startsWith("Dialogue:")).length, 3);
  assert.ok(content.includes("\u202aחדש\u202c"));
  assert.ok(content.includes("｛＼p1｝"));
  assert.doesNotMatch(escapeAssText("{\\pos(0,0)}\nDialogue: 0\u202e"), /[{}\\\r\n\u202e]/);
});

const bounds = (bytes, width, height, frame) => {
  let left = width, right = -1, top = height, bottom = -1;
  const offset = frame * width * height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (bytes[offset + y * width + x] > 150) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return { width: right < 0 ? 0 : right - left + 1, height: bottom < 0 ? 0 : bottom - top + 1, center: (left + right) / 2 };
};
const style = { fontId: "assistant", fontSize: 72, fontColor: "&H00FFFFFF", outlineColor: "&H00000000", offsetYPercent: 20, marginPercent: 5, videoWidth: 640, videoHeight: 360, wholeTextLayout: true };

test("real FFmpeg rendering grows, overshoots, settles and hides captions in speech gaps", async () => {
  const file = path.join(dir, "check.ass");
  await fs.writeFile(file, renderWordPopAss(segments, words, { intensity: "strong", videoWidth: 640, videoHeight: 360 }));
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=640x360:r=100:d=1.4", "-vf", buildSubtitlesFilter(file, style), "-pix_fmt", "gray", "-threads", "1", "-f", "rawvideo", "pipe:1"], { maxBuffer: 40 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  const small = bounds(result.stdout, 640, 360, 1), peak = bounds(result.stdout, 640, 360, 14), settled = bounds(result.stdout, 640, 360, 30);
  assert.ok(small.width > 10, "caption must be visible");
  assert.ok(peak.width > settled.width * 1.07, JSON.stringify({ small, peak, settled }));
  assert.ok(settled.width > small.width * 1.3);
  assert.ok(Math.abs(peak.center - settled.center) < 2, "bounce must stay horizontally centered");
  assert.equal(bounds(result.stdout, 640, 360, 70).width, 0);
  assert.ok(bounds(result.stdout, 640, 360, 81).width > 10, "next repeated word must render");
});

test("burn endpoint exports animated MP4 without the active-word toggle and validates timing input", async () => {
  const source = path.join(dir, "source.mp4");
  const generated = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x17152c:s=640x360:r=30:d=1.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const app = express(); app.use("/burn", createBurnSubtitlesRouter(multer({ dest: dir })));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const send = async (timing = segments) => {
      const body = new FormData();
      body.append("media", new Blob([await fs.readFile(source)], { type: "video/mp4" }), "sample.mp4");
      for (const [key, value] of Object.entries({ subtitleContent: "unused", segments: JSON.stringify(timing), words: JSON.stringify(words), captionMotion: "pop", popIntensity: "strong", fontSize: 72, fontColor: "#ffe14d", outlineColor: "#000000", videoWidth: 640, videoHeight: 360, offsetYPercent: 20, marginPercent: 5 })) body.append(key, String(value));
      return fetch(`http://127.0.0.1:${server.address().port}/burn`, { method: "POST", body });
    };
    const response = await send();
    assert.equal(response.status, 200, response.status === 200 ? "" : await response.text());
    assert.match(response.headers.get("content-disposition"), /sample-subtitled\.mp4/);
    const output = path.join(dir, "word-pop-demo.mp4");
    await fs.writeFile(output, Buffer.from(await response.arrayBuffer()));
    const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", output, "-pix_fmt", "gray", "-threads", "1", "-f", "rawvideo", "pipe:1"], { maxBuffer: 15 * 1024 * 1024 });
    assert.equal(decoded.status, 0, decoded.stderr?.toString());
    assert.ok(bounds(decoded.stdout, 640, 360, 4).width > bounds(decoded.stdout, 640, 360, 10).width, "export must contain the bounce, not just static words");
    assert.equal(bounds(decoded.stdout, 640, 360, 21).width, 0);
    const invalid = await send([{ start: 0, end: 1 }]);
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
