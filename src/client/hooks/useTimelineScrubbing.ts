import { useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";
import type { TimelineState } from "@xzdarcy/react-timeline-editor";

// Capture empty-space/cursor gestures before the library's clip drag handlers.
export function useTimelineScrubbing(timeline: RefObject<TimelineState | null>, pixelsPerSecond: number, onSeek: (time: number) => void) {
  const pointer = useRef<{ id: number; x: number } | null>(null);
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
    if (pointer.current?.id !== event.pointerId) return;
    event.stopPropagation();
    if (seek) seekAt(event.clientX);
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
      if (target.closest(".timeline-editor-action") && !target.closest(".timeline-editor-cursor")) return;
      event.preventDefault();
      event.stopPropagation();
      pointer.current = { id: event.pointerId, x: event.clientX };
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      seekAt(event.clientX);
      animation.current = requestAnimationFrame(scrollAtEdge);
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (pointer.current?.id !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      pointer.current.x = event.clientX;
      seekAt(event.clientX);
      if (animation.current === null) animation.current = requestAnimationFrame(scrollAtEdge);
    },
    onPointerUpCapture: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
    onPointerCancelCapture: (event: PointerEvent<HTMLDivElement>) => finish(event, false),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (pointer.current?.id === event.pointerId) { pointer.current = null; stopScrolling(); }
    },
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  } };
}
