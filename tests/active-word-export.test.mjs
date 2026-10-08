import test from "node:test";
import assert from "node:assert/strict";
import { renderActiveWordSrt } from "../src/activeWordSubtitles.js";
import { overwriteCaptionRange, retimeCaptionChanges } from "../src/timelineEditing.js";

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

test("extended and trimmed captions burn as consecutive cues without simultaneous subtitles", () => {
  const clips = [{ id: 1, start: 0, end: 2, text: 'a b' }, { id: 2, start: 2, end: 4, text: 'c d' }, { id: 3, start: 4, end: 6, text: 'e f' }];
  const words = clips.flatMap(clip => clip.text.split(' ').map((word, index) => ({ word, start: clip.start + index, end: clip.start + index + 1, segmentId: clip.id })));
  const timestamp = value => { const [hours, minutes, seconds] = value.replace(',', '.').split(':').map(Number); return hours * 3600 + minutes * 60 + seconds; };
  for (const edited of [{ ...clips[0], end: 5 }, { ...clips[2], start: 1 }]) {
    const next = overwriteCaptionRange(edited, clips);
    const retimed = retimeCaptionChanges(clips, next, words, true);
    const output = renderActiveWordSrt(next, retimed);
    const ranges = [...output.matchAll(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g)].map(match => [timestamp(match[1]), timestamp(match[2])]);
    assert.equal(ranges[0][0], 0);
    assert.equal(ranges.at(-1)[1], 6);
    for (let index = 1; index < ranges.length; index++) assert.ok(ranges[index - 1][1] <= ranges[index][0]);
    assert.ok(!output.includes('c d'));
  }
});
