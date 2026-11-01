import { useEffect, useMemo, useState } from "react";
import { apiUserUid } from "../api";
import { AUDIOGRAM_IMAGE_TYPES, audiogramDimensions, sanitizeAudiogram, type AudiogramSettings } from "../../audiogram.js";
import { deleteAudiogramImage, loadAudiogramImage, prepareAudiogramImage, saveAudiogramImage } from "../utils/audiogramImages";

function read(key: string | null): AudiogramSettings {
  try { return sanitizeAudiogram(JSON.parse(key ? localStorage.getItem(key) ?? "{}" : "{}")); }
  catch { return sanitizeAudiogram(null); }
}

// Like the project caption style, settings stay on this device; the image
// is kept in IndexedDB because it is too large for localStorage.
export function useProjectAudiogram(videoId: number | null) {
  const key = videoId ? `${import.meta.env.BASE_URL === "/" ? "" : import.meta.env.BASE_URL}audiogram:${apiUserUid()}:${videoId}` : null;
  const [state, setState] = useState(() => ({ key, settings: read(key) }));
  const settings = state.key === key ? state.settings : read(key);
  const [image, setImageState] = useState<{ key: string | null; blob: Blob | null; version: number }>({ key, blob: null, version: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (state.key !== key) setState({ key, settings: read(key) }); }, [key, state.key]);
  useEffect(() => {
    if (!key || state.key !== key) return;
    try { localStorage.setItem(key, JSON.stringify(state.settings)); } catch { /* Private browsing can disable storage. */ }
  }, [key, state]);
  useEffect(() => {
    let current = true;
    setImageState({ key, blob: null, version: 0 }); setError(null);
    if (key) loadAudiogramImage(key).then(blob => { if (current && blob) setImageState({ key, blob, version: 1 }); }).catch(() => {});
    return () => { current = false; };
  }, [key]);

  const dimensions = useMemo(() => audiogramDimensions(settings.format), [settings.format]);
  const blob = image.key === key ? image.blob : null;
  const imageUrl = useMemo(() => blob ? URL.createObjectURL(blob) : null, [blob]);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  return {
    settings,
    dimensions,
    image: blob,
    imageUrl,
    imageVersion: image.key === key ? image.version : 0,
    error,
    update: (patch: Partial<AudiogramSettings>) => setState(previous => ({ key, settings: sanitizeAudiogram({ ...(previous.key === key ? previous.settings : read(key)), ...patch }) })),
    setImage: async (file: File | null) => {
      setError(null);
      if (!file) {
        setImageState(previous => ({ key, blob: null, version: previous.version + 1 }));
        if (key) await deleteAudiogramImage(key).catch(() => {});
        return;
      }
      if (!AUDIOGRAM_IMAGE_TYPES.includes(file.type)) { setError("אפשר להעלות תמונת JPG, PNG או WebP."); return; }
      try {
        const prepared = await prepareAudiogramImage(file);
        setImageState(previous => ({ key, blob: prepared, version: previous.version + 1 }));
        // The preview and export still work for this session if storage is full.
        if (key) await saveAudiogramImage(key, prepared).catch(() => {});
      } catch { setError("לא הצלחנו לקרוא את התמונה. נסו קובץ אחר."); }
    },
  };
}

export type ProjectAudiogram = ReturnType<typeof useProjectAudiogram>;
