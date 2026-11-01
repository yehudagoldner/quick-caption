import { canSplitCaptionAtTime, editCaptionBatch } from './captionBatchEditing.js';

export const VIDEO_FORMATS = [
  { id: 'original', label: 'מקור', platforms: 'YouTube', ratio: null },
  { id: 'vertical', label: '9:16', platforms: 'TikTok · Reels · Shorts · Stories', ratio: 9 / 16 },
  { id: 'square', label: '1:1', platforms: 'Instagram · Facebook', ratio: 1 },
  { id: 'portrait', label: '4:5', platforms: 'Instagram · Facebook', ratio: 4 / 5 },
];
const clamp = value => Math.max(0, Math.min(1, value));
export function validateVideoCrop(value) {
  if (!value || !VIDEO_FORMATS.some(format => format.id === value.format && format.ratio)) throw new Error('Invalid crop format');
  if (![value.x, value.y].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Invalid crop position');
  const points = value.points ?? [];
  if (!Array.isArray(points) || points.length > 600) throw new Error('Invalid crop path');
  let previous = -1;
  for (const point of points) {
    if (!point || !Number.isFinite(point.time) || point.time < 0 || point.time > 86400 || point.time <= previous
      || ![point.x, point.y].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Invalid crop path');
    previous = point.time;
  }
  return { format: value.format, x: value.x, y: value.y, points: points.map(({ time, x, y }) => ({ time, x, y })) };
}
export function cropPosition(crop, time = 0) {
  const points = crop.points ?? [];
  if (!points.length) return { x: clamp(crop.x), y: clamp(crop.y) };
  if (time <= points[0].time) return points[0];
  for (let i = 1; i < points.length; i++) {
    if (time > points[i].time) continue;
    const a = points[i - 1], b = points[i], progress = (time - a.time) / (b.time - a.time);
    return { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
  }
  return points.at(-1);
}
export function cropRectangle(source, crop, time = 0) {
  const ratio = VIDEO_FORMATS.find(format => format.id === crop?.format)?.ratio;
  if (!ratio) return { x: 0, y: 0, width: source.width, height: source.height };
  const width = Math.max(2, Math.floor(Math.min(source.width, source.height * ratio) / 2) * 2);
  const height = Math.max(2, Math.floor(Math.min(source.height, source.width / ratio) / 2) * 2);
  const position = cropPosition(crop, time);
  return { x: Math.round((source.width - width) * position.x), y: Math.round((source.height - height) * position.y), width, height };
}
// Balanced conditions keep long tracking paths below FFmpeg's expression depth limit.
function pathExpression(points, axis, from = 0, to = points.length - 1) {
  if (points.slice(from, to + 1).every(point => point[axis] === points[from][axis])) return String(points[from][axis]);
  if (from === to) return String(points[from][axis]);
  if (to - from === 1) {
    const a = points[from], b = points[to];
    return `(${a[axis]}+(${b[axis] - a[axis]})*clip((t-${a.time})/${b.time - a.time},0,1))`;
  }
  const middle = Math.floor((from + to) / 2);
  return `if(lt(t,${points[middle].time}),${pathExpression(points, axis, from, middle)},${pathExpression(points, axis, middle, to)})`;
}
export function cropFilter(value) {
  const crop = validateVideoCrop(value);
  const ratio = VIDEO_FORMATS.find(format => format.id === crop.format).ratio;
  const x = crop.points.length ? pathExpression(crop.points, 'x') : crop.x;
  const y = crop.points.length ? pathExpression(crop.points, 'y') : crop.y;
  return `crop=w='floor(min(iw,ih*${ratio})/2)*2':h='floor(min(ih,iw/${ratio})/2)*2':x='(iw-ow)*(${x})':y='(ih-oh)*(${y})',setsar=1`;
}
// Match by source time, never by IDs: versions can already have different splits.
export function splitVideoVersions(versions, time) {
  return Object.fromEntries(Object.entries(versions).map(([id, revision]) => {
    const segment = revision.segments.find(s => canSplitCaptionAtTime(s, time));
    return [id, segment ? editCaptionBatch(revision.segments, revision.words, [segment.id], 'split', time) : revision];
  }));
}
