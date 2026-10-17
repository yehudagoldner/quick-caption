import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, LinearProgress, Stack, Switch, Tab, Tabs, Typography } from '@mui/material';
import { VIDEO_FORMATS, type VideoCrop } from '../../videoVersions.js';
import { autoReframe } from '../utils/autoReframe';

export function VideoVersionsBar({ eligible, enabled, dismissed, activeId, crop, mediaUrl, disabled, create, dismiss, select, updateCrop, onBusy }: {
  eligible: boolean; enabled: boolean; dismissed: boolean; activeId: string; crop: VideoCrop | null; mediaUrl: string | null; disabled: boolean;
  create: () => void; dismiss: () => void; select: (id: string) => Promise<void>; updateCrop: (crop: VideoCrop) => void; onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const job = useRef<AbortController | null>(null);
  useEffect(() => () => { job.current?.abort(); onBusy(false); }, [mediaUrl, onBusy]);
  const perform = async (action: () => void | Promise<void>) => { try { setError(null); await action(); } catch { setError('לא הצלחנו לשמור את הגרסאות במכשיר. בדקו שיש מקום פנוי ונסו שוב.'); } };
  const automatic = async (checked: boolean) => {
    if (!crop || !mediaUrl) return;
    if (!checked) { void perform(() => updateCrop({ ...crop, points: [] })); return; }
    const controller = new AbortController(); job.current?.abort(); job.current = controller;
    setError(null); setProgress(0); onBusy(true);
    try {
      const next = await autoReframe(mediaUrl, crop, controller.signal, setProgress);
      if (!controller.signal.aborted) updateCrop(next);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'ההתאמה נכשלה. נסו שוב.'); }
    finally { if (job.current === controller) { job.current = null; setProgress(null); onBusy(false); } }
  };
  return <>
    <Dialog open={eligible && !enabled && !dismissed} onClose={() => void perform(dismiss)} maxWidth="sm" fullWidth aria-labelledby="video-versions-title">
      <DialogTitle id="video-versions-title">רוצה ליצור גרסאות נוספות?</DialogTitle>
      <DialogContent><Typography>העלית סרטון רחב שמתאים למשל ל־YouTube. אפשר לחתוך ממנו גם גרסאות לפורמטים של TikTok, Reels, Shorts, Stories והפיד של Instagram ו־Facebook.</Typography>
        <Typography sx={{ mt: 1 }}>ליצור עבורך גרסאות נוספות?</Typography>
        <Typography variant="caption" color="text.secondary">הגרסאות הנוספות והעריכות שלהן נשמרות בדפדפן במכשיר הזה.</Typography>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions><Button onClick={() => void perform(dismiss)}>המשך עם המקור</Button><Button variant="contained" disabled={disabled} onClick={() => void perform(create)}>כן, צור גרסאות</Button></DialogActions>
    </Dialog>
    {eligible && !enabled && dismissed && <Button size="small" disabled={disabled} onClick={() => void perform(create)}>יצירת גרסאות לרשתות</Button>}
    {enabled && <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 1 }}>
      <Stack direction="row" alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Tabs value={activeId} onChange={(_, id) => void perform(() => select(id))} variant="scrollable" scrollButtons="auto" aria-label="גרסאות הסרטון" sx={{ flex: 1, minWidth: 0 }}>
          {VIDEO_FORMATS.map(format => <Tab key={format.id} value={format.id} disabled={disabled || progress !== null} label={<Box><Typography variant="body2">{format.label}</Typography><Typography variant="caption">{format.platforms}</Typography></Box>} />)}
        </Tabs>
        {crop && <FormControlLabel sx={{ mx: 1 }} control={<Switch size="small" checked={Boolean(crop.points?.length) || progress !== null} disabled={disabled || progress !== null} onChange={(_, checked) => void automatic(checked)} />} label="התאמה אוטומטית" />}
      </Stack>
      {crop && <Typography variant="caption" color="text.secondary">גררו את המסגרת לבחירת האזור שיישאר. התאמה אוטומטית עוקבת אחר הפנים הבולטות בתמונה.</Typography>}
      {progress !== null && <Stack spacing={.5}><LinearProgress variant="determinate" value={progress} /><Stack direction="row" justifyContent="space-between"><Typography variant="caption" role="status">מתאים את המסגרת… {progress}%</Typography><Button size="small" onClick={() => job.current?.abort()}>ביטול</Button></Stack></Stack>}
    </Box>}
    {error && (enabled || dismissed) && <Alert severity="warning" onClose={() => setError(null)}>{error}</Alert>}
  </>;
}
