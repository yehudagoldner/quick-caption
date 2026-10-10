import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Typography } from '@mui/material';
import { ComputerRounded, DevicesRounded, RefreshRounded } from '@mui/icons-material';
import { apiFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';

type Connection = { id: string; kind: 'browser' | 'premiere'; label: string; createdAt: string | null; lastSeenAt: string | null; current: boolean };
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const date = (value: string | null) => value ? new Date(value).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : 'טרם נרשמה פעילות';

export function ConnectionsPage() {
  const { user, signIn } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState<Connection | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const generation = ++epoch.current;
    if (!user) { setConnections([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const response = await apiFetch(`${base}/api/connections`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'לא ניתן לטעון את החיבורים');
      if (epoch.current === generation) setConnections(data.connections);
    } catch (error) { if (epoch.current === generation) setError((error as Error).message); }
    finally { if (epoch.current === generation) setLoading(false); }
  }, [user]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  const disconnect = async () => {
    if (!target || pending) return;
    const generation = epoch.current;
    setPending(true); setError(null); setMessage(null);
    try {
      const path = target === 'all' ? '/revoke-all' : `/${target.id}/revoke`;
      const response = await apiFetch(`${base}/api/connections${path}`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'הניתוק נכשל');
      if (epoch.current !== generation) return;
      setTarget(null);
      if (data.disconnectedCurrent) {
        window.dispatchEvent(new CustomEvent('qc-connection-revoked', { detail: { uid: user?.uid } }));
        setConnections([]); setMessage('החיבורים נותקו. יש להתחבר מחדש.');
      } else { setMessage('החיבור נותק בהצלחה.'); await load(); }
    } catch (error) { if (epoch.current === generation) { setTarget(null); setError((error as Error).message); } }
    finally { setPending(false); }
  };
  return <Box dir="rtl" sx={{ maxWidth: 860, mx: 'auto' }}>
    <Stack direction="row" alignItems="center" gap={1.5} mb={1}><DevicesRounded color="primary" /><Typography variant="h4" fontWeight={700}>החיבורים שלי</Typography></Stack>
    <Typography color="text.secondary" mb={3}>ניהול הגישה לחשבון מהאתר ומתוספי Quick Caption.</Typography>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {message && <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert>}
    {!user ? <Paper variant="outlined" sx={{ p: 3 }}><Typography mb={2}>התחברו כדי לראות ולנהל את החיבורים שלכם.</Typography><Button variant="contained" onClick={() => void signIn()}>התחברות</Button></Paper> : <>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} mb={2}>
        <Button startIcon={<RefreshRounded />} disabled={loading || pending} onClick={() => void load()}>רענון הרשימה</Button>
        <Button color="error" variant="outlined" disabled={loading || pending || !connections.length} onClick={() => setTarget('all')}>ניתוק כל החיבורים</Button>
      </Stack>
      {loading ? <Stack alignItems="center" p={5} role="status" aria-label="טוען חיבורים"><CircularProgress /></Stack> : <Stack gap={1.5}>
        {connections.map(connection => <Paper key={connection.id} variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" gap={2}>
            <Stack direction="row" gap={1.5} alignItems="flex-start"><ComputerRounded color={connection.current ? 'primary' : 'action'} sx={{ mt: 0.5 }} /><Box>
              <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap"><Typography fontWeight={600}>{connection.label}</Typography>{connection.current && <Chip label="החיבור הנוכחי" size="small" color="primary" variant="outlined" />}</Stack>
              <Typography variant="body2" color="text.secondary">{connection.kind === 'premiere' ? 'תוסף לפרימייר' : 'חיבור לאתר'}</Typography>
              {connection.createdAt && <Typography variant="body2" color="text.secondary">נרשם: {date(connection.createdAt)}</Typography>}
              <Typography variant="body2" color="text.secondary">פעילות אחרונה: {date(connection.lastSeenAt)}</Typography>
            </Box></Stack>
            <Button color="error" disabled={pending} onClick={() => setTarget(connection)} aria-label={`ניתוק ${connection.label}`}>ניתוק</Button>
          </Stack>
        </Paper>)}
        {!connections.length && <Typography color="text.secondary">אין חיבורים פעילים.</Typography>}
      </Stack>}
      <Typography variant="body2" color="text.secondary" mt={3}>הניתוק חוסם גישה חדשה לחשבון. קבצים שכבר הורדו ופעולות שכבר נשלחו אינם נמחקים או מבוטלים. חיבורים ישנים לאתר יופיעו אחרי הפעילות הבאה שלהם.</Typography>
    </>}
    <Dialog open={Boolean(target)} onClose={() => { if (!pending) setTarget(null); }} slotProps={{ paper: { dir: 'rtl' } }}>
      <DialogTitle>{target === 'all' ? 'לנתק את כל החיבורים?' : 'לנתק את החיבור?'}</DialogTitle>
      <DialogContent><Typography>{target === 'all' ? 'כל הדפדפנים והתוספים ינותקו, כולל החיבור שבו אתם משתמשים עכשיו. כדי להמשיך יהיה צורך להתחבר מחדש.' : target?.current ? 'זה החיבור הנוכחי שלכם. אחרי הניתוק יהיה צורך להתחבר מחדש.' : 'במכשיר הזה יהיה צורך להתחבר ולאשר שוב את הגישה לחשבון.'}</Typography></DialogContent>
      <DialogActions><Button disabled={pending} onClick={() => setTarget(null)}>ביטול</Button><Button color="error" variant="contained" disabled={pending} onClick={() => void disconnect()}>{pending ? 'מנתק...' : 'אישור ניתוק'}</Button></DialogActions>
    </Dialog>
  </Box>;
}
