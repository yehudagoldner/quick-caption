import { Chip, Tooltip } from '@mui/material';

export function QaEnvironmentBadge() {
  if (import.meta.env.VITE_APP_ENV !== 'qa') return null;
  return <Tooltip title="סביבת QA — נתוני בדיקה, התשלומים כבויים">
    <Chip label="QA" color="warning" size="small" aria-label="סביבת QA — נתוני בדיקה, התשלומים כבויים"
      sx={{ height: 20, fontSize: 11, flexShrink: 0 }} />
  </Tooltip>;
}
