import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { TimelineState } from "@xzdarcy/react-timeline-editor";

// Keep the time under the pointer fixed while changing the track's scale.
export function useTimelineWheelZoom(container: RefObject<HTMLDivElement | null>, timeline: RefObject<TimelineState | null>,
  pixelsPerSecond: number, minimum: number, maximum: number, onZoom: (scale: number) => void, enabled = true) {
  const options = useRef({ pixelsPerSecond, minimum, maximum, onZoom });
  options.current = { pixelsPerSecond, minimum, maximum, onZoom };
  const pending = useRef<{ time: number; offset: number; scale: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = pending.current;
    const editor = timeline.current?.target;
    if (!anchor || !editor) return;
    pending.current = null;
    const grids = Array.from(editor.querySelectorAll<HTMLElement>(".ReactVirtualized__Grid"));
    const limit = Math.max(0, Math.min(...grids.map(grid => grid.scrollWidth - grid.clientWidth)));
    timeline.current?.setScrollLeft(Math.max(0, Math.min(limit, anchor.time * pixelsPerSecond - anchor.offset)));
  }, [pixelsPerSecond, timeline]);

  useEffect(() => {
    const element = container.current;
    if (!enabled || !element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      const editor = timeline.current?.target;
      if (!editor) return;
      // React's wheel listeners are passive; a native listener prevents page zoom.
      event.preventDefault();
      event.stopPropagation();
      const current = options.current;
      const scale = pending.current?.scale ?? current.pixelsPerSecond;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const next = Math.max(current.minimum, Math.min(current.maximum, scale * Math.exp(-Math.max(-240, Math.min(240, pixels)) * .0025)));
      if (Math.abs(next - scale) < .000001) return;
      const offset = event.clientX - editor.getBoundingClientRect().left - 20;
      const grid = editor.querySelector<HTMLElement>(".timeline-editor-edit-area .ReactVirtualized__Grid");
      const previous = pending.current;
      const time = previous ? previous.time + (offset - previous.offset) / scale : ((grid?.scrollLeft ?? 0) + offset) / scale;
      pending.current = { time, offset, scale: next };
      current.onZoom(next);
    };
    element.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => { element.removeEventListener("wheel", wheel, true); pending.current = null; };
  }, [container, timeline, enabled]);
}
