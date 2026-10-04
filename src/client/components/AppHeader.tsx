import type { MouseEvent } from "react";
import { AppBar, Box, Button, ButtonBase, Chip, CircularProgress, Divider, IconButton, Menu, MenuItem, Toolbar, Tooltip, Typography } from "@mui/material";
import { VideoLibraryRounded, HomeRounded, AccountBalanceWalletRounded, UploadFileOutlined, MenuRounded, ShareRounded, ChevronLeftRounded } from "@mui/icons-material";
import type { AuthUser } from "../hooks/useTranscriptionWorkflow";
import type { EditorHeaderActions } from "../contexts/EditorHeaderContext";
import { useAuth } from "../contexts/AuthContext";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
import { DESKTOP_APP_HEADER_HEIGHT, MOBILE_APP_HEADER_HEIGHT } from "../utils/appLayout";

type HeaderPage = "home" | "videos" | "transcription";

type AppHeaderProps = {
  user: AuthUser;
  authLoading: boolean;
  profileAnchorEl: HTMLElement | null;
  currentPage: HeaderPage;
  credits: number | null;
  onProfileClick: (event: MouseEvent<HTMLElement>) => void;
  onProfileClose: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onNavigate: (page: HeaderPage) => void;
  onBuyCredits: () => void;
  navigationBlocked?: boolean;
  isAdmin?: boolean;
  onAdmin?: () => void;
  onReportIssue?: () => void;
  editorActions?: EditorHeaderActions | null;
};

export function AppHeader({ user, authLoading, profileAnchorEl, currentPage, credits, onProfileClick, onProfileClose,
  onSignIn, onSignOut, onNavigate, onBuyCredits, navigationBlocked = false, isAdmin = false, onAdmin, onReportIssue, editorActions,
}: AppHeaderProps) {
  const { isDevBypass } = useAuth();
  const narrow = useNarrowViewport();
  const headerHeight = narrow ? MOBILE_APP_HEADER_HEIGHT : DESKTOP_APP_HEADER_HEIGHT;
  const actionSize = narrow ? 36 : 44;
  const creditsColor = credits === null ? "default" : credits < 20 ? "error" : credits < 50 ? "warning" : "success";
  const menuOpen = Boolean(profileAnchorEl);

  return (
    <AppBar position="fixed" color="default" elevation={0} data-testid="app-header" sx={{ height: headerHeight, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      <Toolbar variant="dense" sx={{ minHeight: `${headerHeight - 1}px !important`, px: { xs: 1, sm: 1.5 }, direction: "rtl", gap: 1, justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
          {!narrow && <Box component="img" src={`${import.meta.env.BASE_URL}quickcaption-favicon.svg`} alt="QuickCaption" sx={{ width: 32, height: 32, mr: 0.5 }} />}
          {user && <>
            <IconButton aria-label="תפריט" aria-haspopup="menu" aria-controls={menuOpen ? "app-navigation-menu" : undefined} aria-expanded={menuOpen}
              onClick={onProfileClick} sx={{ width: actionSize, height: actionSize, borderRadius: 2, ...(menuOpen ? { bgcolor: "action.selected" } : {}) }}><MenuRounded sx={{ fontSize: narrow ? 20 : 24 }} /></IconButton>
            {editorActions?.showShare && <Tooltip title="שיתוף סרטון עם כתוביות">
              <span><IconButton aria-label="שיתוף סרטון עם כתוביות" disabled={!editorActions.canShare} onClick={editorActions.onShare}
                sx={{ width: narrow ? actionSize : 40, height: narrow ? actionSize : 40, ml: 0.5, bgcolor: "primary.main", color: "#fff", "&:hover": { bgcolor: "primary.dark" }, "&.Mui-disabled": { bgcolor: "action.disabledBackground", color: "action.disabled" } }}>
                {editorActions.sharing ? <CircularProgress size={20} color="inherit" /> : <ShareRounded sx={{ fontSize: narrow ? 20 : 24 }} />}
              </IconButton></span>
            </Tooltip>}
          </>}
        </Box>
        {user ? <>
          <ButtonBase onClick={editorActions?.onMyVideos ?? (() => onNavigate("videos"))} disabled={navigationBlocked || editorActions?.backDisabled}
            sx={{ display: "flex", direction: "ltr", minHeight: actionSize, minWidth: 0, gap: 0.25, fontSize: 14, fontWeight: 500, borderRadius: 1, px: 0.5 }}>
            <ChevronLeftRounded data-testid="my-videos-back-arrow" sx={{ width: 24, height: 24, flexShrink: 0 }} />
            <Box component="span" dir="rtl" sx={{ whiteSpace: "nowrap" }}>לסרטונים שלי</Box>
          </ButtonBase>
          <Menu id="app-navigation-menu" anchorEl={profileAnchorEl} open={menuOpen} onClose={onProfileClose}
            anchorOrigin={{ horizontal: "right", vertical: "bottom" }} transformOrigin={{ horizontal: "right", vertical: "top" }}
            slotProps={{ paper: { dir: "rtl", sx: { width: 256, maxWidth: "calc(100vw - 24px)", mt: 0.75, borderRadius: 2 } } }}>
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography fontWeight={500} sx={{ overflowWrap: "anywhere" }}>{user.displayName ?? user.email ?? "משתמש"}</Typography>
              {credits !== null && <Chip icon={<AccountBalanceWalletRounded />} label={`${credits} קרדיטים`} color={creditsColor} size="small" sx={{ mt: 1.25 }} />}
              {isDevBypass && <Typography variant="caption" display="block" sx={{ mt: 1 }}>משתמש דמה מקומי</Typography>}
            </Box>
            <Divider />
            <MenuItem selected={currentPage === "home"} disabled={navigationBlocked} onClick={() => { onProfileClose(); onNavigate("home"); }}>
              <HomeRounded sx={{ ml: 1.5 }} />דף הבית
            </MenuItem>
            <MenuItem selected={currentPage === "videos"} disabled={navigationBlocked} onClick={() => { onProfileClose(); onNavigate("videos"); }}>
              <VideoLibraryRounded sx={{ ml: 1.5 }} />היסטוריית סרטונים
            </MenuItem>
            <MenuItem selected={currentPage === "transcription"} disabled={navigationBlocked} onClick={() => { onProfileClose(); onNavigate("transcription"); }}>
              <UploadFileOutlined sx={{ ml: 1.5 }} />סרטון חדש
            </MenuItem>
            <MenuItem disabled={navigationBlocked} onClick={() => { onProfileClose(); onBuyCredits(); }}>
              <AccountBalanceWalletRounded sx={{ ml: 1.5 }} />רכישת קרדיטים
            </MenuItem>
            {isAdmin && <MenuItem disabled={navigationBlocked} onClick={() => { onProfileClose(); onAdmin?.(); }}>ניהול</MenuItem>}
            <MenuItem onClick={() => { onProfileClose(); onReportIssue?.(); }}>דיווח על תקלה</MenuItem>
            <Divider />
            <MenuItem disabled={navigationBlocked} onClick={() => { onProfileClose(); void onSignOut(); }}>התנתקות</MenuItem>
          </Menu>
        </> : <Button color="primary" variant="contained" onClick={onSignIn} disabled={authLoading}
          startIcon={authLoading ? <CircularProgress size={18} color="inherit" /> : undefined}>{authLoading ? "מתחבר..." : "התחברות"}</Button>}
      </Toolbar>
    </AppBar>
  );
}
