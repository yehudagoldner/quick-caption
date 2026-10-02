import { synchronizeWords } from "./wordAlignment.js";

export const sanitizeCaptionMotion = value => value === "pop" ? "pop" : "none";
export const sanitizePopIntensity = value => value === "strong" ? "strong" : "gentle";

const presets = {
  gentle: { duration: 160, start: .82, peak: 1.05 },
  strong: { duration: 220, start: .65, peak: 1.12 },
};

export function popPeakScale(intensity) {
  return presets[sanitizePopIntensity(intensity)].peak;
}

// ASS uses centiseconds. Quantize preview cues as well so seeking, pauses,
// short words and the burned video all show the same animation phase.
export function wordPopCues(words) {
  const ordered = words.filter(word => Number.isFinite(word.start) && Number.isFinite(word.end)).slice().sort((a, b) => a.start - b.start);
  return ordered.map((word, index) => {
    const start = Math.max(0, Math.round(word.start * 100));
    const end = Math.round(Math.min(word.end, ordered[index + 1]?.start ?? Infinity) * 100);
    return { ...word, start: start / 100, end: end / 100 };
  }).filter(word => word.end > word.start);
}

export function popKeyframes(durationSeconds, intensity) {
  const preset = presets[sanitizePopIntensity(intensity)];
  const duration = Math.max(1, Math.min(preset.duration, Math.round(durationSeconds * 800)));
  return [
    { time: 0, scale: preset.start },
    { time: Math.round(duration * .3), scale: .96 },
    { time: Math.round(duration * .65), scale: preset.peak },
    { time: duration, scale: 1 },
  ];
}

export function wordPopScale(word, currentTime, intensity) {
  const frames = popKeyframes(word.end - word.start, intensity);
  const elapsed = Math.max(0, (currentTime - word.start) * 1000);
  for (let i = 1; i < frames.length; i++) {
    const from = frames[i - 1], to = frames[i];
    if (elapsed <= to.time && to.time > from.time) {
      return from.scale + (to.scale - from.scale) * (elapsed - from.time) / (to.time - from.time);
    }
  }
  return 1;
}

const assTime = seconds => {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

// User text must never become ASS override tags, drawings or forced line breaks.
// Full-width braces/backslash retain readable punctuation without introducing
// an executable ASS sequence. Direction markers are supplied by us only.
export function escapeAssText(text) {
  return String(text).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\\/g, "＼").replace(/\{/g, "｛").replace(/\}/g, "｝").replace(/[\r\n]+/g, " ");
}

export function renderWordPopAss(segments, sourceWords, { intensity = "gentle", direction = "rtl", videoWidth = 1000, videoHeight = 1000, outlineWidth = 3 } = {}) {
  const cues = wordPopCues(synchronizeWords(segments, sourceWords));
  const scaled = scale => `\\fscx${Math.round(scale * 100)}\\fscy${Math.round(scale * 100)}\\bord${(outlineWidth * scale).toFixed(2)}`;
  const events = cues.map(word => {
    const frames = popKeyframes(word.end - word.start, intensity);
    const transforms = frames.slice(1).map((frame, index) => `\\t(${frames[index].time},${frame.time},${scaled(frame.scale)})`).join("");
    const text = `${direction === "ltr" ? "\u202a" : "\u202b"}${escapeAssText(word.word)}\u202c`;
    return `Dialogue: 0,${assTime(word.start)},${assTime(word.end)},Default,,0,0,0,,{\\an2${scaled(frames[0].scale)}${transforms}}${text}`;
  });
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${videoWidth}\nPlayResY: ${videoHeight}\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Assistant SemiBold,105,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${outlineWidth},0,2,0,0,0,-1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`;
}
