// Run with a short local media file. --live also exercises the configured AI
// pipeline (billable); without it, only the local burn endpoint is exercised.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { synchronizeWords, subtitleTokens } from "../src/wordAlignment.js";

const input = process.argv[2];
if (!input) throw new Error("Provide a short media file path");
const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "active-word-check-"));
if (process.argv.includes("--live")) {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ override: true, quiet: true });
  const { transcribeMedia } = await import("../src/transcription.js");
  const stages = {};
  const result = await transcribeMedia({
    inputPath: input, maxCharactersPerSubtitle: 20,
    logger: { log() {}, warn() {} },
    onStage(stage, status) { stages[stage] = status; console.log(JSON.stringify({ stage, status })); },
  });
  for (const segment of result.segments) {
    const owned = result.words.filter(w => w.segmentId === segment.id);
    assert.deepEqual(owned.map(w => w.word), subtitleTokens(segment.text));
    assert.ok(owned.every(w => w.start >= segment.start && w.end <= segment.end && w.end > w.start));
  }
  assert.deepEqual(synchronizeWords(result.segments, JSON.parse(JSON.stringify(result.words))), result.words);
  await fs.writeFile(path.join(outputDirectory, "live-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ live: true, stages, captions: result.segments.length, words: result.words.length, estimatedWords: result.words.filter(w => w.timingSource === "estimated").length }));
}

const segments = [{ id:1,start:0,end:3,text:"כן, כן! עכשיו בדיקה" }, { id:2,start:3,end:6,text:"מילה שנוספה נשארת כאן" }];
const words = synchronizeWords(segments, [{word:"כן",start:0,end:.7},{word:"כן",start:1,end:1.5},{word:"בדיקה",start:2.5,end:3}]);
const form = new FormData();
form.append("media", new Blob([await fs.readFile(input)], {type:"video/mp4"}), path.basename(input));
form.append("subtitleContent", "active-word smoke captions");
form.append("activeWordEnabled", "true");
form.append("segments", JSON.stringify(segments));
form.append("words", JSON.stringify(words));
form.append("textDirection", "rtl");
form.append("fontSize", "48");
form.append("fontColor", "#FFFFFF");
form.append("outlineColor", "#000000");
form.append("offsetYPercent", "35");
form.append("marginPercent", "5");
form.append("videoWidth", "544");
form.append("videoHeight", "960");
const response = await fetch("http://localhost:3000/api/burn-subtitles", {method:"POST",body:form});
assert.equal(response.status, 200, `Burn request failed (${response.status})`);
const output = path.join(outputDirectory,"active-word-burn.mp4");
await fs.writeFile(output, Buffer.from(await response.arrayBuffer()));
for (const [time, name] of [[.3,"first-word"],[1.2,"second-word"],[3.3,"estimated-word"]]) {
  const result = spawnSync("ffmpeg", ["-hide_banner","-loglevel","error","-ss",String(time),"-i",output,"-frames:v","1",path.join(outputDirectory,`${name}.png`)]);
  assert.equal(result.status, 0);
}
console.log(JSON.stringify({ burn: "passed", outputDirectory }));
