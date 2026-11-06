import { useRef, useState } from 'react';
import { Alert, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { MAX_MEDIA_BYTES, MEDIA_SIZE_ERROR } from '../../mediaPolicy.js';

export function ReplaceVideoSettings({ disabled, busy, onReplace }: {
  disabled: boolean; busy: boolean; onReplace: (file: File) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const choose = async (file?: File) => {
    if (!file || disabled || busy) return;
    setError(null); setFilename(null);
    if (file.size > MAX_MEDIA_BYTES) { setError(MEDIA_SIZE_ERROR); return; }
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(file.name)) {
      setError('בחרו קובץ וידאו נתמך.'); return;
    }
    try { await onReplace(file); setFilename(file.name); }
    catch (error) { setError(error instanceof Error ? error.message : 'החלפת הסרטון נכשלה. נסו שוב.'); }
  };
  return <Stack spacing={1} dir="rtl">
    <Typography variant="subtitle2">החלפת הסרטון</Typography>
    <Typography variant="body2" color="text.secondary">בחרו סרטון אחר לפרויקט. הכתוביות, התזמונים והעיצוב יישארו כפי שהם, ללא תמלול נוסף. הסרטון החדש יישמר וישמש גם בייצוא.</Typography>
    <Typography variant="caption" color="text.secondary">מומלץ לבחור סרטון עם אותו רצף עריכה. אם האורך או תוכן הסרטון השתנו, ייתכן שתצטרכו להתאים את תזמון הכתוביות.</Typography>
    <input ref={input} type="file" accept="video/*,.mp4,.mov,.webm,.mkv,.avi,.m4v" aria-label="בחירת סרטון חלופי" hidden disabled={disabled || busy}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file); }} />
    <Button variant="outlined" disabled={disabled || busy} onClick={() => input.current?.click()} sx={{ alignSelf: 'flex-start' }}>{busy ? 'מחליף סרטון...' : 'החלפת סרטון'}</Button>
    {busy && <><LinearProgress aria-label="העלאת הסרטון החלופי" /><Typography role="status" variant="caption">מעלים ושומרים את הסרטון. השאירו את העמוד פתוח עד לסיום.</Typography></>}
    {error && <Alert severity="error">{error}</Alert>}
    {filename && <Alert severity="success">הסרטון הוחלף ל־<bdi>{filename}</bdi>. הכתוביות והתזמונים נשמרו.</Alert>}
  </Stack>;
}
