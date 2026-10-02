import { useEffect, useState } from "react";
import { DEFAULT_CAPTION_FONT_ID, getCaptionFont } from "../../captionFonts.js";

const SAMPLE = "שלום עולם ABC 123?!";

export function useCaptionFont(fontId = DEFAULT_CAPTION_FONT_ID) {
  const font = getCaptionFont(fontId);
  const [loaded, setLoaded] = useState({ id: "", ready: false, error: false });
  const face = `${font.weight} 100px "${font.cssFamily}"`;
  useEffect(() => {
    let live = true;
    const done = (error: boolean) => { if (live) setLoaded({ id: font.id, ready: !error, error }); };
    if (!document.fonts) done(false);
    else document.fonts.load(face, SAMPLE).then(faces => done(faces.length === 0), () => done(true));
    return () => { live = false; };
  }, [font.id, face]);
  return { font, ready: loaded.id === font.id && loaded.ready, error: loaded.id === font.id && loaded.error };
}
