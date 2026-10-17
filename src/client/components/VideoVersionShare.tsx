import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { OpenInNewRounded, ShareRounded } from '@mui/icons-material';
import { VIDEO_FORMATS } from '../../videoVersions.js';
import { useVideoSharing } from '../hooks/useVideoSharing';

const youtube = { label: 'YouTube', url: 'https://studio.youtube.com/' };
const instagram = { label: 'Instagram', url: 'https://www.instagram.com/' };
const facebook = { label: 'Facebook', url: 'https://www.facebook.com/' };
const destinations = {
  original: [youtube],
  vertical: [
    { label: 'TikTok', url: 'https://www.tiktok.com/' },
    { ...youtube, label: 'YouTube Shorts' },
    { ...instagram, label: 'Instagram Reels / Stories' },
    { ...facebook, label: 'Facebook Reels / Stories' },
  ],
  square: [instagram, facebook],
  portrait: [instagram, facebook],
};

export function VideoVersionShare({ activeId, disabled, onBurnVideo }: {
  activeId: string; disabled: boolean;
  onBurnVideo: (options: { download: boolean; reuse: boolean }) => Promise<{ url: string; name: string } | null | void>;
}) {
  const sharing = useVideoSharing(!disabled, onBurnVideo);
  const format = VIDEO_FORMATS.find(item => item.id === activeId);
  const platforms = destinations[activeId as keyof typeof destinations] ?? [];
  return <>
    <Button size="small" startIcon={<ShareRounded />} disabled={disabled || sharing.sharing} onClick={() => void sharing.shareVideo()}>
      {sharing.sharing ? 'מכין לשיתוף…' : 'שיתוף הגרסה'}
    </Button>
    {sharing.shareError && !sharing.readyToShare && <Alert severity="error" onClose={sharing.closeShare}>{sharing.shareError}</Alert>}
    <Dialog open={Boolean(sharing.readyToShare)} onClose={sharing.sharing ? undefined : sharing.closeShare} fullWidth maxWidth="sm" dir="rtl" aria-labelledby="version-share-title">
      <DialogTitle id="version-share-title">שיתוף גרסת <bdi>{format?.label}</bdi></DialogTitle>
      <DialogContent>
        {sharing.shareError && <Alert severity="error" sx={{ mb: 2 }}>{sharing.shareError}</Alert>}
        <Typography>הגרסה מוכנה עם החיתוך והכתוביות שלה. הורידו את הקובץ, פתחו את הפלטפורמה הרצויה והעלו אותו שם.</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>הקישורים פותחים את הפלטפורמות; הם אינם מפרסמים את הסרטון אוטומטית.</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }}>
          {platforms.map(platform => <Button key={platform.label} component="a" href={platform.url} target="_blank" rel="noopener noreferrer"
            variant="outlined" size="small" endIcon={<OpenInNewRounded />} aria-label={`פתיחת ${platform.label}`}><bdi>{platform.label}</bdi></Button>)}
        </Stack>
        {sharing.readyToShare?.file && <Typography variant="body2" sx={{ mt: 2 }}>אפשר גם לפתוח את תפריט השיתוף של המכשיר ולבחור אפליקציה זמינה.</Typography>}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 2, pb: 2 }}>
        <Button disabled={sharing.sharing} onClick={sharing.closeShare}>סגור</Button>
        <Button disabled={sharing.sharing} variant="contained" onClick={() => void sharing.downloadReadyVideo({ keepOpen: true })}>הורדת הקובץ לשיתוף</Button>
        {sharing.readyToShare?.file && <Button disabled={sharing.sharing} variant="outlined" startIcon={<ShareRounded />} onClick={() => void sharing.shareReadyVideo()}>שיתוף דרך המכשיר</Button>}
      </DialogActions>
    </Dialog>
  </>;
}
