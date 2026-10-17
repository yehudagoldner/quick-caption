import { useContext, useEffect, useId, useRef, useState } from 'react';
import { Box, Button, ClickAwayListener, Divider, MenuItem, MenuList, Paper, Popper, Typography } from '@mui/material';
import { DownloadRounded, MovieFilterRounded, SubtitlesRounded } from '@mui/icons-material';
import { DownloadContext } from '../contexts/DownloadContext';
import { VideoVersionContext } from '../contexts/VideoVersionContext';
import { VIDEO_FORMATS } from '../../videoVersions.js';

export function VideoDownloadMenu({ pendingEdits, isBurning, mediaUrl, canBurn, fontReady, downloadUrl, downloadName, burnedVideo, onBurnVideo }: {
  pendingEdits: boolean; isBurning: boolean; mediaUrl: string | null; canBurn: boolean; fontReady: boolean;
  downloadUrl: string | null; downloadName: string; burnedVideo: { url: string; name: string } | null; onBurnVideo: () => void;
}) {
  const downloads = useContext(DownloadContext);
  const versions = useContext(VideoVersionContext);
  const anchor = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const id = useId();
  const cancelClose = () => clearTimeout(timer.current);
  const close = () => { cancelClose(); setOpen(false); setKeyboard(false); };
  const leave = () => { if (!keyboard) timer.current = setTimeout(close, 250); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (pendingEdits || isBurning) setOpen(false); }, [pendingEdits, isBurning]);
  const disabled = pendingEdits || isBurning || !mediaUrl || !canBurn || !fontReady || Boolean(versions?.disabled);
  const current = VIDEO_FORMATS.find(format => format.id === versions?.activeId);
  const details = (label: string, platforms: string) => <Typography variant="caption" color="text.secondary" component="span" display="block" aria-hidden="true">גרסת <bdi>{label}</bdi> · <bdi>{platforms}</bdi></Typography>;
  return <ClickAwayListener onClickAway={close}>
    <Box onMouseEnter={cancelClose} onMouseLeave={leave}>
      <Button ref={anchor} variant="outlined" size="small" startIcon={<DownloadRounded />}
        disabled={pendingEdits || isBurning} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onMouseEnter={() => { cancelClose(); if (!pendingEdits && !isBurning) setOpen(true); }}
        onClick={() => { cancelClose(); setKeyboard(true); setOpen(true); }}
        onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setKeyboard(true); setOpen(true); } }}>
        הורדה
      </Button>
      <Popper open={open} anchorEl={anchor.current} placement="bottom-end" sx={{ zIndex: theme => theme.zIndex.modal }}>
        <Paper elevation={8} dir="rtl" onMouseEnter={cancelClose} onMouseLeave={leave} sx={{ maxHeight: 'calc(100dvh - 48px)', overflowY: 'auto', maxWidth: 'calc(100vw - 32px)' }}>
          <MenuList id={id} aria-label="אפשרויות הורדה" autoFocusItem={keyboard} onKeyDown={event => {
            if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(); anchor.current?.focus(); }
          }}>
            <MenuItem disabled={!downloadUrl || pendingEdits} onClick={() => {
              close(); if (downloadUrl) void downloads.downloadSubtitles({ url: downloadUrl, name: downloadName });
            }}><SubtitlesRounded sx={{ marginInlineEnd: 1 }} />הורד קובץ כתוביות</MenuItem>
            <Divider />
            <MenuItem disabled={disabled} aria-label="הורד סרטון עם כתוביות" onClick={() => { close(); onBurnVideo(); }}>
              <MovieFilterRounded sx={{ marginInlineEnd: 1 }} /><Box>
                {canBurn ? (fontReady ? 'הורד סרטון עם כתוביות' : 'ממתינים לטעינת הפונט') : 'צריבה זמינה לקובץ וידאו בלבד'}
                {current && details(current.label, current.platforms)}
              </Box>
            </MenuItem>
            {versions && VIDEO_FORMATS.filter(format => format.id !== versions.activeId).map(format => <MenuItem key={format.id}
              disabled={disabled} aria-label={`הורדת גרסת ${format.label}`} onClick={() => { close(); void versions.download(format.id); }}>
              <DownloadRounded sx={{ marginInlineEnd: 1 }} /><Box>הורדת גרסת <bdi>{format.label}</bdi><Typography variant="caption" color="text.secondary" display="block" aria-hidden="true"><bdi>{format.platforms}</bdi></Typography></Box>
            </MenuItem>)}
            {burnedVideo && <MenuItem disabled={disabled} onClick={() => { close(); void downloads.downloadVideo(burnedVideo); }}>
              <DownloadRounded sx={{ marginInlineEnd: 1 }} />הורד סרטון צרוב מוכן
            </MenuItem>}
          </MenuList>
        </Paper>
      </Popper>
    </Box>
  </ClickAwayListener>;
}
