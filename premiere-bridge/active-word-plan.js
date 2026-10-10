'use strict';
const { synchronizeWords } = require('./word-alignment.js');
const TICKS_PER_SECOND = 254016000000;
const bad = message => { throw Object.assign(new Error(message), { code: 'invalid_graphics' }); };
function rows(value, name) {
  let parsed = value;
  if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { bad(`Invalid ${name}`); } }
  if (!Array.isArray(parsed)) bad(`Missing ${name}`);
  return parsed;
}
function buildActiveWordPlan({ segments, words, ranges, frameTicks, color = '#FFD45A' }) {
  const captions = rows(segments, 'captions'), source = rows(words, 'word timings');
  if (!/^\d+$/.test(String(frameTicks)) || Number(frameTicks) <= 0 || Number(frameTicks) > TICKS_PER_SECOND / 10) bad('Invalid frame rate');
  if (!/^#[0-9a-f]{6}$/i.test(color)) bad('Invalid highlight color');
  if (!Array.isArray(ranges) || !ranges.length) bad('Missing selection timing');
  let cursor = 0, previousEnd = -1;
  for (const range of ranges) {
    if (![range.start, range.end, range.outputStart].every(Number.isFinite) || range.start < previousEnd || range.start < 0 || range.end <= range.start || Math.abs(range.outputStart - cursor) > .000001) bad('Invalid selection timing');
    cursor += range.end - range.start; previousEnd = range.end;
  }
  const ids = new Set();
  if (!captions.length || captions.length > 2000) bad('Invalid caption count');
  for (const s of captions) {
    if (!s || ids.has(String(s.id)) || typeof s.text !== 'string' || !s.text.trim() || s.text.length > 2000 || /\0/.test(s.text) || ![s.start, s.end].every(Number.isFinite) || s.start < 0 || s.end <= s.start || s.end > cursor + .1) bad('Invalid caption');
    ids.add(String(s.id));
  }
  // Missing word times must not silently turn into entirely guessed highlighting.
  if (!source.some(w => w && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && typeof w.word === 'string')) bad('No usable word timings; regular captions are still available');
  const aligned = synchronizeWords(captions, source);
  const frame = seconds => Math.round(seconds * TICKS_PER_SECOND / Number(frameTicks));
  const phrases = [];
  for (const s of captions) {
    const text = s.text.trim(), tokens = [...text.matchAll(/\S+/gu)];
    const owned = aligned.filter(w => String(w.segmentId) === String(s.id));
    for (const range of ranges) {
      const a = Math.max(s.start, range.outputStart), b = Math.min(s.end, range.outputStart + range.end - range.start);
      if (b <= a) continue;
      const delta = range.start - range.outputStart, startFrame = frame(a + delta), endFrame = frame(b + delta);
      if (endFrame <= startFrame) continue;
      const timings = owned.map(w => ({ ...w, from: Math.max(startFrame, frame(w.start + delta)), to: Math.min(endFrame, frame(w.end + delta)) }));
      const boundaries = [...new Set([startFrame, endFrame, ...timings.flatMap(w => [w.from, w.to])])].filter(t => t >= startFrame && t <= endFrame).sort((x,y) => x-y);
      const states = [];
      for (let i = 0; i < boundaries.length - 1; i++) {
        const from = boundaries[i], to = boundaries[i+1];
        const active = timings.find(w => w.from <= from && w.to > from);
        const wordIndex = active?.wordIndex ?? -1, token = tokens[wordIndex];
        const previous = states[states.length-1];
        if (previous && previous.wordIndex === wordIndex) { previous.endFrame = to - startFrame; continue; }
        states.push({ startFrame: from - startFrame, endFrame: to - startFrame, wordIndex, word: token?.[0] || '', offset: token?.index ?? 0, length: token?.[0].length ?? 0 });
      }
      phrases.push({ text, startFrame, endFrame, states, estimatedWords: owned.filter(w => w.timingSource === 'estimated').length });
    }
  }
  phrases.sort((a,b) => a.startFrame-b.startFrame);
  if (!phrases.length || phrases.some((p,i) => i && p.startFrame < phrases[i-1].endFrame)) bad('Captions overlap or are outside the selected timeline');
  if (phrases.reduce((n,p) => n+p.states.length,0) > 12000) bad('Too many word intervals');
  return { version: 1, frameTicks: String(frameTicks), color: color.toUpperCase(), phrases };
}
module.exports = { buildActiveWordPlan, TICKS_PER_SECOND };
