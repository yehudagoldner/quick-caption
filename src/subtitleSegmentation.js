// Keep complete whitespace-delimited words, including punctuation. A single word
// longer than the limit is intentionally kept intact in its own subtitle.
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const characterCount = (text) => [...graphemes.segment(text)].length;

// Reflow the CURRENT edited text, not the original transcript. Unlike the
// upload splitter below, this can also merge adjacent captions when relaxing
// the limit. Keep sentence endings and pauses longer than 350 ms as boundaries.
export function reflowSubtitleCharacters(segments, words = [], maxCharacters = 20) {
  if (maxCharacters !== null && (!Number.isInteger(maxCharacters) || maxCharacters < 7 || maxCharacters > 20)) {
    throw new RangeError("Character limit must be between 7 and 20");
  }
  const atoms = segments.flatMap(segment => {
    const tokens = segment.text.trim().split(/\s+/u).filter(Boolean);
    const timed = words.filter(w => w.start >= segment.start - .001 && w.start < segment.end && w.end <= segment.end + .001);
    const aligned = timed.length === tokens.length && timed.every((w, i) => w.word.trim() === tokens[i]);
    return tokens.map((word, i) => ({
      source: segment,
      word,
      timingSource: aligned ? timed[i].timingSource : "estimated",
      start: aligned ? timed[i].start : segment.start + (segment.end - segment.start) * i / tokens.length,
      end: aligned ? timed[i].end : segment.start + (segment.end - segment.start) * (i + 1) / tokens.length,
      captionStart: i === 0 ? segment.start : aligned ? timed[i].start : segment.start + (segment.end - segment.start) * i / tokens.length,
      captionEnd: i === tokens.length - 1 ? segment.end : aligned ? timed[i].end : segment.start + (segment.end - segment.start) * (i + 1) / tokens.length,
    }));
  });
  const result = [];
  const ids = new Set(segments.map(s => String(s.id)));
  let sequence = 0;
  let group = [];
  const flush = () => {
    if (!group.length) return;
    let id;
    do { id = `reflow-${sequence++}`; } while (ids.has(id));
    ids.add(id);
    result.push({ ...group[0].source, id, start: group[0].captionStart, end: group.at(-1).captionEnd, text: group.map(w => w.word).join(" ") });
    group = [];
  };
  for (const atom of atoms) {
    const previous = group.at(-1);
    const exceedsLimit = maxCharacters === null ? group.length >= 5 : characterCount([...group.map(w => w.word), atom.word].join(" ")) > maxCharacters;
    if (previous && (exceedsLimit || atom.start - previous.end > .35 || atom.captionStart < previous.captionEnd - .001 || /[.!?…。！？]["'״”’)]*$/u.test(previous.word))) flush();
    group.push(atom);
  }
  flush();
  return { segments: result, words: atoms.map(({ word, start, end, timingSource }) => ({ word, start, end, ...(timingSource ? { timingSource } : {}) })) };
}

export function limitSubtitleCharacters(segments, words = [], maxCharacters = 20) {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 7 || maxCharacters > 20) {
    throw new RangeError("Character limit must be between 7 and 20");
  }
  let nextId = 0;
  const usedIds = new Set(segments.map(s => String(s.id)));
  const allocateId = () => {
    let id;
    do { id = `chars-${nextId++}`; } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  return segments.flatMap((segment) => {
    const tokens = segment.text.trim().split(/\s+/u).filter(Boolean);
    if (!tokens.length) return [];
    const timed = words.filter(w => w.start >= segment.start - 0.001 && w.start < segment.end && w.end <= segment.end + 0.001);
    const aligned = timed.length === tokens.length && timed.every((w, i) => w.word.trim() === tokens[i]);
    const groups = [];
    let group = [];
    let first = 0;
    const flush = (endIndex) => {
      if (!group.length) return;
      groups.push({
        ...segment,
        id: allocateId(),
        start: first === 0 ? segment.start : aligned ? timed[first].start : segment.start + (segment.end - segment.start) * first / tokens.length,
        end: endIndex === tokens.length ? segment.end : aligned ? timed[endIndex - 1].end : segment.start + (segment.end - segment.start) * endIndex / tokens.length,
        text: group.join(" "),
      });
      group = [];
      first = endIndex;
    };
    tokens.forEach((token, i) => {
      if (group.length && characterCount([...group, token].join(" ")) > maxCharacters) flush(i);
      group.push(token);
    });
    flush(tokens.length);
    return groups.length === 1 ? [{ ...groups[0], id: segment.id }] : groups;
  });
}
