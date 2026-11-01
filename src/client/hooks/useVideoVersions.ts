import { useEffect, useMemo, useRef, useState } from 'react';
import { apiUserUid } from '../api';
import { VIDEO_FORMATS, validateVideoCrop, type VideoCrop, type VideoRevision } from '../../videoVersions.js';

type Project = { enabled: boolean; dismissed: boolean; revisions: Record<string, VideoRevision>; crops: Record<string, VideoCrop> };
const empty = (): Project => ({ enabled: false, dismissed: false, revisions: {}, crops: {} });
function read(key: string): Project {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!data || !data.enabled) return { ...empty(), dismissed: Boolean(data?.dismissed) };
    for (const format of VIDEO_FORMATS.filter(f => f.ratio)) {
      validateVideoCrop(data.crops[format.id]);
      const revision = data.revisions[format.id];
      if (!Array.isArray(revision?.segments) || !Array.isArray(revision?.words)
        || revision.segments.some((s: any) => !s || typeof s.text !== 'string' || !Number.isFinite(s.start) || !Number.isFinite(s.end))) return empty();
    }
    return data;
  } catch { return empty(); }
}

// Matches existing per-project appearance/background storage. Never send a
// derivative's caption layout through the original video's save endpoint.
export function useVideoVersions(videoId: number | null, mediaUrl: string | null) {
  const key = `${import.meta.env.BASE_URL}video-versions:${apiUserUid()}:${videoId ?? mediaUrl}`;
  const loaded = useMemo(() => read(key), [key]);
  const [state, setState] = useState({ key, project: loaded });
  const [activeId, setActiveId] = useState('original');
  const project = state.key === key ? state.project : loaded;
  const latest = useRef(project); latest.current = project;
  useEffect(() => { setState({ key, project: loaded }); setActiveId('original'); }, [key, loaded]);
  const commit = (next: Project) => {
    // Surface quota/security errors to callers instead of claiming a saved edit.
    localStorage.setItem(key, JSON.stringify(next));
    latest.current = next; setState({ key, project: next });
  };
  return {
    ...project, activeId, setActiveId,
    getRevisions: () => latest.current.revisions,
    create: (revision: VideoRevision) => {
      const revisions: Record<string, VideoRevision> = { original: structuredClone(revision) }, crops: Record<string, VideoCrop> = {};
      for (const format of VIDEO_FORMATS.filter(f => f.ratio)) {
        revisions[format.id] = structuredClone(revision);
        crops[format.id] = { format: format.id, x: .5, y: .5 };
      }
      commit({ enabled: true, dismissed: true, revisions, crops });
    },
    dismiss: () => {
      const next = { ...latest.current, dismissed: true };
      try { commit(next); }
      catch { latest.current = next; setState({ key, project: next }); }
    },
    save: (id: string, revision: VideoRevision) => commit({ ...latest.current, revisions: { ...latest.current.revisions, [id]: revision } }),
    saveAll: (revisions: Record<string, VideoRevision>) => commit({ ...latest.current, revisions }),
    updateCrop: (crop: VideoCrop) => commit({ ...latest.current, crops: { ...latest.current.crops, [crop.format]: validateVideoCrop(crop) } }),
  };
}
