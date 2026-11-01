import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { wordDragDelta, type WordDelta } from '../../wordOverrides.js';

export function useWordDrag({ selected, disabled, rotation, move }: {
  selected: number[]; disabled: boolean; rotation: number; move: (indexes: number[], delta: WordDelta) => void;
}) {
  const gesture = useRef<{ element: HTMLSpanElement; pointer: number; x: number; y: number; size: number; indexes: number[]; delta: WordDelta } | null>(null);
  const [live, setLive] = useState<{ indexes: number[]; delta: WordDelta } | null>(null);
  const suppressClick = useRef(false);
  const cancel = () => {
    const current = gesture.current; gesture.current = null;
    if (current?.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer);
    setLive(null);
  };
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  useEffect(() => {
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); };
  }, []);
  const handlers = (index: number) => ({
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      if (!selected.includes(index)) return;
      event.stopPropagation();
      if (disabled || event.button !== 0 || gesture.current) return;
      const size = parseFloat(getComputedStyle(event.currentTarget.parentElement!).fontSize);
      if (!(size > 0)) return;
      event.preventDefault(); suppressClick.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { element: event.currentTarget, pointer: event.pointerId, x: event.clientX, y: event.clientY, size, indexes: [...selected], delta: { x: 0, y: 0 } };
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      event.stopPropagation();
      if (!suppressClick.current && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4) return;
      suppressClick.current = true;
      current.delta = wordDragDelta(event.clientX - current.x, event.clientY - current.y, current.size, rotation);
      setLive({ indexes: current.indexes, delta: current.delta });
    },
    onPointerUp: (event: PointerEvent<HTMLSpanElement>) => {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      event.stopPropagation(); cancel();
      if (suppressClick.current) move(current.indexes, current.delta);
    },
    onPointerCancel: () => { suppressClick.current = true; cancel(); },
    onLostPointerCapture: () => { if (gesture.current) cancel(); },
  });
  return { live, handlers, consumeClick: () => { const suppressed = suppressClick.current; suppressClick.current = false; return suppressed; } };
}
