import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Segment } from '../types';
import type { CaptionOverrides } from '../../captionOverrides.js';
import { captionAnchor, moveCaption, pinchCaption, rotateCaption, type CaptionTransformValues, type Point, type TransformBounds } from '../../captionTransform.js';

type Gesture = { values: CaptionTransformValues; points: Point[]; bounds: TransformBounds; pivot: Point; mode: 'move' | 'rotate' };
export function useCaptionTransform({ stage, caption, segmentId, selected, disabled, values, select, change, showControls }: {
  stage: RefObject<HTMLDivElement>; caption: RefObject<HTMLDivElement>; segmentId: Segment['id'] | null;
  selected: boolean; disabled: boolean; values: CaptionTransformValues;
  select: () => void; change: (patch: CaptionOverrides) => void; showControls: () => void;
}) {
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const currentValues = useRef(values);
  const [active, setActive] = useState(false);
  if (!active) currentValues.current = values;
  const rebase = (mode: Gesture['mode'] = 'move') => {
    if (!stage.current || !caption.current) return;
    const bounds = stage.current.getBoundingClientRect();
    const value = currentValues.current;
    const anchor = captionAnchor(value, bounds);
    const halfHeight = caption.current.offsetHeight / 2;
    const radians = value.rotation * Math.PI / 180;
    gesture.current = { values: { ...value }, points: [...pointers.current.values()], bounds,
      pivot: { x: anchor.x + Math.sin(radians) * halfHeight, y: anchor.y - Math.cos(radians) * halfHeight }, mode };
  };
  const finish = () => {
    const ids = [...pointers.current.keys()];
    pointers.current.clear(); gesture.current = null; setActive(false);
    for (const id of ids) if (stage.current?.hasPointerCapture(id)) stage.current.releasePointerCapture(id);
  };
  useEffect(() => { finish(); }, [segmentId, disabled]);
  useEffect(() => {
    const cancel = () => { if (pointers.current.size) { finish(); showControls(); } };
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); };
  });
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || segmentId == null || event.button !== 0 || pointers.current.size >= 2) return;
    const target = event.target as HTMLElement;
    const handle = target.closest('[data-caption-rotate]');
    const hit = target.closest('[data-testid="caption-position"]');
    if (!hit && !handle && !(event.pointerType === 'touch' && pointers.current.size)) return;
    event.preventDefault(); event.stopPropagation();
    if (!selected) select();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.current?.setPointerCapture(event.pointerId);
    rebase(handle ? 'rotate' : 'move');
    setActive(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !pointers.current.has(event.pointerId) || !gesture.current) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = [...pointers.current.values()], start = gesture.current;
    const patch = current.length === 2 ? pinchCaption(start.values, start.points, current, start.bounds)
      : start.mode === 'rotate' ? rotateCaption(start.values, start.points[0], current[0], start.pivot, start.bounds, event.shiftKey)
        : moveCaption(start.values, current[0].x - start.points[0].x, current[0].y - start.points[0].y, start.bounds);
    currentValues.current = { ...currentValues.current, ...patch };
    change(patch);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
    if (pointers.current.size) rebase();
    else { gesture.current = null; setActive(false); showControls(); }
  };
  const onPointerCancel = () => { if (pointers.current.size) { finish(); showControls(); } };
  return { active, onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
    onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => { if (pointers.current.has(event.pointerId)) onPointerCancel(); } };
}
