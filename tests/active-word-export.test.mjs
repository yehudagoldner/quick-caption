import test from "node:test";
import assert from "node:assert/strict";
import { renderActiveWordSrt } from "../src/activeWordSubtitles.js";

test("burned captions colour only one occurrence of repeated words and preserve silence", () => {
  const segments = [{id:1,start:0,end:2,text:"כן, כן!"}];
  const words = [{word:"כן",start:0,end:.4},{word:"כן",start:1,end:1.5}];
  const srt = renderActiveWordSrt(segments, words);
  const cues = srt.split("\n\n");
  assert.equal(cues.length, 4);
  assert.ok(cues[0].includes('<font color="#FFD700">כן,</font> כן!'));
  assert.ok(!cues[1].includes('<font'));
  assert.ok(cues[2].includes('כן, <font color="#FFD700">כן!</font>'));
  assert.ok(!cues[3].includes('<font'));
  assert.ok(cues[0].includes('00:00:00,000 --> 00:00:00,400'));
});

test("export uses current corrected tokens, escapes subtitle markup and estimates missing words", () => {
  const segments = [{ id:1,start:1,end:2,text:'חדש <b> & "כן"' }];
  const srt = renderActiveWordSrt(segments, [], "ltr");
  assert.ok(srt.includes('&lt;b&gt;'));
  assert.ok(srt.includes('&amp;'));
  assert.ok(srt.includes('\u202a'));
  assert.equal((srt.match(/#FFD700/g) || []).length, 4);
});
