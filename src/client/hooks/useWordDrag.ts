import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { snapWordBottom, wordDragDelta, type WordDelta } from '../../wordOverrides.js';

type WordBounds = { left: number; right: number; bottom: number };
type Alignment = { moving: WordBounds; target: WordBounds };
type Guide = { left: number; width: number; top: number; snapped: boolean };

function alignmentFor(element: HTMLSpanElement, indexes: number[], rotation: number): Alignment | null {
  const overlay = element.closest<HTMLElement>('[data-testid="subtitle-overlay"]');
  if (!overlay) return null;
  const bounds = overlay.getBoundingClientRect();
  const angle = rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const boxes = Array.from(overlay.querySelectorAll<HTMLElement>('[data-word-index]')).map(word => {
    const rect = word.getBoundingClientRect();
    const dx = rect.x + rect.width / 2 - (bounds.x + bounds.width / 2);
    const dy = rect.y + rect.height / 2 - (bounds.y + bounds.height / 2);
    const x = overlay.offsetWidth / 2 + dx * cos + dy * sin;
    const y = overlay.offsetHeight / 2 - dx * sin + dy * cos;
    return { selected: indexes.includes(Number(word.dataset.wordIndex)), left: x - word.offsetWidth / 2,
      right: x + word.offsetWidth / 2, bottom: y + word.offsetHeight / 2 };
  });
  const moving = boxes.filter(box => box.selected), others = boxes.filter(box => !box.selected);
  if (!moving.length || !others.length) return null;
  return { moving: { left: Math.min(...moving.map(box => box.left)), right: Math.max(...moving.map(box => box.right)), bottom: Math.max(...moving.map(box => box.bottom)) },
    target: others.reduce((lowest, box) => box.bottom > lowest.bottom ? box : lowest) };
}

export function useWordDrag({ selected, disabled, rotation, move }: {
  selected: number[]; disabled: boolean; rotation: number; move: (indexes: number[], delta: WordDelta) => void;
}) {
  const gesture = useRef<{ element: HTMLSpanElement; pointer: number; x: number; y: number; size: number; indexes: number[]; delta: WordDelta; alignment: Alignment | null } | null>(null);
  const [live, setLive] = useState<{ indexes: number[]; delta: WordDelta; guide: Guide | null } | null>(null);
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
      gesture.current = { element: event.currentTarget, pointer: event.pointerId, x: event.clientX, y: event.clientY, size, indexes: [...selected], delta: { x: 0, y: 0 },
        alignment: alignmentFor(event.currentTarget, selected, rotation) };
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
      const current = gesture.current;
      if (!current || current.pointer !== event.pointerId) return;
      event.stopPropagation();
      if (!suppressClick.current && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4) return;
      suppressClick.current = true;
      current.delta = wordDragDelta(event.clientX - current.x, event.clientY - current.y, current.size, rotation);
      let guide: Guide | null = null;
      if (current.alignment) {
        const { moving, target } = current.alignment;
        const snap = snapWordBottom(current.delta, moving.bottom, target.bottom, current.size);
        current.delta = snap.delta;
        const left = Math.min(target.left, moving.left + current.delta.x * current.size) - 8;
        guide = { left, width: Math.max(target.right, moving.right + current.delta.x * current.size) + 8 - left,
          top: target.bottom, snapped: snap.snapped };
      }
      setLive({ indexes: current.indexes, delta: current.delta, guide });
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
