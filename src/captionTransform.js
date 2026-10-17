const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const normalizeCaptionAngle = angle => ((angle + 180) % 360 + 360) % 360 - 180;
export function snapCaptionAngle(angle, stepped = false) {
  const normalized = normalizeCaptionAngle(angle);
  const step = stepped ? 15 : 45;
  const nearest = Math.round(normalized / step) * step;
  return normalizeCaptionAngle(Math.round(stepped || Math.abs(nearest - normalized) <= 3 ? nearest : normalized));
}
export const CAPTION_SNAP_PIXELS = 6;
export function moveCaption(values, dx, dy, bounds) {
  const snap = (value, size) => Math.abs(value - 50) * size / 100 <= CAPTION_SNAP_PIXELS ? 50 : clamp(value, 0, 100);
  return { positionXPercent: snap(values.positionXPercent + dx * 100 / bounds.width, bounds.width),
    offsetYPercent: snap(values.offsetYPercent - dy * 100 / bounds.height, bounds.height) };
}
const midpoint = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
const distance = points => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
export function captionAnchor(values, bounds) {
  return { x: bounds.left + values.positionXPercent * bounds.width / 100,
    y: bounds.top + (100 - values.offsetYPercent) * bounds.height / 100 };
}
function transformAnchor(values, bounds, from, to, scale, rotation) {
  const anchor = captionAnchor(values, bounds);
  const radians = rotation * Math.PI / 180;
  const x = (anchor.x - from.x) * scale, y = (anchor.y - from.y) * scale;
  return { positionXPercent: clamp((to.x + x * Math.cos(radians) - y * Math.sin(radians) - bounds.left) * 100 / bounds.width, 0, 100),
    offsetYPercent: clamp(100 - (to.y + x * Math.sin(radians) + y * Math.cos(radians) - bounds.top) * 100 / bounds.height, 0, 100) };
}
// The caption is anchored at its bottom center; its visual center sits half a
// caption height above that anchor along the rotated vertical axis.
export function captionPivot(values, bounds, height) {
  const anchor = captionAnchor(values, bounds), radians = values.rotation * Math.PI / 180;
  return { x: anchor.x + Math.sin(radians) * height / 2, y: anchor.y - Math.cos(radians) * height / 2 };
}
export function scaleCaption(values, start, current, pivot, bounds) {
  const from = Math.hypot(start.x - pivot.x, start.y - pivot.y), to = Math.hypot(current.x - pivot.x, current.y - pivot.y);
  if (from < 8) return {};
  const fontSize = Math.round(clamp(values.fontSize * to / from, 12, 1000));
  return { ...transformAnchor(values, bounds, pivot, pivot, fontSize / values.fontSize, 0), fontSize };
}
export function rotateCaption(values, start, current, pivot, bounds, stepped = false) {
  if (Math.hypot(current.x - pivot.x, current.y - pivot.y) < 8) return {};
  const rotation = snapCaptionAngle(values.rotation + normalizeCaptionAngle(angle(pivot, current) - angle(pivot, start)), stepped);
  return { ...transformAnchor(values, bounds, pivot, pivot, 1, rotation - values.rotation), rotation };
}
export function pinchCaption(values, start, current, bounds) {
  if (distance(start) < 12 || distance(current) < 12) return {};
  const fontSize = Math.round(clamp(values.fontSize * distance(current) / distance(start), 12, 1000));
  const rotation = snapCaptionAngle(values.rotation + normalizeCaptionAngle(angle(current[0], current[1]) - angle(start[0], start[1])));
  return { ...transformAnchor(values, bounds, midpoint(start), midpoint(current), fontSize / values.fontSize, rotation - values.rotation), fontSize, rotation };
}
