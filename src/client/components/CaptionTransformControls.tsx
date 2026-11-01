import { Box } from '@mui/material';
import { RotateRightRounded } from '@mui/icons-material';
import type { CaptionTransformValues } from '../../captionTransform.js';
import type { CaptionGestureMode } from '../hooks/useCaptionTransform';

const FRAME_INSET = { x: 10, y: 6 };
const ink = '0 0 0 1px rgba(15, 23, 42, .45), 0 1px 4px rgba(0, 0, 0, .35)';
const corners = [
  { top: 0, left: 0, cursor: 'nwse-resize' }, { top: 0, left: '100%', cursor: 'nesw-resize' },
  { top: '100%', left: 0, cursor: 'nesw-resize' }, { top: '100%', left: '100%', cursor: 'nwse-resize' },
] as const;

// Rendered inside the caption element so it rotates and scales with it, like
// the selection box in Canva or CapCut.
export function CaptionSelectionFrame({ mode }: { mode: CaptionGestureMode | null }) {
  return <Box aria-hidden data-testid="caption-selection-frame" sx={{ position: 'absolute', inset: `-${FRAME_INSET.y}px -${FRAME_INSET.x}px`, pointerEvents: 'none', zIndex: 1,
    border: '1.5px solid #fff', borderRadius: '4px', boxShadow: '0 0 0 1px rgba(15, 23, 42, .35)', lineHeight: 0, textShadow: 'none' }}>
    {corners.map(({ cursor, ...position }, index) => <Box key={index} data-caption-handle="scale" title="גררו לשינוי הגודל"
      sx={{ position: 'absolute', ...position, width: 14, height: 14, transform: 'translate(-50%, -50%)', borderRadius: '50%', bgcolor: '#fff',
        boxShadow: ink, pointerEvents: 'auto', cursor, touchAction: 'none', opacity: mode && mode !== 'scale' ? 0 : 1,
        '&::before': { content: '""', position: 'absolute', inset: -13 } }} />)}
    <Box sx={{ position: 'absolute', left: '50%', bottom: '100%', width: 1.5, height: 14, transform: 'translateX(-50%)', bgcolor: '#fff', opacity: mode && mode !== 'rotate' ? 0 : 1 }} />
    <Box data-caption-handle="rotate" title="גררו לסיבוב · Shift להצמדה ל־15°"
      sx={{ position: 'absolute', left: '50%', bottom: 'calc(100% + 14px)', width: 30, height: 30, transform: 'translateX(-50%)', borderRadius: '50%',
        bgcolor: '#fff', color: '#0f172a', boxShadow: ink, display: 'grid', placeItems: 'center', pointerEvents: 'auto', touchAction: 'none',
        cursor: mode === 'rotate' ? 'grabbing' : 'grab', opacity: mode && mode !== 'rotate' ? 0 : 1, '&::before': { content: '""', position: 'absolute', inset: -8 } }}>
      <RotateRightRounded sx={{ fontSize: 19 }} />
    </Box>
  </Box>;
}

export function CaptionTransformGuides({ mode, values }: { mode: CaptionGestureMode | null; values: CaptionTransformValues }) {
  if (!mode) return null;
  const line = { position: 'absolute', pointerEvents: 'none', zIndex: 2, borderColor: '#f472b6', borderStyle: 'dashed', borderWidth: 0 } as const;
  const angle = mode === 'rotate' || mode === 'pinch';
  return <>
    {mode !== 'scale' && mode !== 'rotate' && values.positionXPercent === 50 && <Box data-testid="caption-guide-vertical" sx={{ ...line, top: 0, bottom: 0, left: '50%', borderLeftWidth: 1.5 }} />}
    {mode !== 'scale' && mode !== 'rotate' && values.offsetYPercent === 50 && <Box data-testid="caption-guide-horizontal" sx={{ ...line, left: 0, right: 0, bottom: '50%', borderTopWidth: 1.5 }} />}
    <Box role="status" aria-live="off" dir="ltr" sx={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 3, pointerEvents: 'none',
      bgcolor: 'rgba(15, 23, 42, .85)', color: '#fff', borderRadius: 99, px: 1.25, py: .25, fontSize: 12, fontWeight: 600 }}>
      {angle ? `${Math.round(values.rotation)}°` : mode === 'scale' ? `${values.fontSize}px` : `${Math.round(values.positionXPercent)}% · ${Math.round(values.offsetYPercent)}%`}
    </Box>
  </>;
}
