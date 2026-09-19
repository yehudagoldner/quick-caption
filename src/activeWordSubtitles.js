import { synchronizeWords, activeWordAtTime } from "./wordAlignment.js";

const escapeText = text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const timestamp = ms => {
  const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, seconds = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

// Render the entire caption in each interval, colouring only the active token.
// Inline colour tags survive FFmpeg/libass burning; ordinary SRT/VTT exports
// remain unchanged. Millisecond boundaries prevent rounded, overlapping cues.
export function renderActiveWordSrt(segments, sourceWords, direction = "rtl") {
  const words = synchronizeWords(segments, sourceWords);
  const events = [];
  for (const segment of segments) {
    const owned = words.filter(w => w.segmentId === segment.id);
    const start = Math.max(0, Math.round(segment.start * 1000));
    const end = Math.max(start, Math.round(segment.end * 1000));
    const boundaries = [...new Set([start, end, ...owned.flatMap(w => [Math.round(w.start * 1000), Math.round(w.end * 1000)])])].filter(t => t >= start && t <= end).sort((a, b) => a - b);
    let last = null;
    for (let i = 0; i < boundaries.length - 1; i++) {
      const from = boundaries[i], to = boundaries[i + 1];
      if (to <= from) continue;
      const active = activeWordAtTime(owned, (from + to) / 2000)?.wordIndex;
      let wordIndex = 0;
      const content = String(segment.text).replace(/[\u202a-\u202e]/g, "").split(/(\s+)/).map(part => {
        if (!part.trim()) return part;
        const text = escapeText(part);
        return wordIndex++ === active ? `<font color="#FFD700">${text}</font>` : text;
      }).join("");
      const text = content.split("\n").map(line => `${direction === "ltr" ? "\u202a" : "\u202b"}${line}\u202c`).join("\n");
      if (last?.text === text && last.end === from) last.end = to;
      else { last = { start: from, end: to, text }; events.push(last); }
    }
  }
  return events.map((e, i) => `${i + 1}\n${timestamp(e.start)} --> ${timestamp(e.end)}\n${e.text}\n`).join("\n");
}
