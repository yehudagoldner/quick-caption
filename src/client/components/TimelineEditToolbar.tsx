import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, IconButton, Popover, Tooltip } from "@mui/material";
import { MoreHorizRounded } from "@mui/icons-material";

// Keep both tracks adjacent. Secondary actions move into a popover, never a second row.
export function TimelineEditToolbar({ editor, actions, primary, close, compactAt = 920, label = "עריכת המקטע והמילים", actionsLabel = "פעולות מקטע ומילים" }: {
  editor: ReactNode; actions: ReactNode; primary: ReactNode; close: ReactNode;
  compactAt?: number; label?: string; actionsLabel?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(true);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const narrow = entry.contentRect.width < compactAt;
      setCompact(narrow);
      if (!narrow) setAnchor(null);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [compactAt]);
  return <Box ref={root} className="timeline-edit-toolbar" data-testid="timeline-edit-toolbar" role="toolbar" aria-label={label}>
    <Box sx={{ flex: 1, minWidth: 0 }}>{editor}</Box>
    {!compact && <Box className="timeline-edit-actions">{actions}</Box>}
    {primary}
    {compact && <Tooltip title={actionsLabel}><IconButton size="small" aria-label={actionsLabel}
      aria-haspopup="dialog" aria-expanded={!!anchor} onClick={e => setAnchor(e.currentTarget)}><MoreHorizRounded /></IconButton></Tooltip>}
    {close}
    <Popover open={compact && !!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
      <Box role="dialog" aria-label={actionsLabel} className="timeline-edit-actions timeline-edit-overflow" sx={{ p: 1, maxWidth: 320 }}>
        {actions}
      </Box>
    </Popover>
  </Box>;
}
