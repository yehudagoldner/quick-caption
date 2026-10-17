import type { VideoRevision } from './videoVersions.js';
export function linkVideoRevisions(revisions: Record<string, VideoRevision>, sourceRevision?: VideoRevision): Record<string, VideoRevision>;
export function editVideoTranscript(revisions: Record<string, VideoRevision>, activeId: string, next: VideoRevision, options?: { layoutOnly?: boolean }): Record<string, VideoRevision>;
