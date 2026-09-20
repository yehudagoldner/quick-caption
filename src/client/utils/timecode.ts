export function formatTimecode(seconds: number, fps: number): string {
  // HTMLMediaElement rounds seeks to microseconds; do not show the previous frame.
  const total = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) * fps + .0001));
  const frames = total % fps;
  const wholeSeconds = Math.floor(total / fps);
  return [Math.floor(wholeSeconds / 3600), Math.floor(wholeSeconds / 60) % 60, wholeSeconds % 60, frames]
    .map((n, index) => String(n).padStart(index === 3 && fps > 100 ? 3 : 2, "0")).join(":");
}
export function snapToFrame(seconds: number, fps: number) { return Math.round(seconds * fps) / fps; }

export function parseTimecode(value: string, fps: number): number | null {
  const match = /^(\d{2,}):(\d{2}):(\d{2}):(\d{2,3})$/.exec(value.trim());
  if (!match) return null;
  const [, h, m, s, f] = match.map(Number);
  if (m >= 60 || s >= 60 || f >= fps) return null;
  return h * 3600 + m * 60 + s + f / fps;
}
