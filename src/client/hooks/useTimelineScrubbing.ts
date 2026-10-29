import { useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";
import type { TimelineState } from "@xzdarcy/react-timeline-editor";

// Capture empty-space/cursor gestures before the library's clip drag handlers.
export function useTimelineScrubbing(timeline: RefObject<TimelineState | null>, pixelsPerSecond: number, onSeek: (time: number) => void) {
  const pointer = useRef<{ id: number; x: number; pan?: { startX: number; scroll: number; moved: boolean } } | null>(null);
  const animation = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const seekAt = (clientX: number) => {
    const editor = timeline.current?.target;
    if (!editor) return;
    const grid = editor.querySelector<HTMLElement>(".timeline-editor-edit-area .ReactVirtualized__Grid");
    const scroll = grid?.scrollLeft ?? 0;
    // startLeft is the timeline library's default 20px ruler inset.
    onSeek(Math.max(0, (clientX - editor.getBoundingClientRect().left + scroll - 20) / pixelsPerSecond));
  };
  const seekRef = useRef(seekAt);
  seekRef.current = seekAt;
  const stopScrolling = () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  };
  useEffect(() => stopScrolling, []);
  const scrollAtEdge = () => {
    animation.current = null;
    const drag = pointer.current, editor = timeline.current?.target;
    if (!drag || !editor) return;
    const rect = editor.getBoundingClientRect();
    const direction = drag.x < rect.left + 16 ? -1 : drag.x > rect.right - 16 ? 1 : 0;
    const grid = editor.querySelector<HTMLElement>(".timeline-editor-edit-area .ReactVirtualized__Grid");
    if (!direction || !grid) return;
    // Both virtualized grids share scrolling but have different content widths.
    // Stay within their common range to avoid ScrollSync bouncing at the end.
    const grids = Array.from(editor.querySelectorAll<HTMLElement>(".ReactVirtualized__Grid"));
    const maxScroll = Math.floor(Math.min(...grids.map(el => el.scrollWidth - el.clientWidth)));
    const next = Math.max(0, Math.min(maxScroll, grid.scrollLeft + direction * 12));
    if (next === grid.scrollLeft) return;
    timeline.current?.setScrollLeft(next);
    seekRef.current(drag.x);
    animation.current = requestAnimationFrame(scrollAtEdge);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, seek: boolean) => {
    const drag = pointer.current;
    if (drag?.id !== event.pointerId) return;
    event.stopPropagation();
    if (seek && !drag.pan?.moved) seekAt(event.clientX);
    delete event.currentTarget.dataset.panning;
    pointer.current = null;
    stopScrolling();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { active: pointer, handlers: {
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !event.isPrimary || pointer.current !== null) return;
      suppressClick.current = false;
      const target = event.target as Element;
      if (!target.closest(".timeline-editor")) return;
      if (target.closest("button")) return;
      if (target.closest(".timeline-editor-action") && !target.closest(".timeline-editor-cursor, [data-testid='audio-waveform-track']")) return;
      event.preventDefault();
      event.stopPropagation();
      const pan = target.closest(".timeline-editor-time-area") && !target.closest(".timeline-editor-cursor");
      const grid = timeline.current?.target.querySelector<HTMLElement>(".timeline-editor-edit-area .ReactVirtualized__Grid");
      pointer.current = { id: event.pointerId, x: event.clientX,
        pan: pan ? { startX: event.clientX, scroll: grid?.scrollLeft ?? 0, moved: false } : undefined };
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      if (!pan) {
        seekAt(event.clientX);
        animation.current = requestAnimationFrame(scrollAtEdge);
      }
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (pointer.current?.id !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      pointer.current.x = event.clientX;
      const pan = pointer.current.pan;
      if (pan) {
        const delta = event.clientX - pan.startX;
        if (!pan.moved && Math.abs(delta) < 4) return;
        pan.moved = true;
        event.currentTarget.dataset.panning = "true";
        const editor = timeline.current?.target;
        if (!editor) return;
        const grids = Array.from(editor.querySelectorAll<HTMLElement>(".ReactVirtualized__Grid"));
        const limit = Math.max(0, Math.floor(Math.min(...grids.map(grid => grid.scrollWidth - grid.clientWidth))));
        timeline.current?.setScrollLeft(Math.max(0, Math.min(limit, pan.scroll - delta)));
        return;
      }
      seekAt(event.clientX);
      if (animation.current === null) animation.current = requestAnimationFrame(scrollAtEdge);
    },
    onPointerUpCapture: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
    onPointerCancelCapture: (event: PointerEvent<HTMLDivElement>) => finish(event, false),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (pointer.current?.id === event.pointerId) { pointer.current = null; delete event.currentTarget.dataset.panning; stopScrolling(); }
    },
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  } };
}
