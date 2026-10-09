import { useState } from 'react';
import { Alert, Button, Card, CardContent, Container, CssBaseline, Stack, ThemeProvider, Typography, createTheme } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api';

const theme = createTheme({ direction: 'rtl', typography: { fontFamily: '"Segoe UI", sans-serif' } });
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function PluginConnectPage() {
  const { user, loading, signIn, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id'), code = params.get('code');
  const valid = /^[0-9a-f-]{36}$/i.test(id ?? '') && /^[A-F0-9]{8}$/.test(code ?? '');
  async function approve() {
    setBusy(true); setError('');
    try {
      const response = await apiFetch(`${API_BASE}/api/plugin/link/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, userCode: code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'החיבור נכשל');
      setDone(true);
      // The non-secret challenge need not remain in browser history after approval.
      window.history.replaceState(null, '', `${import.meta.env.BASE_URL}?screen=plugin-connect`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'החיבור נכשל'); }
    finally { setBusy(false); }
  }
  async function login() {
    setError('');
    try { await signIn(); }
    catch { setError('ההתחברות לא הושלמה. אפשר לנסות שוב'); }
  }
  return <ThemeProvider theme={theme}><CssBaseline /><Container maxWidth="sm" dir="rtl" sx={{ pt: 8 }}>
    <Card><CardContent><Stack spacing={3}>
      <Typography variant="h4">חיבור Quick Caption לפרימייר</Typography>
      {done ? <Alert severity="success">החשבון חובר. אפשר לחזור לפרימייר ולסגור את הדף הזה.</Alert> : <>
        <Typography>התוסף יקבל גישה לסרטונים וליתרת הקרדיטים בחשבון, ויוכל לשלוח קבצים לתמלול בתשלום מתוך היתרה הזאת.</Typography>
        {valid ? <>
          <Typography>אשרו רק אם פתחתם עכשיו חיבור בתוסף והקוד שמופיע שם זהה:</Typography>
          <Typography component="div" dir="ltr" sx={{ fontSize: 32, letterSpacing: 4, textAlign: 'center' }}>{code}</Typography>
          {user ? <>
            <Typography>חשבון: {user.email ?? user.displayName}</Typography>
            <Button variant="contained" disabled={busy || loading} onClick={() => void approve()}>{busy ? 'מחבר…' : 'הקוד תואם — אישור חיבור החשבון'}</Button>
            <Button disabled={busy} onClick={() => void signOut()}>בחירת חשבון אחר</Button>
          </> : <Button variant="contained" disabled={loading} onClick={() => void login()}>התחברות עם Google</Button>}
        </> : <Alert severity="warning">פתחו בקשת חיבור חדשה מתוך התוסף בפרימייר.</Alert>}
      </>}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack></CardContent></Card>
  </Container></ThemeProvider>;
}
