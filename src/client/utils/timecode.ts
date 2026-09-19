export function formatTimecode(seconds: number, fps: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) * fps + 1e-7));
  const frames = total % fps;
  const wholeSeconds = Math.floor(total / fps);
  return [Math.floor(wholeSeconds / 3600), Math.floor(wholeSeconds / 60) % 60, wholeSeconds % 60, frames]
    .map((n, index) => String(n).padStart(index === 3 && fps > 100 ? 3 : 2, "0")).join(":");
}
export function snapToFrame(seconds: number, fps: number) { return Math.round(seconds * fps) / fps; }
