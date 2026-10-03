import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { adminRequest } from '../adminApi';
import { useAuth } from '../contexts/AuthContext';

type ErrorRow = { id: number; source: 'server' | 'client'; operation: string; message: string;
  status: number | null; method: string | null; userUid: string | null; requestId: string | null; createdAt: string };
type ErrorPage = { errors: ErrorRow[]; total: number; page: number; pageSize: number; snapshot: number };
const date = (value: string) => new Date(value).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

export function AdminErrorsPanel({ reloadKey }: { reloadKey: number }) {
  const { user } = useAuth();
  const [data, setData] = useState<ErrorPage | null>(null);
  const [page, setPage] = useState(0);
  const snapshot = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const seenReload = useRef(reloadKey);
  useEffect(() => {
    if (seenReload.current !== reloadKey) {
      seenReload.current = reloadKey; snapshot.current = undefined;
      if (page !== 0) { setPage(0); return; }
    }
    if (!user) { setData(null); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    const query = `?page=${page}${snapshot.current == null ? '' : `&snapshot=${snapshot.current}`}`;
    void adminRequest<ErrorPage>(user, `/errors${query}`, undefined, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.errors) || result.errors.length > 50 || result.pageSize !== 50) {
          throw new Error('התקבלה תשובה לא תקינה. אפשר לנסות שוב.');
        }
        snapshot.current = result.snapshot; setData(result);
      })
      .catch(err => { if (!controller.signal.aborted) setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user, page, reloadKey, retry]);

  return <Paper role="tabpanel" id="admin-errors-panel" aria-labelledby="admin-errors-tab" variant="outlined" sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}>
    <Typography variant="h6" fontWeight={700} mb={1}>שגיאות האפליקציה</Typography>
    <Typography color="text.secondary" variant="body2" mb={2}>50 שגיאות בעמוד, מהחדשה לישנה. רענון מציג גם שגיאות שהתקבלו מאז פתיחת הטבלה.</Typography>
    {error && <Alert severity="error" action={<Button color="inherit" onClick={() => setRetry(value => value + 1)}>ניסיון נוסף</Button>}>{error}</Alert>}
    {loading && <Stack alignItems="center" py={5}><CircularProgress aria-label="טוען שגיאות" /></Stack>}
    {!loading && data && <>
      {!data.errors.length ? <Alert severity="info">לא נרשמו שגיאות.</Alert> : <TableContainer sx={{ maxHeight: 640 }}>
        <Table stickyHeader size="small" aria-label="שגיאות האפליקציה" sx={{ minWidth: 900, tableLayout: 'fixed' }}>
          <TableHead><TableRow>
            {['מועד', 'מקור / סטטוס', 'פעולה', 'משתמש', 'שגיאה'].map((label, index) =>
              <TableCell key={label} align="right" sx={{ width: [175, 130, 180, 170, 360][index] }}>{label}</TableCell>)}
          </TableRow></TableHead>
          <TableBody>{data.errors.map(entry => <TableRow key={entry.id}>
            <TableCell align="right">{date(entry.createdAt)}</TableCell>
            <TableCell align="right"><Stack gap={0.5} alignItems="flex-start">
              <Chip size="small" label={entry.source === 'server' ? 'שרת' : 'דפדפן'} />
              {entry.status != null && <Chip size="small" label={`HTTP ${entry.status}`} color={entry.status >= 500 ? 'error' : 'warning'} />}
            </Stack></TableCell>
            <TableCell align="right" sx={{ overflowWrap: 'anywhere' }}><span dir="auto">{entry.method ? `${entry.method} ` : ''}{entry.operation}</span></TableCell>
            <TableCell align="right" sx={{ overflowWrap: 'anywhere' }}><span dir="ltr">{entry.userUid ?? 'לא מזוהה'}</span></TableCell>
            <TableCell align="right" sx={{ overflowWrap: 'anywhere' }}>
              <Typography variant="body2" dir="auto">{entry.message}</Typography>
              {entry.requestId && <Typography variant="caption" color="text.secondary" dir="ltr" display="block">{entry.requestId}</Typography>}
            </TableCell>
          </TableRow>)}
          </TableBody>
        </Table>
      </TableContainer>}
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} justifyContent="space-between" alignItems="center" mt={2}>
        <Typography variant="body2">{data.total.toLocaleString('he-IL')} שגיאות · עמוד {page + 1} מתוך {Math.max(1, Math.ceil(data.total / 50))}</Typography>
        <Box><Button disabled={page === 0} onClick={() => setPage(value => value - 1)}>הקודם</Button>
          <Button disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(value => value + 1)}>הבא</Button></Box>
      </Stack>
    </>}
  </Paper>;
}
