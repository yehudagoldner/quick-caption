import { Box } from '@mui/material';
import { formatTimecode } from '../utils/timecode';

// Whole-frame steps that divide a second keep marks stable while zooming.
function frameStep(fps: number, pixelsPerSecond: number, minimumPixels: number, multiple = 1) {
  const minimumFrames = minimumPixels * fps / pixelsPerSecond;
  for (let step = 1; step <= fps; step++) {
    if (fps % step === 0 && step % multiple === 0 && step >= minimumFrames) return step;
  }
  return Math.ceil(minimumFrames / fps) * fps;
}

export function WordFrameRuler({ start, end, fps, pixelsPerSecond, visibleStart = start, visibleEnd = end }: {
  start: number; end: number; fps: number; pixelsPerSecond: number; visibleStart?: number; visibleEnd?: number;
}) {
  const tickStep = frameStep(fps, pixelsPerSecond, 6);
  const labelStep = frameStep(fps, pixelsPerSecond, 28, tickStep);
  const timeStep = frameStep(fps, pixelsPerSecond, 110, labelStep);
  const first = Math.ceil((Math.max(start, visibleStart) * fps - 1e-6) / tickStep) * tickStep;
  const last = Math.min(end, visibleEnd) * fps - 1e-6;
  const ticks = Array.from({ length: Math.max(0, Math.floor((last - first) / tickStep) + 1) }, (_, i) => first + i * tickStep);
  return <Box data-testid="word-frame-ruler" aria-label={`סרגל פריימים · ${fps} FPS`} dir="ltr"
    sx={{ position: 'relative', width: Math.max(0, end - start) * pixelsPerSecond, height: 32, pointerEvents: 'none',
      color: 'inherit', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', userSelect: 'none' }}>
    {ticks.map(frame => <Box key={frame} data-testid="word-frame-tick" data-frame={frame} data-time={frame / fps}
      sx={{ position: 'absolute', left: (frame / fps - start) * pixelsPerSecond, top: 0, height: 32 }}>
      {frame % timeStep === 0 && <Box component="span" data-testid="word-frame-time" sx={{ position: 'absolute', top: 0, left: 3, fontSize: 10, lineHeight: '12px', whiteSpace: 'nowrap' }}>{formatTimecode(frame / fps, fps)}</Box>}
      {frame % labelStep === 0 && <Box component="span" data-testid="word-frame-number" sx={{ position: 'absolute', top: 13, left: 3, fontSize: 10, lineHeight: '12px', whiteSpace: 'nowrap' }}>{String(frame % fps).padStart(2, '0')}f</Box>}
      <Box sx={{ position: 'absolute', bottom: 0, width: '1px', height: frame % labelStep === 0 ? 8 : 5, bgcolor: frame % labelStep === 0 ? '#78909c' : '#b0bec5' }} />
    </Box>)}
  </Box>;
}
