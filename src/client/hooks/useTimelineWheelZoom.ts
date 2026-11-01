import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { TimelineState } from "@xzdarcy/react-timeline-editor";

// Center the playhead after any scale change, including sliders and shortcuts.
export function useTimelineWheelZoom(container: RefObject<HTMLDivElement | null>, timeline: RefObject<TimelineState | null>,
  pixelsPerSecond: number, minimum: number, maximum: number, onZoom: (scale: number) => void, playheadTime: number, enabled = true) {
  const options = useRef({ pixelsPerSecond, minimum, maximum, onZoom, playheadTime });
  options.current = { pixelsPerSecond, minimum, maximum, onZoom, playheadTime };
  const pending = useRef<number | null>(null);
  const previousScale = useRef(pixelsPerSecond);

  useLayoutEffect(() => {
    const changed = previousScale.current !== pixelsPerSecond;
    previousScale.current = pixelsPerSecond;
    pending.current = null;
    const editor = timeline.current?.target;
    if (!changed || !enabled || !editor) return;
    const center = () => {
      const grids = Array.from(editor.querySelectorAll<HTMLElement>(".ReactVirtualized__Grid"));
      const grid = editor.querySelector<HTMLElement>(".timeline-editor-edit-area .ReactVirtualized__Grid");
      if (!grid || !grids.length) return;
      const limit = Math.max(0, Math.min(...grids.map(grid => grid.scrollWidth - grid.clientWidth)));
      const centered = 20 + options.current.playheadTime * pixelsPerSecond - grid.clientWidth / 2;
      timeline.current?.setScrollLeft(Math.max(0, Math.min(limit, centered)));
    };
    center();
    // The ruler recomputes its virtualized column widths in a passive effect.
    // Recheck the common scroll range after that update, especially for large zoom jumps.
    const frame = requestAnimationFrame(center);
    return () => cancelAnimationFrame(frame);
  }, [pixelsPerSecond, timeline, enabled]);

  useEffect(() => {
    const element = container.current;
    if (!enabled || !element) return;
    const wheel = (event: WheelEvent) => {
      const editor = timeline.current?.target;
      if (!editor) return;
      if (!event.ctrlKey) {
        if (!(event.target instanceof Element) || !event.target.closest(".timeline-editor-time-area")) return;
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!delta) return;
        const grid = editor.querySelector<HTMLElement>(".timeline-editor-edit-area .ReactVirtualized__Grid");
        if (!grid) return;
        // Pan both rows through the timeline API so captions, audio and ruler stay aligned.
        const grids = Array.from(editor.querySelectorAll<HTMLElement>(".ReactVirtualized__Grid"));
        const limit = Math.max(0, Math.floor(Math.min(...grids.map(item => item.scrollWidth - item.clientWidth))));
        const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? grid.clientWidth : 1);
        event.preventDefault();
        event.stopPropagation();
        timeline.current?.setScrollLeft(Math.max(0, Math.min(limit, grid.scrollLeft + pixels)));
        return;
      }
      if (event.deltaY === 0) return;
      // React's wheel listeners are passive; a native listener prevents page zoom.
      event.preventDefault();
      event.stopPropagation();
      const current = options.current;
      const scale = pending.current ?? current.pixelsPerSecond;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const next = Math.max(current.minimum, Math.min(current.maximum, scale * Math.exp(-Math.max(-240, Math.min(240, pixels)) * .0025)));
      if (Math.abs(next - scale) < .000001) return;
      pending.current = next;
      current.onZoom(next);
    };
    element.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => { element.removeEventListener("wheel", wheel, true); pending.current = null; };
  }, [container, timeline, enabled]);
}
