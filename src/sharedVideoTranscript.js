import { alignSequence, synchronizeWords } from './wordAlignment.js';

const copy = value => structuredClone(value);
const equalTime = (a, b) => Math.abs(a - b) < 1e-6;
let sequence = 0;
const newId = () => `shared-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;

// Trim unchanged runs before alignment: a correction in a long recording must
// not allocate a matrix for the entire transcript. Explicit IDs win for repeats.
function align(words, source) {
  let left = 0, right = 0;
  const matches = (a, b) => a.sourceId ? a.sourceId === b.sourceId : a.word === b.word;
  while (left < words.length && left < source.length && matches(words[left], source[left])) left++;
  while (right < words.length - left && right < source.length - left && matches(words.at(-right - 1), source.at(-right - 1))) right++;
  const middle = words.slice(left, words.length - right), old = source.slice(left, source.length - right);
  if ((middle.length + 1) * (old.length + 1) > 2_000_000) throw new Error('השינוי גדול מדי לסנכרון בטוח. ערכו כמה כתוביות בכל פעם.');
  return [...source.slice(0, left), ...alignSequence(middle.map(w => w.word), old), ...source.slice(source.length - right)];
}

function identify(revision, source = []) {
  const words = synchronizeWords(revision.segments, revision.words);
  const byId = new Map(source.map(w => [w.sourceId, w]));
  const aligned = align(words, source), used = new Set();
  return { segments: copy(revision.segments), words: words.map((word, i) => {
    const anchor = byId.get(word.sourceId) ?? aligned[i];
    const id = word.sourceId ?? anchor?.sourceId ?? newId();
    const sourceId = used.has(id) ? newId() : id; used.add(sourceId);
    return { ...word, sourceId, sourceStart: word.sourceStart ?? anchor?.sourceStart ?? word.start,
      sourceEnd: word.sourceEnd ?? anchor?.sourceEnd ?? word.end };
  }) };
}

export function linkVideoRevisions(revisions, sourceRevision = Object.values(revisions).find(r => r.words.some(w => w.sourceId))) {
  const original = identify(revisions.original, sourceRevision?.words ?? []);
  return Object.fromEntries(Object.entries(revisions).map(([id, revision]) =>
    [id, id === 'original' ? original : identify(revision, original.words)]));
}

function project(revision) {
  return { segments: revision.segments, words: synchronizeWords(revision.segments,
    revision.words.map(w => ({ ...w, start: w.sourceStart ?? w.start, end: w.sourceEnd ?? w.end }))) };
}

function textForWords(segment, before, after) {
  if (before.length === after.length && before.every((w, i) => w.sourceId === after[i].sourceId)) {
    let i = 0;
    return segment.text.replace(/\S+/gu, () => after[i++]?.word ?? '');
  }
  // Keep line breaks attached to surviving words; inserted words get one space.
  const separators = [...segment.text.matchAll(/(\s*)(\S+)/gu)];
  const spacing = new Map(before.map((w, i) => [w.sourceId, separators[i]?.[1] ?? ' ']));
  return after.map((w, i) => (i ? spacing.get(w.sourceId) || ' ' : '') + w.word).join('');
}

// Caption membership/appearance are local. Only explicit content/word edits
// change the shared transcript; splitting or moving a caption never does.
export function editVideoTranscript(revisions, activeId, nextRevision, { layoutOnly = false } = {}) {
  const before = linkVideoRevisions(revisions), previous = before[activeId];
  if (!previous) throw new Error('גרסת הסרטון אינה זמינה.');
  const next = identify(nextRevision, previous.words);
  const oldById = new Map(previous.words.map(w => [w.sourceId, w]));
  next.words = next.words.map(w => {
    const old = oldById.get(w.sourceId);
    return { ...w,
      sourceStart: old && (layoutOnly || equalTime(w.start, old.start)) ? old.sourceStart : w.start,
      sourceEnd: old && (layoutOnly || equalTime(w.end, old.end)) ? old.sourceEnd : w.end };
  });
  if (layoutOnly) return { ...before, [activeId]: project(next) };
  const nextById = new Map(next.words.map(w => [w.sourceId, w]));
  const removed = new Set(previous.words.filter(w => !nextById.has(w.sourceId)).map(w => w.sourceId));
  const changed = new Map(next.words.filter(w => {
    const old = oldById.get(w.sourceId);
    return old && (old.word !== w.word || !equalTime(old.sourceStart, w.sourceStart) || !equalTime(old.sourceEnd, w.sourceEnd));
  }).map(w => [w.sourceId, w]));
  const added = next.words.filter(w => !oldById.has(w.sourceId));
  // A local split may clip a neighbour out of the visible word track. Validate
  // against source times as well, so that editing there cannot overlap speech
  // owned by a different caption in another version.
  const canonical = new Map(Object.values(before).flatMap(r => r.words).map(w => [w.sourceId, w]));
  for (const id of removed) canonical.delete(id);
  for (const word of [...changed.values(), ...added]) canonical.set(word.sourceId, word);
  const ordered = [...canonical.values()].sort((a, b) => a.sourceStart - b.sourceStart);
  const timingChanged = new Set([...changed.values(), ...added].filter(w => {
    const old = oldById.get(w.sourceId);
    return !old || !equalTime(old.sourceStart, w.sourceStart) || !equalTime(old.sourceEnd, w.sourceEnd);
  }).map(w => w.sourceId));
  for (let i = 1; i < ordered.length; i++) {
    if ((timingChanged.has(ordered[i].sourceId) || timingChanged.has(ordered[i - 1].sourceId))
      && ordered[i].sourceStart < ordered[i - 1].sourceEnd - 1e-6) {
      throw new Error('התזמון חופף למילה בכתובית אחרת. בחרו טווח פנוי בציר הזמן הכללי.');
    }
  }
  const order = new Map(next.words.map((w, i) => [w.sourceId, i]));
  const after = { ...before, [activeId]: project(next) };
  for (const [id, target] of Object.entries(before)) {
    if (id === activeId) continue;
    const owners = new Map(target.words.map(w => [w.sourceId, w.segmentId]));
    const touched = new Set();
    const words = target.words.flatMap(word => {
      if (removed.has(word.sourceId)) { touched.add(word.segmentId); return []; }
      const change = changed.get(word.sourceId);
      if (!change) return [word];
      touched.add(word.segmentId);
      return [{ ...word, word: change.word, sourceStart: change.sourceStart, sourceEnd: change.sourceEnd }];
    });
    let segments = copy(target.segments);
    for (const word of added) {
      const index = order.get(word.sourceId);
      const left = next.words.slice(0, index).reverse().find(w => owners.has(w.sourceId));
      const right = next.words.slice(index + 1).find(w => owners.has(w.sourceId));
      const anchor = left?.segmentId === word.segmentId ? left : right?.segmentId === word.segmentId ? right : left ?? right;
      let owner = anchor && owners.get(anchor.sourceId);
      if (owner === undefined) {
        // Replacing the whole text still preserves the target's caption ranges.
        const distance = s => Math.max(s.start - word.sourceStart, word.sourceEnd - s.end, 0);
        owner = [...segments].sort((a, b) => distance(a) - distance(b))[0]?.id;
      }
      if (owner === undefined) {
        const template = next.segments.find(s => s.id === word.segmentId);
        const segment = { ...template, id: `caption-${word.sourceId}`, text: '' };
        segments.push(segment); owner = segment.id;
      }
      touched.add(owner); owners.set(word.sourceId, owner);
      const { style: _localStyle, ...sharedWord } = word;
      words.push({ ...sharedWord, segmentId: owner });
    }
    segments = segments.map(segment => {
      if (!touched.has(segment.id)) return segment;
      const own = words.filter(w => w.segmentId === segment.id).sort((a, b) =>
        (order.get(a.sourceId) ?? Infinity) - (order.get(b.sourceId) ?? Infinity) || a.sourceStart - b.sourceStart);
      return { ...segment, text: textForWords(segment, target.words.filter(w => w.segmentId === segment.id), own) };
    });
    after[id] = project({ segments, words });
  }
  return after;
}
