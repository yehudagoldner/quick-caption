import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import type { Segment } from "../../types";
import { AUTO_CAPTION_FONT_SIZE, type CaptionFontSizeSetting } from "../../../captionStyle.js";
import { useAutoCaptionFontSize } from "../../hooks/useAutoCaptionFontSize";

export const DEMO_IMAGE = `${import.meta.env.BASE_URL}demo/creator.webp`;
export const DEMO_VIDEO = { width: 1024, height: 1536 };
export const DEMO_DURATION = 10;

const SCRIPT = ["העליתי את הסרטון", "והכתוביות כבר כאן", "מתקנים מילה בקליק", "בוחרים צבע וסגנון", "ומורידים סרטון מוכן"];
export const DEMO_SEGMENTS: Segment[] = SCRIPT.map((text, index) => ({ id: index + 1, start: index * 2, end: index * 2 + 2, text }));

export type CaptionLook = {
  fontSize: CaptionFontSizeSetting;
  fontColor: string;
  outlineColor: string;
  offsetYPercent: number;
  marginPercent: number;
  activeWord: boolean;
};

// Same defaults as useProjectCaptionStyle, so the demo opens like a fresh project.
export const DEFAULT_LOOK: CaptionLook = { fontSize: AUTO_CAPTION_FONT_SIZE, fontColor: "#ffffff", outlineColor: "#000000", offsetYPercent: 20, marginPercent: 5, activeWord: true };

export const LOOK_PRESETS: { id: string; name: string; note: string; look: CaptionLook }[] = [
  { id: "classic", name: "קלאסי", note: "לבן עם מסגרת שחורה. קריא על כל רקע.", look: { ...DEFAULT_LOOK, activeWord: false } },
  { id: "active", name: "מילה אקטיבית", note: "כל מילה נדלקת בדיוק כשהיא נאמרת.", look: { ...DEFAULT_LOOK } },
  { id: "yellow", name: "צהוב בולט", note: "גבוה יותר בפריים ובולט בפיד.", look: { ...DEFAULT_LOOK, fontColor: "#ffe14d", outlineColor: "#111111", offsetYPercent: 32, activeWord: false } },
  { id: "brand", name: "בצבעי המותג", note: "מסגרת בצבע שלכם, עם מילה אקטיבית.", look: { ...DEFAULT_LOOK, outlineColor: "#6d28d9", marginPercent: 8 } },
];

export function sameLook(a: CaptionLook, b: CaptionLook) {
  return a.fontSize === b.fontSize && a.fontColor.toLowerCase() === b.fontColor.toLowerCase() && a.outlineColor.toLowerCase() === b.outlineColor.toLowerCase()
    && a.offsetYPercent === b.offsetYPercent && a.marginPercent === b.marginPercent && a.activeWord === b.activeWord;
}

/** Words are spread evenly across the caption, like an estimated alignment. */
export function activeWordIndex(segment: Segment, time: number) {
  const count = segment.text.trim().split(/\s+/).filter(Boolean).length;
  if (!count || time < segment.start || time >= segment.end) return -1;
  return Math.min(count - 1, Math.floor((time - segment.start) / ((segment.end - segment.start) / count)));
}

export function useCaptionDemo({ autoplay, visible }: { autoplay: boolean; visible: boolean }) {
  const [segments, setSegments] = useState<Segment[]>(DEMO_SEGMENTS);
  const [look, setLook] = useState<CaptionLook>(DEFAULT_LOOK);
  const [showCaptions, setShowCaptions] = useState(true);
  const [playing, setPlaying] = useState(autoplay);
  const [time, setTime] = useState(0.6);
  const duration = DEMO_DURATION;

  useEffect(() => {
    if (!playing || !visible) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(0.1, (now - last) / 1000);
      last = now;
      setTime(value => (value + delta) % duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, visible, duration]);

  const autoFontSize = useAutoCaptionFontSize({ segments, videoDimensions: DEMO_VIDEO, marginPercent: look.marginPercent, offsetYPercent: look.offsetYPercent });
  const updateLook = useCallback((patch: Partial<CaptionLook>) => setLook(previous => ({ ...previous, ...patch })), []);
  const seek = useCallback((value: number) => setTime(Math.max(0, Math.min(duration - 0.001, value))), [duration]);
  const editText = useCallback((id: Segment["id"], text: string) => setSegments(list => list.map(segment => segment.id === id ? { ...segment, text } : segment)), []);
  const remove = useCallback(async (id: Segment["id"]) => setSegments(list => list.length > 1 ? list.filter(segment => segment.id !== id) : list), []);

  return useMemo(() => ({ segments, look, setLook, updateLook, showCaptions, setShowCaptions, playing, setPlaying, time, seek, duration, autoFontSize, editText, remove }),
    [segments, look, updateLook, showCaptions, playing, time, seek, duration, autoFontSize, editText, remove]);
}

export type CaptionDemo = ReturnType<typeof useCaptionDemo>;

/** Layout size, unaffected by the CSS scale applied to the mockups. */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setSize({ width: element.offsetWidth, height: element.offsetHeight });
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(previous => previous && previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function useInView(ref: RefObject<Element | null>, threshold = 0.05, initial = false) {
  const [inView, setInView] = useState(initial);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => setInView(entries[entries.length - 1].isIntersecting), { threshold });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold]);
  return inView;
}
