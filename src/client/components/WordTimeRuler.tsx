import { Box } from '@mui/material';

export function WordTimeRuler({ start, end, pixelsPerSecond, visibleStart = start, visibleEnd = end }: {
  start: number; end: number; pixelsPerSecond: number; visibleStart?: number; visibleEnd?: number;
}) {
  // Integer tenths keep the 100 ms grid aligned to the video at every zoom level.
  const first = Math.ceil(Math.max(start, visibleStart) * 10 - 1e-6);
  const last = Math.ceil(Math.min(end, visibleEnd) * 10 - 1e-6) - 1;
  const ticks = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
  const minutes = Math.floor(end / 60);
  const labelWidth = Math.max(2, String(minutes).length) * 6 + 32;
  const minimumStep = labelWidth / (pixelsPerSecond / 10);
  const labelStep = [1, 2, 5, 10, 20, 50, 100].find(step => step >= minimumStep) ?? Math.ceil(minimumStep / 100) * 100;
  return <Box data-testid="word-time-ruler" aria-label="סרגל זמן · 100 מילישניות" dir="ltr"
    sx={{ position: 'relative', width: Math.max(0, end - start) * pixelsPerSecond, height: 20, pointerEvents: 'none',
      color: 'inherit', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', userSelect: 'none' }}>
    {ticks.map(tenth => <Box key={tenth} data-testid="word-time-tick" data-time={tenth / 10}
      sx={{ position: 'absolute', left: (tenth / 10 - start) * pixelsPerSecond, top: 0, height: 20 }}>
      {tenth % labelStep === 0 && <Box component="span" data-testid="word-time-label"
        sx={{ position: 'absolute', top: 0, left: 3, fontSize: 10, lineHeight: '12px', whiteSpace: 'nowrap' }}>
        {String(Math.floor(tenth / 600)).padStart(2, '0')}:{String(Math.floor(tenth / 10) % 60).padStart(2, '0')}.{tenth % 10}
      </Box>}
      <Box sx={{ position: 'absolute', bottom: 0, width: '1px', height: tenth % 10 === 0 ? 6 : 3, bgcolor: '#90a4ae' }} />
    </Box>)}
  </Box>;
}
