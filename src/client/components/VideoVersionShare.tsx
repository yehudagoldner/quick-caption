import { Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, Divider, IconButton, Stack, Typography } from '@mui/material';
import { CheckCircleRounded, CloseRounded, DownloadRounded, ShareRounded } from '@mui/icons-material';
import { VIDEO_FORMATS } from '../../videoVersions.js';
import { useVideoSharing } from '../hooks/useVideoSharing';
import { SocialPlatformIcon, type SocialPlatform } from './SocialPlatformIcon';

const destinations: Record<string, { id: SocialPlatform; name: string; placement: string }[]> = {
  original: [{ id: 'youtube', name: 'YouTube', placement: 'סרטון רחב' }],
  vertical: [
    { id: 'tiktok', name: 'TikTok', placement: 'סרטון אנכי' },
    { id: 'youtube', name: 'YouTube', placement: 'Shorts' },
    { id: 'instagram', name: 'Instagram', placement: 'Reels · Stories' },
    { id: 'facebook', name: 'Facebook', placement: 'Reels · Stories' },
  ],
  square: [{ id: 'instagram', name: 'Instagram', placement: 'פיד' }, { id: 'facebook', name: 'Facebook', placement: 'פיד' }],
  portrait: [{ id: 'instagram', name: 'Instagram', placement: 'פיד' }, { id: 'facebook', name: 'Facebook', placement: 'פיד' }],
};

export function VideoVersionShare({ activeId, disabled, onBurnVideo }: {
  activeId: string; disabled: boolean;
  onBurnVideo: (options: { download: boolean; reuse: boolean }) => Promise<{ url: string; name: string } | null | void>;
}) {
  const sharing = useVideoSharing(!disabled, onBurnVideo);
  const format = VIDEO_FORMATS.find(item => item.id === activeId);
  const platforms = destinations[activeId] ?? [];
  const ready = sharing.readyToShare;
  return <>
    <Button size="small" startIcon={<ShareRounded />} disabled={disabled || sharing.sharing} onClick={() => void sharing.shareVideo()}>
      {sharing.sharing ? 'מכין לשיתוף…' : 'שיתוף הגרסה'}
    </Button>
    {sharing.shareError && !ready && <Alert severity="error" onClose={sharing.closeShare}>{sharing.shareError}</Alert>}
    <Dialog open={Boolean(ready)} onClose={sharing.sharing ? undefined : sharing.closeShare} fullWidth maxWidth="md" dir="rtl"
      aria-labelledby="version-share-title" slotProps={{ paper: { sx: { borderRadius: '20px', maxWidth: 760, textAlign: 'right' } } }}>
      <DialogTitle id="version-share-heading-container" component="div" sx={{ px: 3, pt: 2.5, pb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box><Typography id="version-share-title" component="h2" variant="h6" fontWeight={700}>שיתוף גרסת <bdi>{format?.label}</bdi></Typography>
            <Typography variant="body2" color="text.secondary">הסרטון שלכם, עם החיתוך והכתוביות שבחרתם</Typography></Box>
          <IconButton disabled={sharing.sharing} onClick={sharing.closeShare} aria-label="סגור" size="small"><CloseRounded /></IconButton>
        </Stack>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ p: 3, '& .MuiButton-root': { gap: 1 }, '& .MuiButton-startIcon': { m: 0 } }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, 1.25fr)' }, gap: 3, alignItems: 'start' }}>
          <Stack spacing={1.5} sx={{ minWidth: 0 }}>
            <Box sx={{ bgcolor: '#111827', borderRadius: '12px', overflow: 'hidden', display: 'grid', placeItems: 'center', height: 280 }}>
              {ready && <Box component="video" src={ready.url} controls playsInline preload="metadata" aria-label="תצוגת הסרטון המוכן לשיתוף"
                sx={{ display: 'block', width: '100%', height: '100%', maxHeight: 280, objectFit: 'contain' }} />}
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Chip size="small" icon={<CheckCircleRounded />} label="מוכן לשיתוף" color="success" variant="outlined" />
              <Typography variant="caption" color="text.secondary"><bdi>MP4 · {format?.label}</bdi></Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" dir="ltr" sx={{ overflowWrap: 'anywhere' }}>{ready?.name}</Typography>
          </Stack>
          <Stack spacing={2.25} sx={{ minWidth: 0 }}>
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>הפורמט מתאים ל־</Typography>
              <Box role="list" aria-label="פלטפורמות מתאימות" sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
                {platforms.map(platform => <Stack role="listitem" key={platform.id} direction="row" gap={1} alignItems="center" sx={{ py: 1, minWidth: 0 }}>
                  <SocialPlatformIcon platform={platform.id} />
                  <Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600}><bdi>{platform.name}</bdi></Typography>
                    <Typography variant="caption" color="text.secondary"><bdi>{platform.placement}</bdi></Typography></Box>
                </Stack>)}
              </Box>
            </Box>
            <Divider />
            {sharing.shareError && <Alert severity="error">{sharing.shareError}</Alert>}
            {ready?.file ? <Stack spacing={1}>
              <Typography variant="subtitle2" fontWeight={700}>שלחו את קובץ הסרטון</Typography>
              <Typography variant="body2" color="text.secondary">בחרו אפליקציה בתפריט השיתוף של המכשיר. יוצגו רק אפליקציות שתומכות בקבלת סרטון.</Typography>
              <Button disabled={sharing.sharing} fullWidth variant="contained" size="large" startIcon={<ShareRounded />}
                onClick={() => void sharing.shareReadyVideo()}>שיתוף דרך המכשיר</Button>
            </Stack> : <Alert severity="info" icon={<ShareRounded />} sx={{ alignItems: 'center' }}>שיתוף קובץ ישירות לאפליקציה אינו זמין בדפדפן הזה. אפשר להוריד את הסרטון ולהעלות אותו מהאפליקציה.</Alert>}
            <Button disabled={sharing.sharing} fullWidth variant={ready?.file ? 'outlined' : 'contained'} size="large" startIcon={<DownloadRounded />}
              onClick={() => void sharing.downloadReadyVideo({ keepOpen: true })}>הורדת הקובץ לשיתוף</Button>
            <Typography variant="caption" color="text.secondary">העלאה ישירה לחשבונות ברשתות עדיין לא מחוברת. שמות הפלטפורמות מציינים התאמה לפורמט.</Typography>
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  </>;
}
