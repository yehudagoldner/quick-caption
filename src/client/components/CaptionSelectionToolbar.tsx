import { useState } from 'react';
import { Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, IconButton, Tooltip, Typography } from '@mui/material';
import { AddRounded, SelectAllRounded, DeselectRounded, JoinFullRounded, DeleteOutlineRounded, ContentCutRounded, KeyboardRounded, ArrowBackRounded, ArrowForwardRounded } from '@mui/icons-material';

export function CaptionSelectionToolbar({ count, disabled, canAdd, canMerge, canSplit, add, selectAll, clear, merge, split, remove, move }: {
  count: number; disabled: boolean; canAdd: boolean; canMerge: boolean; canSplit: boolean;
  add: () => void; selectAll: () => void; clear: () => void; merge: () => void; split: () => void; remove: () => void; move: (frames: number) => void;
}) {
  const [help, setHelp] = useState(false);
  const commands = [
    ['בחירת הכול', 'Ctrl / ⌘ + A', <SelectAllRounded />, selectAll, false],
    ['ניקוי הבחירה', 'Esc', <DeselectRounded />, clear, !count],
    ['הזזת הבחירה פריים שמאלה', '← · Shift: חמישה פריימים', <ArrowBackRounded />, () => move(-1), !count],
    ['הזזת הבחירה פריים ימינה', '→ · Shift: חמישה פריימים', <ArrowForwardRounded />, () => move(1), !count],
    ['חיבור כתוביות נבחרות', 'Ctrl / ⌘ + M · כתוביות רצופות בלבד', <JoinFullRounded />, merge, !canMerge],
    ['פיצול כתובית בנקודת הקו', 'Ctrl / ⌘ + K', <ContentCutRounded />, split, !canSplit],
    ['מחיקת כתוביות נבחרות', 'Delete / Backspace', <DeleteOutlineRounded />, remove, !count],
  ] as const;
  return <>
    <Box role="toolbar" aria-label="פעולות בחירת כתוביות" sx={{ display: 'flex', alignItems: 'center', gap: .25, marginInlineStart: 'auto', flexShrink: 0, '& .MuiIconButton-root': { width: 30, height: 30, p: .5 }, '& .MuiSvgIcon-root': { fontSize: 19 } }}>
      <Typography variant="caption" role="status" sx={{ minWidth: 48 }}>{count ? `${count} נבחרו` : 'בחירה'}</Typography>
      <Tooltip title="הוסף כתובית"><span><IconButton aria-label="הוסף כתובית" disabled={disabled || !canAdd} onClick={add} color="primary"><AddRounded /></IconButton></span></Tooltip>
      {commands.map(([label, key, icon, action, unavailable]) => <Tooltip key={label} title={`${label} · ${key}`}><span><IconButton aria-label={label} disabled={disabled || unavailable} onClick={action} color={label.startsWith('מחיקת') ? 'error' : 'default'}>{icon}</IconButton></span></Tooltip>)}
      <Tooltip title="קיצורי מקלדת"><IconButton aria-label="קיצורי מקלדת" onClick={() => setHelp(true)}><KeyboardRounded /></IconButton></Tooltip>
    </Box>
    <Dialog open={help} onClose={() => setHelp(false)} maxWidth="sm" fullWidth aria-labelledby="timeline-shortcuts-title">
      <DialogTitle id="timeline-shortcuts-title">קיצורי מקלדת בציר הזמן</DialogTitle>
      <DialogContent>
        {[
          ['Ctrl / ⌘ + לחיצה', 'הוספה לבחירה או הסרה ממנה'], ['Shift + לחיצה', 'בחירת טווח כתוביות'],
          ['Ctrl / ⌘ + A', 'בחירת כל הכתוביות'], ['Esc', 'ניקוי הבחירה או ביטול גרירה'],
          ['← / →', 'הזזת הבחירה בפריים אחד; ללא בחירה — הזזת הקו'], ['Shift + ← / →', 'הזזה בחמישה פריימים'],
          ['Delete / Backspace', 'מחיקת הכתוביות המסומנות'], ['Ctrl / ⌘ + M', 'חיבור כתוביות רצופות'],
          ['Ctrl / ⌘ + K', 'פיצול הכתובית המסומנת בנקודת הקו'], ['Ctrl / ⌘ + Z', 'ביטול פעולה'],
          ['Ctrl / ⌘ + Shift + Z / Ctrl + Y', 'ביצוע חוזר'], ['Space', 'ניגון / השהיה'],
          ['Home / End', 'מעבר לתחילת הסרטון / לסופו'], ['+ / −', 'קירוב / הרחקת ציר הזמן'],
          ['Ctrl / ⌘ + 0', 'הצגת כל ההקלטה'], ['F2 / לחיצה כפולה', 'פתיחת עריכת הכתובית'],
        ].map(([key, label]) => <Box key={key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: .6, borderBottom: '1px solid #eee' }}><Typography variant="body2">{label}</Typography><Typography component="kbd" variant="body2" dir="ltr" sx={{ whiteSpace: 'nowrap' }}>{key}</Typography></Box>)}
        <Typography variant="caption" sx={{ display: 'block', mt: 2 }}>הקיצורים פעילים כשהמיקוד בציר הראשי, ואינם משנים כתוביות בעת הקלדה בשדה או עבודה בציר המילים. גררו כתובית מסומנת כדי להזיז את כל הבחירה יחד.</Typography>
      </DialogContent>
      <DialogActions><Button onClick={() => setHelp(false)}>סגירה</Button></DialogActions>
    </Dialog>
  </>;
}
