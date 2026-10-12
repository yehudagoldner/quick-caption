import { Chip, Tooltip } from '@mui/material';

export function QaEnvironmentBadge({ onNavigate }: { onNavigate?: () => void } = {}) {
  if (import.meta.env.VITE_APP_ENV !== 'qa') return null;
  return <Tooltip title="סביבת QA — נתוני בדיקה, התשלומים כבויים. הורדת התוסף ל־Premiere">
    <Chip component="a" href={`${import.meta.env.BASE_URL}?screen=premiere`} onClick={event => { if (onNavigate) { event.preventDefault(); onNavigate(); } }} clickable label="QA" color="warning" size="small"
      aria-label="סביבת QA — הורדת התוסף ל־Premiere"
      sx={{ height: 20, fontSize: 11, flexShrink: 0, textDecoration: 'none' }} />
  </Tooltip>;
}
