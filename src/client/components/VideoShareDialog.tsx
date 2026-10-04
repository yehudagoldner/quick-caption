import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import { ShareRounded } from "@mui/icons-material";

export function VideoShareDialog({ open, onClose, onShare }: { open: boolean; onClose: () => void; onShare: () => Promise<void> }) {
  return <Dialog open={open} onClose={onClose} fullWidth>
    <DialogTitle>הסרטון מוכן לשיתוף</DialogTitle>
    <DialogContent><Typography>אפשר לשתף את הסרטון באפליקציות במכשיר, או להוריד אותו כשהשיתוף אינו זמין.</Typography></DialogContent>
    <DialogActions>
      <Button onClick={onClose}>סגור</Button>
      <Button variant="contained" size="large" startIcon={<ShareRounded />} onClick={() => void onShare()}>שתף</Button>
    </DialogActions>
  </Dialog>;
}
