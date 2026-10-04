import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from '@mui/material';

const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export function IssueReportScreenshot({ user, reportId }: { user: User; reportId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const show = async () => {
    if (url) { setOpen(true); return; }
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError('');
    try {
      const token = await user.getIdToken();
      if (request.signal.aborted) return;
      const response = await fetch(`${base}/api/admin/issue-reports/${reportId}/screenshot`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: request.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? 'טעינת צילום המסך נכשלה. נסו שוב.');
      }
      const blob = await response.blob();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('התקבלה תשובה לא תקינה. נסו שוב.');
      if (!request.signal.aborted) { setUrl(URL.createObjectURL(blob)); setOpen(true); }
    } catch (err) {
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'טעינת צילום המסך נכשלה.');
    } finally { if (!request.signal.aborted) setLoading(false); }
  };

  return <Stack spacing={1} alignItems="flex-start">
    <Button variant="outlined" disabled={loading} onClick={() => void show()}>{loading ? 'טוען צילום מסך...' : url ? 'פתיחת צילום מסך' : 'הצגת צילום מסך'}</Button>
    {error && <Alert severity="error">{error}</Alert>}
    {url && <Box component="img" src={url} alt={`צילום מסך בדיווח ${reportId}`} sx={{ maxWidth: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 1 }} />}
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth dir="rtl" aria-labelledby={`report-screenshot-${reportId}`}>
      <DialogTitle id={`report-screenshot-${reportId}`}>צילום מסך · דיווח #{reportId}</DialogTitle>
      <DialogContent>{url && <Box component="img" src={url} alt="צילום המסך המצורף לדיווח" sx={{ display: 'block', maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', mx: 'auto' }} />}</DialogContent>
      <DialogActions><Button onClick={() => setOpen(false)}>סגירה</Button></DialogActions>
    </Dialog>
  </Stack>;
}
