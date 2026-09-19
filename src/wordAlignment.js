// Shared by the model pipeline, editor and renderer. Caption text is the source
// of truth; timing data may enrich it, but must never add or remove its words.
export const subtitleTokens = text => String(text ?? "").trim().split(/\s+/u).filter(Boolean);
const normalize = text => text.normalize("NFKD").replace(/[\p{M}\p{P}\p{Cf}]/gu, "").toLocaleLowerCase();

function alignSequence(tokens, source) {
  const n = source.length, m = tokens.length;
  if (!n) return Array(m).fill(null);
  // Avoid quadratic allocations for malformed/unusually large imported cues.
  if ((n + 1) * (m + 1) > 2_000_000) return Array(m).fill(null);
  const a = source.map(w => normalize(w.word));
  const b = tokens.map(normalize);
  const width = m + 1;
  const cost = new Float64Array((n + 1) * width);
  const operation = new Uint8Array(cost.length);
  for (let i = 1; i <= n; i++) { cost[i * width] = i; operation[i * width] = 2; }
  for (let j = 1; j <= m; j++) { cost[j] = j; operation[j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const index = i * width + j;
      let best = cost[(i - 1) * width + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1.25);
      let op = 1;
      const choose = (value, candidate) => { if (value < best) { best = value; op = candidate; } };
      choose(cost[(i - 1) * width + j] + 1, 2); // deletion: do NOT resurrect the old word
      choose(cost[i * width + j - 1] + 1, 3);
      if (i >= 2 && a[i - 2] && a[i - 2] + a[i - 1] === b[j - 1]) choose(cost[(i - 2) * width + j - 1] + .15, 4);
      if (j >= 2 && b[j - 2] && b[j - 2] + b[j - 1] === a[i - 1]) choose(cost[(i - 1) * width + j - 2] + .15, 5);
      cost[index] = best; operation[index] = op;
    }
  }
  const aligned = Array(m).fill(null);
  let i = n, j = m;
  while (i || j) {
    const op = operation[i * width + j];
    if (op === 1) {
      aligned[j - 1] = { ...source[i - 1], timingSource: a[i - 1] === b[j - 1] ? source[i - 1].timingSource ?? "original" : "aligned" };
      i--; j--;
    } else if (op === 2) i--;
    else if (op === 3) j--;
    else if (op === 4) {
      aligned[j - 1] = { start: source[i - 2].start, end: source[i - 1].end, timingSource: "aligned" };
      i -= 2; j--;
    } else if (op === 5) {
      const { start, end } = source[i - 1];
      const middle = start + (end - start) * b[j - 2].length / (b[j - 2].length + b[j - 1].length);
      aligned[j - 2] = { start, end: middle, timingSource: "estimated" };
      aligned[j - 1] = { start: middle, end, timingSource: "estimated" };
      i--; j -= 2;
    } else throw new Error("Invalid word alignment state");
  }
  return aligned;
}

function timeUnmatchedWords(aligned, start, end) {
  for (let i = 0; i < aligned.length;) {
    if (aligned[i]) { i++; continue; }
    const from = i;
    while (i < aligned.length && !aligned[i]) i++;
    const count = i - from;
    const previous = aligned[from - 1], next = aligned[i];
    let left = previous?.end ?? start;
    let right = next?.start ?? end;
    // Insertions next to a tight anchor need a share of its interval, not a
    // made-up 300 ms extending into the following caption.
    if (right - left < count * .015) {
      if (next && next.end > left) {
        right = left + (next.end - left) * count / (count + 1);
        next.start = right; next.timingSource = "estimated";
      } else if (previous && right > previous.start) {
        left = previous.start + (right - previous.start) / (count + 1);
        previous.end = left; previous.timingSource = "estimated";
      }
    }
    for (let k = 0; k < count; k++) aligned[from + k] = {
      start: left + (right - left) * k / count,
      end: left + (right - left) * (k + 1) / count,
      timingSource: "estimated",
    };
  }
  // Guarantee finite, positive, monotonic intervals inside this caption even
  // for overlapping/zero-length source timestamps. Leave valid anchors intact.
  const epsilon = Math.min(.001, (end - start) / (aligned.length * 4));
  let previousEnd = start;
  return aligned.map((word, i) => {
    const upper = end - (aligned.length - i) * epsilon;
    const nextStart = aligned[i + 1]?.start ?? end;
    const safeStart = Math.min(upper, Math.max(previousEnd, start, word.start));
    const safeEnd = Math.max(safeStart + epsilon, Math.min(end - (aligned.length - i - 1) * epsilon, word.end, Math.max(safeStart + epsilon, nextStart)));
    previousEnd = safeEnd;
    return { start: safeStart, end: safeEnd, timingSource: safeStart !== word.start || safeEnd !== word.end ? "estimated" : word.timingSource };
  });
}

export function synchronizeWords(segments, originalWords = []) {
  const validSegments = segments.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  const buckets = validSegments.map(() => []);
  const byId = new Map(validSegments.map((s, i) => [String(s.id), i]));
  const source = (Array.isArray(originalWords) ? originalWords : []).flatMap(w => {
    if (!w || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end <= w.start) return [];
    const tokens = subtitleTokens(w.word);
    if (tokens.length === 1) return [{ ...w, word: tokens[0] }];
    return tokens.map((word, i) => ({ ...w, word, start: w.start + (w.end - w.start) * i / tokens.length, end: w.start + (w.end - w.start) * (i + 1) / tokens.length }));
  }).sort((a, b) => a.start - b.start);
  for (const word of source) {
    let owner = -1, bestOverlap = 0;
    const known = word.segmentId === undefined ? undefined : byId.get(String(word.segmentId));
    if (known !== undefined) {
      const s = validSegments[known];
      if (word.start >= s.start - .001 && word.end <= s.end + .001) owner = known;
    }
    if (owner < 0) validSegments.forEach((s, i) => {
      const overlap = Math.min(s.end, word.end) - Math.max(s.start, word.start);
      if (overlap > bestOverlap) { bestOverlap = overlap; owner = i; }
    });
    if (owner >= 0) {
      const s = validSegments[owner];
      buckets[owner].push({ ...word, start: Math.max(s.start, word.start), end: Math.min(s.end, word.end) });
    }
  }
  return validSegments.flatMap((segment, index) => {
    const tokens = subtitleTokens(segment.text);
    if (!tokens.length) return [];
    const mapped = alignSequence(tokens, buckets[index]);
    const timed = timeUnmatchedWords(mapped, segment.start, segment.end);
    return tokens.map((word, wordIndex) => ({ word, ...timed[wordIndex], segmentId: segment.id, wordIndex }));
  });
}

// Correction models may omit/reorder cues or serialize numeric IDs as strings.
// Keep every base cue, its order and original boundaries; text is the only edit.
export function mergeCorrectedSegments(baseSegments, corrections) {
  const byId = new Map();
  const known = new Set(baseSegments.map(s => String(s.id)));
  for (const correction of corrections) {
    const id = String(correction.id);
    if (!known.has(id)) throw new Error(`Correction output references unknown segment id ${id}`);
    if (byId.has(id)) throw new Error(`Correction output repeats segment id ${id}`);
    byId.set(id, correction);
  }
  return baseSegments.map(s => ({ ...s, text: String(byId.get(String(s.id))?.text ?? "").trim() || s.text }));
}

export function activeWordAtTime(words, time) {
  return words.find(w => time >= w.start && time < w.end) ?? null;
}
