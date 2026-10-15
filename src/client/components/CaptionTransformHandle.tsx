import { useLayoutEffect, useState, type RefObject } from 'react';
import { Box, IconButton } from '@mui/material';
import { RotateRightRounded } from '@mui/icons-material';
import { captionAnchor, normalizeCaptionAngle, type CaptionTransformValues } from '../../captionTransform.js';

export function CaptionTransformHandle({ stage, caption, values, active, disabled, onRotate }: {
  stage: RefObject<HTMLDivElement>; caption: RefObject<HTMLDivElement>; values: CaptionTransformValues;
  active: boolean; disabled: boolean; onRotate: (rotation: number) => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0, captionHeight: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      if (!stage.current || !caption.current) return;
      const next = { width: stage.current.clientWidth, height: stage.current.clientHeight, captionHeight: caption.current.offsetHeight };
      setSize(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (stage.current) observer.observe(stage.current);
    if (caption.current) observer.observe(caption.current);
    return () => observer.disconnect();
  }, [stage, caption]);
  if (!size.width || !size.height) return null;
  const anchor = captionAnchor(values, { ...size, left: 0, top: 0 });
  const angle = values.rotation * Math.PI / 180;
  const top = { x: anchor.x + Math.sin(angle) * size.captionHeight, y: anchor.y - Math.cos(angle) * size.captionHeight };
  const handle = { x: Math.max(24, Math.min(size.width - 24, top.x + Math.sin(angle) * 32)),
    y: Math.max(24, Math.min(size.height - 24, top.y - Math.cos(angle) * 32)) };
  return <>
    <Box component="svg" aria-hidden sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <line x1={top.x} y1={top.y} x2={handle.x} y2={handle.y} stroke="#38bdf8" strokeWidth="2" />
      {active && values.positionXPercent === 50 && <line x1={size.width / 2} x2={size.width / 2} y1={0} y2={size.height} stroke="#38bdf8" strokeDasharray="4 4" />}
      {active && values.offsetYPercent === 50 && <line x1={0} x2={size.width} y1={size.height / 2} y2={size.height / 2} stroke="#38bdf8" strokeDasharray="4 4" />}
    </Box>
    <IconButton data-caption-rotate aria-label="ידית סיבוב הכתובית" title="גררו לסיבוב · Shift להצמדה ל־15°" disabled={disabled}
      onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          onRotate(event.key === 'Home' ? 0 : normalizeCaptionAngle(values.rotation + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 15 : 1)));
        }
      }}
      sx={{ position: 'absolute', left: handle.x - 22, top: handle.y - 22, width: 44, height: 44, zIndex: 2,
        bgcolor: '#0284c7', color: 'white', border: '2px solid white', boxShadow: '0 2px 8px #0006', touchAction: 'none',
        cursor: active ? 'grabbing' : 'grab', '&:hover': { bgcolor: '#0369a1' } }}><RotateRightRounded /></IconButton>
    {active && <Box role="status" aria-live="off" sx={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)',
      bgcolor: '#0f172ae6', color: 'white', borderRadius: 1, px: 1, py: .25, fontSize: 12, pointerEvents: 'none', zIndex: 3 }} dir="ltr">{Math.round(values.rotation)}°</Box>}
  </>;
}
