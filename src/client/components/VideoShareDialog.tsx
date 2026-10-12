import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import { ShareRounded } from "@mui/icons-material";

export function VideoShareDialog({ open, onClose, onShare, onDownload, canShare, isAppleMobile, busy, error }: {
  open: boolean; onClose: () => void; onShare: () => Promise<void>; onDownload: () => Promise<void>;
  canShare: boolean; isAppleMobile: boolean; busy: boolean; error: string | null;
}) {
  return <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" dir="rtl" aria-labelledby="video-share-title">
    <DialogTitle id="video-share-title">הסרטון מוכן לשיתוף</DialogTitle>
    <DialogContent>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Typography>{canShare
        ? isAppleMobile ? 'לחצו על ״שמירה לתמונות״ ובתפריט שייפתח בחרו ״שמור סרטון״ (Save Video). אפשר גם לשלוח את הסרטון לאפליקציה אחרת.'
          : "אפשר לשתף את הסרטון באפליקציות במכשיר, או להוריד אותו כקובץ."
        : 'שיתוף קבצים אינו זמין בדפדפן הזה. אפשר להוריד את הסרטון לקבצים. באייפון, פתחו אותו ב״קבצים״ ובחרו שיתוף ← ״שמור סרטון״, אם האפשרות זמינה.'}</Typography>
    </DialogContent>
    <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 2, pb: 2 }}>
      <Button disabled={busy} onClick={onClose}>סגור</Button>
      <Button disabled={busy} variant={canShare ? "outlined" : "contained"} onClick={() => void onDownload()}>הורדה לקבצים</Button>
      {canShare && <Button disabled={busy} variant="contained" size="large" startIcon={<ShareRounded />} onClick={() => void onShare()}>{isAppleMobile ? "שמירה לתמונות" : "שתף"}</Button>}
    </DialogActions>
  </Dialog>;
}
