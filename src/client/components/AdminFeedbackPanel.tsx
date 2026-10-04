import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Rating, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { adminRequest } from '../adminApi';
import { useAuth } from '../contexts/AuthContext';

type FeedbackRow = { id: string; rating: number; feedback: string; createdAt: string; videoId: number;
  email: string | null; displayName: string | null; filename: string | null };
type FeedbackPage = { feedback: FeedbackRow[]; total: number; page: number; pageSize: number };

export function AdminFeedbackPanel() {
  const { user } = useAuth();
  const [data, setData] = useState<FeedbackPage | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    void adminRequest<FeedbackPage>(user, `/feedback?page=${page}`, undefined, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.feedback) || result.pageSize !== 25) throw new Error('התקבלה תשובה לא תקינה. נסו שוב.');
        setData(result);
      }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user, page, retry]);
  return <Paper role="tabpanel" id="admin-feedback-panel" aria-labelledby="admin-feedback-tab" variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
    <Typography variant="h6" fontWeight={700} mb={2}>דירוגים ופידבק לאחר הורדת סרטון</Typography>
    {loading && <Stack alignItems="center" py={4}><CircularProgress /></Stack>}
    {error && <Alert severity="error" action={<Button onClick={() => setRetry(value => value + 1)}>נסה שוב</Button>}>{error}</Alert>}
    {data && <>
      {!data.feedback.length ? <Typography>טרם התקבלו דירוגים.</Typography> : <TableContainer><Table size="small"><TableHead><TableRow>
        {['מועד', 'משתמש', 'סרטון', 'דירוג', 'פידבק'].map(label => <TableCell key={label} align="right">{label}</TableCell>)}
      </TableRow></TableHead><TableBody>{data.feedback.map(entry => <TableRow key={entry.id}>
        <TableCell align="right">{new Date(entry.createdAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</TableCell>
        <TableCell align="right"><Typography>{entry.displayName ?? 'ללא שם'}</Typography><Typography variant="body2" dir="ltr">{entry.email ?? 'משתמש שהוסר'}</Typography></TableCell>
        <TableCell align="right" sx={{ overflowWrap: 'anywhere' }}>{entry.filename ?? `סרטון ${entry.videoId}`}</TableCell>
        <TableCell align="right"><Rating readOnly value={Number(entry.rating)} size="small" sx={{ direction: 'ltr' }} /><Typography variant="caption" display="block">{entry.rating}/5</Typography></TableCell>
        <TableCell align="right" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 180 }}>{entry.feedback || 'ללא פידבק כתוב'}</TableCell>
      </TableRow>)}</TableBody></Table></TableContainer>}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mt={2}>
        <Typography variant="body2">{data.total.toLocaleString('he-IL')} דירוגים · עמוד {page + 1}</Typography>
        <Box><Button disabled={page === 0} onClick={() => setPage(value => value - 1)}>הקודם</Button>
          <Button disabled={(page + 1) * 25 >= data.total} onClick={() => setPage(value => value + 1)}>הבא</Button></Box>
      </Stack>
    </>}
  </Paper>;
}
