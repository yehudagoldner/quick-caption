import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { AddRounded, RefreshRounded, AdminPanelSettingsRounded } from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { adminRequest } from '../adminApi';

type Numeric = number | string;
type Account = { uid: string; email: string; displayName: string | null; credits: number; paying: boolean; admin: boolean; createdAt: string };
type UserPage = { users: Account[]; total: number; page: number };
type Overview = {
  revenue: { revenueUSD: Numeric; payments: Numeric };
  users: { total: Numeric; paying: Numeric; free: Numeric };
  media: { processed: Numeric; videos: Numeric; edited: Numeric; durationSeconds: Numeric };
  usage: { costUSD: Numeric; inputTokens: Numeric; outputTokens: Numeric; calls: Numeric; unpriced: Numeric; trackingSince: string | null };
  models: { model: string; serviceTier: string; calls: Numeric; inputTokens: Numeric; outputTokens: Numeric; cachedTokens: Numeric; durationSeconds: Numeric; costUSD: Numeric; unpriced: Numeric }[];
  admins: { email: string; grantedBy: string; createdAt: string }[];
  audit: { actor: string; action: string; target: string; credits: number | null; reason: string | null; createdAt: string }[];
};
const number = (value: Numeric) => Number(value).toLocaleString('he-IL');
const money = (value: Numeric) => Number(value).toLocaleString('he-IL', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const date = (value: string | null) => value ? new Date(value).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) : 'טרם נרשם שימוש';

export function AdminPage() {
  const { user, loading: authLoading, signIn } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<UserPage>({ users: [], total: 0, page: 0 });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'admin' | 'credits' | null>(null);
  const [target, setTarget] = useState<Account | null>(null);
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('100');
  const [reason, setReason] = useState('');
  const [dialogError, setDialogError] = useState('');
  const pendingGrant = useRef<{ requestId: string; body: object; path: string } | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++generation.current;
    if (!user) { setOverview(null); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [stats, users] = await Promise.all([
        adminRequest<Overview>(user, '/overview'),
        adminRequest<UserPage>(user, `/users?search=${encodeURIComponent(search)}&page=${page}`),
      ]);
      if (version !== generation.current) return;
      setOverview(stats); setAccounts(users);
    } catch (err) { if (version === generation.current) { setOverview(null); setError((err as Error).message); } }
    finally { if (version === generation.current) setLoading(false); }
  }, [user, search, page]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 250);
    return () => { window.clearTimeout(timer); ++generation.current; };
  }, [refresh]);

  const openDialog = (kind: 'admin' | 'credits', account: Account | null = null) => {
    setDialog(kind); setTarget(account); setEmail(account?.email ?? ''); setAmount('100'); setReason('');
    setDialogError(''); pendingGrant.current = null;
  };
  const submit = async () => {
    if (!user || !dialog) return;
    if (!pendingGrant.current) {
      const requestId = crypto.randomUUID();
      pendingGrant.current = { requestId, path: dialog === 'admin' ? '/admins' : '/credits',
        body: dialog === 'admin' ? { email, requestId } : { userUid: target?.uid, credits: Number(amount), reason, requestId } };
    }
    setBusy(true); setDialogError('');
    try {
      await adminRequest(user, pendingGrant.current.path, pendingGrant.current.body);
      setSuccess(dialog === 'admin' ? `נוספה גישת ניהול ל־${email}.` : `נוספו ${amount} קרדיטים ל־${target?.email}.`);
      setDialog(null); pendingGrant.current = null; await refresh();
    } catch (err) { setDialogError((err as Error).message); }
    finally { setBusy(false); }
  };
  // Editing details starts a new operation. A retry of unchanged details keeps the original ID.
  const change = (setter: (value: string) => void, value: string) => { pendingGrant.current = null; setter(value); };

  if (authLoading) return <Stack alignItems="center" py={8}><CircularProgress /></Stack>;
  if (!user) return <Stack dir="rtl" spacing={2} alignItems="center" py={8}>
    <AdminPanelSettingsRounded color="primary" sx={{ fontSize: 48 }} />
    <Typography variant="h4">ניהול QuickCaption</Typography>
    <Typography>יש להתחבר עם חשבון בעל הרשאת ניהול.</Typography>
    <Button variant="contained" onClick={() => void signIn()}>התחברות לניהול</Button>
  </Stack>;

  const cards = overview ? [
    ['הכנסות', money(overview.revenue.revenueUSD), `${number(overview.revenue.payments)} רכישות מאומתות · לפני עמלות והחזרים`],
    ['סרטונים שעובדו', number(overview.media.videos), `${number(overview.media.processed)} קובצי וידאו ואודיו · ${number(overview.media.edited)} נשמרו לאחר עריכה`],
    ['משך מדיה שעובדה', `${number((Number(overview.media.durationSeconds) / 3600).toFixed(2))} שעות`, `${number((Number(overview.media.durationSeconds) / 60).toFixed(1))} דקות וידאו ואודיו`],
    ['משתמשים שנרשמו', number(overview.users.total), `${number(overview.users.free)} חינמיים · ${number(overview.users.paying)} משלמים`],
    ['הוצאות AI משוערות', money(overview.usage.costUSD), `${number(overview.usage.calls)} קריאות API מאז תחילת המעקב`],
    ['טוקנים', number(Number(overview.usage.inputTokens) + Number(overview.usage.outputTokens)), `${number(overview.usage.inputTokens)} קלט · ${number(overview.usage.outputTokens)} פלט`],
  ] : [];

  return <Box dir="rtl" sx={{ maxWidth: 1440, mx: 'auto' }}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3} gap={2}>
      <Box><Typography variant="h4" fontWeight={800}>ניהול QuickCaption</Typography><Typography color="text.secondary">נתוני פעילות, הכנסות, משתמשים והוצאות AI</Typography></Box>
      <Button startIcon={<RefreshRounded />} onClick={() => void refresh()} disabled={loading}>רענון</Button>
    </Stack>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}
    {loading && <Stack alignItems="center" py={4}><CircularProgress /></Stack>}
    {overview && <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
        {cards.map(([title, value, detail]) => <Card key={title} variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">{title}</Typography><Typography variant="h4" fontWeight={800} sx={{ my: 1 }}>{value}</Typography><Typography variant="body2" color="text.secondary">{detail}</Typography>
        </Card>)}
      </Box>
      <Alert severity="info" sx={{ mb: 3 }}>משתמש משלם הוא משתמש שרכש קרדיטים לפחות פעם אחת. עלויות AI הן אומדן לפי שימוש ותעריף, כולל תמלול ועריכת AI. נתוני עבר שלא נרשמו אינם כלולים. תחילת הרישום: {date(overview.usage.trackingSince)}.
        {' '}<a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">מחירון OpenAI</a>
      </Alert>
      {Number(overview.usage.unpriced) > 0 && <Alert severity="warning" sx={{ mb: 3 }}>{number(overview.usage.unpriced)} קריאות ללא עלות ידועה אינן כלולות בסכום ההוצאות.</Alert>}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} mb={2}>
          <Typography variant="h6" fontWeight={700}>משתמשים וקרדיטים</Typography>
          <TextField size="small" label="חיפוש לפי אימייל או שם" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        </Stack>
        <TableContainer><Table size="small"><TableHead><TableRow>
          {['משתמש', 'הרשמה', 'סוג', 'קרדיטים', 'פעולות'].map(label => <TableCell key={label} align="right">{label}</TableCell>)}
        </TableRow></TableHead><TableBody>
          {accounts.users.map(account => <TableRow key={account.uid}>
            <TableCell align="right"><Typography fontWeight={600}>{account.displayName ?? 'ללא שם'}</Typography><Typography variant="body2" dir="ltr" sx={{ textAlign: 'right' }}>{account.email}</Typography></TableCell>
            <TableCell align="right">{date(account.createdAt)}</TableCell>
            <TableCell align="right"><Stack direction="row" gap={0.5}><Chip size="small" label={account.paying ? 'משלם' : 'חינמי'} color={account.paying ? 'success' : 'default'} />{Boolean(account.admin) && <Chip size="small" label="מנהל" color="primary" />}</Stack></TableCell>
            <TableCell align="right">{number(account.credits)}</TableCell>
            <TableCell align="right"><Stack direction="row" gap={1}><Button size="small" onClick={() => openDialog('credits', account)}>הוספת קרדיטים</Button>{!account.admin && <Button size="small" onClick={() => openDialog('admin', account)}>הוספה לניהול</Button>}</Stack></TableCell>
          </TableRow>)}
          {!accounts.users.length && <TableRow><TableCell colSpan={5} align="center">לא נמצאו משתמשים.</TableCell></TableRow>}
        </TableBody></Table></TableContainer>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mt={2}>
          <Typography variant="body2">{number(accounts.total)} משתמשים · עמוד {page + 1}</Typography>
          <Box><Button disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>הקודם</Button><Button disabled={(page + 1) * 25 >= accounts.total || loading} onClick={() => setPage(page + 1)}>הבא</Button></Box>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}><Typography variant="h6" fontWeight={700}>מנהלים</Typography><Button startIcon={<AddRounded />} onClick={() => openDialog('admin')}>הוספת מנהל</Button></Stack>
        <Stack spacing={1}>{overview.admins.map(admin => <Stack key={admin.email} direction="row" gap={1} alignItems="center"><Typography dir="ltr">{admin.email}</Typography><Chip size="small" label={admin.email === 'goldnery@gmail.com' ? 'בעלים' : 'מנהל'} /></Stack>)}</Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}><Typography variant="h6" fontWeight={700} mb={2}>הוצאות לפי מודל</Typography>
        <TableContainer><Table size="small"><TableHead><TableRow>{['מודל / מהירות', 'קריאות', 'טוקני קלט', 'טוקני פלט', 'קלט שמור', 'דקות אודיו', 'עלות משוערת'].map(label => <TableCell key={label} align="right">{label}</TableCell>)}</TableRow></TableHead><TableBody>
          {overview.models.map(model => <TableRow key={`${model.model}-${model.serviceTier}`}><TableCell align="right"><span dir="ltr">{model.model} / {model.serviceTier}</span></TableCell><TableCell align="right">{number(model.calls)}</TableCell><TableCell align="right">{number(model.inputTokens)}</TableCell><TableCell align="right">{number(model.outputTokens)}</TableCell><TableCell align="right">{number(model.cachedTokens)}</TableCell><TableCell align="right">{number((Number(model.durationSeconds) / 60).toFixed(1))}</TableCell><TableCell align="right">{money(model.costUSD)}{Number(model.unpriced) > 0 && <Typography variant="caption" display="block">{number(model.unpriced)} ללא תמחור</Typography>}</TableCell></TableRow>)}
          {!overview.models.length && <TableRow><TableCell colSpan={7} align="center">נתוני עלות יופיעו לאחר שימוש ב־AI.</TableCell></TableRow>}
        </TableBody></Table></TableContainer>
      </Paper>
      <Paper variant="outlined" sx={{ p: 3 }}><Typography variant="h6" fontWeight={700} mb={2}>פעולות ניהול אחרונות</Typography>
        <TableContainer><Table size="small"><TableHead><TableRow>{['מועד', 'מנהל', 'פעולה', 'יעד', 'סיבה'].map(label => <TableCell key={label} align="right">{label}</TableCell>)}</TableRow></TableHead><TableBody>
          {overview.audit.map((entry, index) => <TableRow key={index}><TableCell align="right">{date(entry.createdAt)}</TableCell><TableCell align="right"><span dir="ltr">{entry.actor}</span></TableCell><TableCell align="right">{entry.action === 'grant-credits' ? `זיכוי ${entry.credits} קרדיטים` : 'הוספת מנהל'}</TableCell><TableCell align="right"><span dir="ltr">{entry.target}</span></TableCell><TableCell align="right">{entry.reason ?? '—'}</TableCell></TableRow>)}
          {!overview.audit.length && <TableRow><TableCell colSpan={5} align="center">טרם בוצעו פעולות ניהול.</TableCell></TableRow>}
        </TableBody></Table></TableContainer>
      </Paper>
    </>}
    <Dialog open={Boolean(dialog)} onClose={() => { if (!busy) setDialog(null); }} fullWidth maxWidth="sm" dir="rtl">
      <DialogTitle>{dialog === 'admin' ? 'הוספת מנהל' : 'הוספת קרדיטים'}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        {dialog === 'admin' ? <><TextField label="אימייל המנהל" type="email" value={email} onChange={e => change(setEmail, e.target.value)} disabled={busy} /><Typography variant="body2">גישה מלאה לנתונים, הוספת קרדיטים ומנהלים. אפשר להוסיף לפני הרשמה; הגישה תיפתח לאחר התחברות עם האימייל המאומת.</Typography></> : <>
          <Typography>זיכוי עבור <b dir="ltr">{target?.email}</b> · יתרה: {target?.credits}</Typography>
          <TextField label="מספר קרדיטים להוספה" type="number" value={amount} onChange={e => change(setAmount, e.target.value)} inputProps={{ min: 1, max: 1000000, step: 1 }} disabled={busy} />
          <TextField label="סיבת הזיכוי" value={reason} onChange={e => change(setReason, e.target.value)} inputProps={{ maxLength: 500 }} disabled={busy} />
        </>}
        {dialogError && <Alert severity="error">{dialogError}</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setDialog(null)}>ביטול</Button><Button variant="contained" disabled={busy || (dialog === 'admin' ? !email.trim() : !reason.trim() || !Number.isSafeInteger(Number(amount)) || Number(amount) < 1 || Number(amount) > 1000000)} onClick={() => void submit()}>{busy ? 'שומר...' : dialog === 'admin' ? 'הוספת גישת ניהול' : 'הוספת הקרדיטים'}</Button></DialogActions>
    </Dialog>
  </Box>;
}
