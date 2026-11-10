import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, LinearProgress, Stack, Switch, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { CloseRounded, InfoOutlined } from '@mui/icons-material';
import { VIDEO_FORMATS, type VideoCrop } from '../../videoVersions.js';
import { autoReframe } from '../utils/autoReframe';
import { VideoVersionShare } from './VideoVersionShare';

export function VideoVersionsBar({ eligible, enabled, dismissed, activeId, crop, mediaUrl, disabled, shareAllowed, onBurnVideo, create, dismiss, select, updateCrop, onBusy }: {
  eligible: boolean; enabled: boolean; dismissed: boolean; activeId: string; crop: VideoCrop | null; mediaUrl: string | null; disabled: boolean;
  create: () => void; dismiss: () => void; select: (id: string) => Promise<void>; updateCrop: (crop: VideoCrop) => void; onBusy: (busy: boolean) => void;
  shareAllowed: boolean; onBurnVideo: (options: { download: boolean; reuse: boolean }) => Promise<{ url: string; name: string } | null | void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  const panelId = useId();
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
    <Dialog open={eligible && !enabled && !dismissed} onClose={() => void perform(dismiss)} maxWidth="sm" fullWidth dir="rtl" slotProps={{ paper: { sx: { textAlign: 'right' } } }} aria-labelledby="video-versions-title">
      <DialogTitle id="video-versions-title">רוצה ליצור גרסאות נוספות?</DialogTitle>
      <DialogContent><Typography>העלית סרטון רחב שמתאים למשל ל־<bdi dir="ltr">YouTube</bdi>. אפשר לחתוך ממנו גם גרסאות לפורמטים של <bdi dir="ltr">TikTok, Reels, Shorts, Stories</bdi> והפיד של <bdi dir="ltr">Instagram</bdi> ו־<bdi dir="ltr">Facebook</bdi>.</Typography>
        <Typography sx={{ mt: 1 }}>ליצור עבורך גרסאות נוספות?</Typography>
        <Typography variant="caption" color="text.secondary">המילים והתזמון שלהן משותפים לכל הגרסאות. החלוקה לכתוביות והחיתוך של הגרסאות הנוספות נשמרים בדפדפן במכשיר הזה.</Typography>
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions disableSpacing sx={{ gap: 1 }}><Button onClick={() => void perform(dismiss)}>המשך עם המקור</Button><Button variant="contained" disabled={disabled} onClick={() => void perform(create)}>כן, צור גרסאות</Button></DialogActions>
    </Dialog>
    {eligible && !enabled && dismissed && <Button size="small" disabled={disabled} onClick={() => void perform(create)}>יצירת גרסאות לרשתות</Button>}
    {enabled && <Box data-testid="video-versions-bar" sx={{ width: 'fit-content', maxWidth: '100%', border: expanded ? '1px solid' : 0, borderColor: 'divider', borderRadius: 1.5, px: expanded ? .5 : 0, alignSelf: 'flex-start' }}>
      {!expanded && <Button size="small" aria-expanded={false} aria-controls={panelId} onClick={() => setExpanded(true)}>הצג גרסאות סרטון</Button>}
      <Box id={panelId} hidden={!expanded}>
      <Stack direction="row" alignItems="center" sx={{ minHeight: 34, gap: .25, '& .MuiIconButton-root': { width: 28, height: 28 }, '& .MuiIconButton-root .MuiSvgIcon-root': { fontSize: 17 } }}>
        <Tabs value={activeId} onChange={(_, id) => void perform(() => select(id))} variant="scrollable" scrollButtons="auto" aria-label="גרסאות הסרטון"
          sx={{ minWidth: 0, minHeight: 34, '& .MuiTab-root': { minWidth: 44, minHeight: 34, px: 1, py: .5, fontSize: 12, textTransform: 'none' }, '& .MuiTabs-indicator': { height: 2 } }}>
          {VIDEO_FORMATS.map(format => <Tab key={format.id} value={format.id} title={format.platforms} disabled={disabled || progress !== null}
            label={<Box component="span" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
              <Box component="span" sx={{ fontSize: 12, lineHeight: '14px' }}>{format.label}</Box>
              <Box component="span" dir="ltr" sx={{ fontSize: 10, lineHeight: '12px', fontWeight: 400, color: 'text.secondary', whiteSpace: 'nowrap' }}>{format.platforms}</Box>
            </Box>} />)}
        </Tabs>
        <VideoVersionShare key={activeId} activeId={activeId} disabled={disabled || !shareAllowed || progress !== null} onBurnVideo={onBurnVideo} />
        {crop && <Tooltip title="גררו את המסגרת לבחירת האזור שיישאר. התאמה אוטומטית עוקבת אחר הפנים הבולטות בתמונה.">
          <FormControlLabel sx={{ mx: .25, flexShrink: 0, '& .MuiTypography-root': { fontSize: 11 } }} control={<Switch size="small" checked={Boolean(crop.points?.length) || progress !== null} disabled={disabled || progress !== null} onChange={(_, checked) => void automatic(checked)} />} label="התאמה אוטומטית" />
        </Tooltip>}
        <Tooltip title="תיקוני מילים ותזמון מילים מתעדכנים בכל הגרסאות. החלוקה והעיצוב נפרדים לכל גרסה.">
          <IconButton size="small" aria-label="מידע על הגרסאות" sx={{ color: 'text.secondary' }}><InfoOutlined /></IconButton>
        </Tooltip>
        <IconButton size="small" aria-label="סגור גרסאות סרטון" title="סגור גרסאות סרטון" aria-expanded={true} aria-controls={panelId} onClick={() => setExpanded(false)}><CloseRounded fontSize="small" /></IconButton>
      </Stack>
      </Box>
      {progress !== null && <Stack spacing={.5}><LinearProgress variant="determinate" value={progress} /><Stack direction="row" justifyContent="space-between"><Typography variant="caption" role="status">מתאים את המסגרת… {progress}%</Typography><Button size="small" onClick={() => job.current?.abort()}>ביטול</Button></Stack></Stack>}
    </Box>}
    {error && (enabled || dismissed) && <Alert severity="warning" onClose={() => setError(null)}>{error}</Alert>}
  </>;
}
