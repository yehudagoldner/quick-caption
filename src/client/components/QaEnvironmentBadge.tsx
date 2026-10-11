import { Chip, Tooltip } from '@mui/material';

export function QaEnvironmentBadge() {
  if (import.meta.env.VITE_APP_ENV !== 'qa') return null;
  return <Tooltip title="סביבת QA — נתוני בדיקה, התשלומים כבויים. הורדת התוסף ל־Premiere">
    <Chip component="a" href={`${import.meta.env.BASE_URL}premiere.html`} clickable label="QA" color="warning" size="small"
      aria-label="סביבת QA — הורדת התוסף ל־Premiere"
      sx={{ height: 20, fontSize: 11, flexShrink: 0, textDecoration: 'none' }} />
  </Tooltip>;
}
