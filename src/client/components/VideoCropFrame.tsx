import { useContext, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { VideoVersionContext } from '../contexts/VideoVersionContext';
import { cropPosition, cropRectangle } from '../../videoVersions.js';

export function VideoCropFrame({ dimensions, time }: { dimensions: { width: number; height: number }; time: number }) {
  const version = useContext(VideoVersionContext);
  const drag = useRef<{ clientX: number; clientY: number; x: number; y: number; width: number; height: number } | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const crop = version?.crop;
  if (!crop) return null;
  const current = draft ? { ...crop, ...draft, points: [] } : crop;
  const rect = cropRectangle(dimensions, current, time);
  const move = (x: number, y: number) => {
    const next = { ...crop, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), points: [] };
    version.updateCrop(next);
  };
  return <Box role="slider" aria-label="מיקום מסגרת החיתוך" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(cropPosition(current, time).x * 100)}
    aria-valuetext="גררו להזזה, או השתמשו במקשי החצים" tabIndex={version.disabled ? -1 : 0} data-testid="video-crop-frame"
    onPointerDown={event => {
      event.stopPropagation(); if (version.disabled) return;
      event.preventDefault(); const stage = event.currentTarget.parentElement!.getBoundingClientRect();
      drag.current = { clientX: event.clientX, clientY: event.clientY, ...cropPosition(crop, time), width: stage.width, height: stage.height };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      if (!drag.current) return; event.stopPropagation(); const start = drag.current;
      const width = start.width * (1 - rect.width / dimensions.width), height = start.height * (1 - rect.height / dimensions.height);
      setDraft({ x: Math.max(0, Math.min(1, start.x + (width ? (event.clientX - start.clientX) / width : 0))), y: Math.max(0, Math.min(1, start.y + (height ? (event.clientY - start.clientY) / height : 0))) });
    }}
    onPointerUp={event => { event.stopPropagation(); if (!drag.current) return; drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); if (draft) { try { move(draft.x, draft.y); } catch { /* Parent project save remains unchanged. */ } } setDraft(null); }}
    onPointerCancel={() => { drag.current = null; setDraft(null); }}
    onKeyDown={event => {
      if (version.disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); const position = cropPosition(crop, time), step = event.shiftKey ? .1 : .01;
      move(position.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), position.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
    }}
    sx={{ position: 'absolute', zIndex: 1, left: `${rect.x / dimensions.width * 100}%`, top: `${rect.y / dimensions.height * 100}%`, width: `${rect.width / dimensions.width * 100}%`, height: `${rect.height / dimensions.height * 100}%`,
      border: '2px solid #fff', boxShadow: '0 0 0 2000px rgba(0,0,0,.65)', cursor: version.disabled ? 'default' : drag.current ? 'grabbing' : 'grab', touchAction: 'none', outlineOffset: -5,
      '&:focus-visible': { outline: '3px solid #38bdf8' } }} />;
}
