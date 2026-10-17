import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Segment } from '../types';
import type { CaptionOverrides } from '../../captionOverrides.js';
import { captionPivot, moveCaption, pinchCaption, rotateCaption, scaleCaption, type CaptionTransformValues, type Point, type TransformBounds } from '../../captionTransform.js';

export type CaptionGestureMode = 'move' | 'rotate' | 'scale' | 'pinch';
type Gesture = { values: CaptionTransformValues; points: Point[]; bounds: TransformBounds; pivot: Point; mode: CaptionGestureMode };

const snappedState = (value: CaptionTransformValues, mode: CaptionGestureMode) =>
  mode === 'move' ? `${value.positionXPercent === 50}${value.offsetYPercent === 50}` : mode === 'scale' ? '' : String(value.rotation % 45 === 0);

export function useCaptionTransform({ stage, caption, segmentId, selected, disabled, values, select, preview, commit, showControls }: {
  stage: RefObject<HTMLDivElement>; caption: RefObject<HTMLDivElement>; segmentId: Segment['id'] | null;
  selected: boolean; disabled: boolean; values: CaptionTransformValues;
  select: () => void; preview: (patch: CaptionOverrides | null) => void; commit: (patch: CaptionOverrides) => void; showControls: () => void;
}) {
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const live = useRef(values);
  const patch = useRef<CaptionOverrides>({});
  const snapped = useRef('');
  const [mode, setMode] = useState<CaptionGestureMode | null>(null);
  if (!mode) live.current = values;
  const rebase = (next: CaptionGestureMode) => {
    if (!stage.current || !caption.current) return;
    const bounds = stage.current.getBoundingClientRect();
    gesture.current = { values: { ...live.current }, points: [...pointers.current.values()], bounds,
      pivot: captionPivot(live.current, bounds, caption.current.offsetHeight), mode: next };
    snapped.current = snappedState(live.current, next);
    setMode(next);
  };
  const release = () => {
    for (const id of pointers.current.keys()) if (stage.current?.hasPointerCapture(id)) stage.current.releasePointerCapture(id);
    pointers.current.clear(); gesture.current = null; setMode(null);
  };
  const finish = () => {
    const result = patch.current;
    patch.current = {};
    release();
    if (Object.keys(result).length) commit(result); else preview(null);
    showControls();
  };
  const abort = () => {
    if (!pointers.current.size) return;
    patch.current = {}; release(); preview(null);
  };
  useEffect(abort, [segmentId, disabled]);
  useEffect(() => {
    const cancel = () => { if (pointers.current.size) finish(); };
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); };
  });
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    // iOS Safari can still start a page scroll or callout from a non-passive touch.
    const block = (event: TouchEvent) => { if (pointers.current.size) event.preventDefault(); };
    element.addEventListener('touchmove', block, { passive: false });
    return () => element.removeEventListener('touchmove', block);
  }, [stage]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || segmentId == null || event.button !== 0 || pointers.current.size >= 2) return;
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-caption-handle]')?.dataset.captionHandle;
    const hit = target.closest('[data-testid="caption-position"]');
    // Once selected, the whole preview moves that caption: on a phone the text
    // is often smaller than a fingertip.
    if (!hit && !selected && !(event.pointerType === 'touch' && pointers.current.size)) return;
    event.preventDefault(); event.stopPropagation();
    if (!selected) select();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.current?.setPointerCapture(event.pointerId);
    rebase(pointers.current.size === 2 ? 'pinch' : handle === 'rotate' || handle === 'scale' ? handle : 'move');
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = [...pointers.current.values()], start = gesture.current;
    const next = start.mode === 'pinch' && current.length === 2 ? pinchCaption(start.values, start.points, current, start.bounds)
      : start.mode === 'rotate' ? rotateCaption(start.values, start.points[0], current[0], start.pivot, start.bounds, event.shiftKey)
        : start.mode === 'scale' ? scaleCaption(start.values, start.points[0], current[0], start.pivot, start.bounds)
          : moveCaption(start.values, current[0].x - start.points[0].x, current[0].y - start.points[0].y, start.bounds);
    live.current = { ...live.current, ...next };
    patch.current = { ...patch.current, ...next };
    const state = snappedState(live.current, start.mode);
    if (state !== snapped.current && state.includes('true')) navigator.vibrate?.(8);
    snapped.current = state;
    preview(patch.current);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
    if (pointers.current.size) rebase('move');
    else finish();
  };
  const onPointerCancel = () => { if (pointers.current.size) finish(); };
  return { mode, onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
    onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => { if (pointers.current.has(event.pointerId)) onPointerCancel(); } };
}
